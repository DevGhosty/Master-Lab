import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  FFMPEG_TIMEOUT_MS,
  MAX_CHANNELS,
  MAX_DURATION_SECONDS,
  MAX_SAMPLE_RATE_HZ,
  MIN_SAMPLE_RATE_HZ,
  SUPPORTED_AUDIO_CODECS,
} from "./constants.js";
import { PublicError } from "./errors.js";
import { computePostTrimGainDb } from "./loudnessPolicy.js";

const FFMPEG_GLOBAL = ["-hide_banner", "-threads", "0"];

export function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = FFMPEG_TIMEOUT_MS, ...spawnOptions } = options;
    const child = spawn(cmd, args, { ...spawnOptions, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs)
      : null;
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function ffprobeJson(inputPath) {
  const { code, stdout, stderr } = await runCommand("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  if (code !== 0) {
    throw new PublicError("We could not read this as a supported audio file.", {
      internalMessage: stderr || "ffprobe failed",
    });
  }
  return JSON.parse(stdout);
}

function parseEbur128Summary(stderr) {
  const summaryBlock = stderr.match(/Summary:[\s\S]*?(?=\n\[|$)/i)?.[0];
  if (summaryBlock) {
    const integratedMatch = summaryBlock.match(/Integrated loudness\s*\(I\):\s*([-\d.]+)\s*LUFS/i);
    const truePeakMatch =
      summaryBlock.match(/True peak:\s*([-\d.]+)\s*dB(?:TP|FS)/i) ||
      summaryBlock.match(/True peak:[\s\S]*?\bPeak:\s*([-\d.]+)\s*dB(?:TP|FS)/i);
    if (integratedMatch) {
      return {
        input_i: Number(integratedMatch[1]),
        input_tp: truePeakMatch ? Number(truePeakMatch[1]) : null,
      };
    }
  }

  const integratedMatches = [...stderr.matchAll(/Integrated loudness\s*\(I\):\s*([-\d.]+)\s*LUFS/gi)];
  if (integratedMatches.length) {
    const last = integratedMatches[integratedMatches.length - 1];
    const tpMatches = [...stderr.matchAll(/True peak:\s*([-\d.]+)\s*dBTP/gi)];
    return {
      input_i: Number(last[1]),
      input_tp: tpMatches.length ? Number(tpMatches[tpMatches.length - 1][1]) : null,
    };
  }

  // Progressive ebur128 lines — use the final integrated value, not the first (-70 gate).
  const progressMatches = [...stderr.matchAll(/\bI:\s*([-\d.]+)\s*LUFS/gi)];
  if (progressMatches.length) {
    const last = progressMatches[progressMatches.length - 1];
    const tpMatches = [
      ...stderr.matchAll(/\b(?:F?TPK|Peak):\s*((?:\s*[-\d.]+)+)\s*dB(?:TP|FS)/gi),
    ];
    const lastTpMatch = tpMatches.length ? tpMatches[tpMatches.length - 1][1].trim().split(/\s+/) : [];
    const truePeak = lastTpMatch.reduce((max, value) => Math.max(max, Number(value)), -Infinity);
    return {
      input_i: Number(last[1]),
      input_tp: Number.isFinite(truePeak) ? truePeak : null,
    };
  }

  return { input_i: null, input_tp: null };
}

function parseSilence(stderr) {
  let leading = 0;
  let trailing = 0;
  const startMatches = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)];
  const endMatches = [...stderr.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)];
  if (startMatches.length && Number(startMatches[0][1]) < 0.5) {
    leading = Number(endMatches[0]?.[2] || 0);
  }
  if (endMatches.length) {
    const last = endMatches[endMatches.length - 1];
    trailing = Number(last[2] || 0);
  }
  return { leading, trailing };
}

function parsePeakStats(stderr) {
  let peakDb = -Infinity;
  let rmsDb = -Infinity;

  const overallBlock = stderr.match(/Overall[\s\S]*?(?=\n\[|\n*$)/);
  const haystack = overallBlock ? overallBlock[0] : stderr;

  const peakMatch =
    haystack.match(/Peak level dB:\s*([-\d.]+)/i) ||
    haystack.match(/lavfi\.astats\.Overall\.Peak_level=([-\d.]+)/i);
  const rmsMatch =
    haystack.match(/RMS level dB:\s*([-\d.]+)/i) ||
    haystack.match(/lavfi\.astats\.Overall\.RMS_level=([-\d.]+)/i);
  if (peakMatch) peakDb = Number(peakMatch[1]);
  if (rmsMatch) rmsDb = Number(rmsMatch[1]);

  const peakLinear = Number.isFinite(peakDb) && peakDb > -120 ? Math.pow(10, peakDb / 20) : 0;
  const rmsLinear = Number.isFinite(rmsDb) && rmsDb > -120 ? Math.pow(10, rmsDb / 20) : 0;
  return { peakDb, rmsDb, peak: peakLinear, rms: rmsLinear };
}

function reconcilePeakMetrics(stats, loudness) {
  const loudnessDb = loudness.input_i != null ? Number(loudness.input_i) : stats.rmsDb;
  const truePeakDb = loudness.input_tp != null ? Number(loudness.input_tp) : stats.peakDb;
  let peakDb = stats.peakDb;
  let rmsDb = stats.rmsDb;
  let peak = stats.peak;
  let rms = stats.rms;

  const statsLookBroken =
    !Number.isFinite(peakDb) ||
    peakDb < -60 ||
    (Number.isFinite(loudnessDb) && loudnessDb > -30 && peakDb < -20);

  if (statsLookBroken && Number.isFinite(truePeakDb)) {
    peakDb = truePeakDb;
    peak = Math.pow(10, peakDb / 20);
  }
  if ((!Number.isFinite(rmsDb) || rmsDb < -60) && Number.isFinite(loudnessDb)) {
    rmsDb = loudnessDb - 6;
    rms = Math.pow(10, rmsDb / 20);
  }

  return { peakDb, rmsDb, peak, rms, loudnessDb, truePeakDb };
}

function parseClipping(stderr) {
  const clipMatch = stderr.match(/Number of samples clipped:\s*(\d+)/);
  const totalMatches = [...stderr.matchAll(/(?:Number of samples|Number_of_samples)[=:]\s*([\d.]+)/gi)];
  let clippingSamples = clipMatch ? Number(clipMatch[1]) : 0;
  const total = totalMatches.length ? Number(totalMatches[totalMatches.length - 1][1]) : 1;
  if (!clippingSamples) {
    const minMatches = [...stderr.matchAll(/(?:Min level|Min_level)[=:]\s*([-\d.]+)/gi)];
    const maxMatches = [...stderr.matchAll(/(?:Max level|Max_level)[=:]\s*([-\d.]+)/gi)];
    const absPeakMatches = [...stderr.matchAll(/(?:Abs Peak count|Abs_Peak_count)[=:]\s*([\d.]+)/gi)];
    const peakMatches = [...stderr.matchAll(/(?:Peak count|Peak_count)[=:]\s*([\d.]+)/gi)];
    const minLevel = minMatches.length ? Number(minMatches[minMatches.length - 1][1]) : NaN;
    const maxLevel = maxMatches.length ? Number(maxMatches[maxMatches.length - 1][1]) : NaN;
    const peakCount = absPeakMatches.length
      ? Number(absPeakMatches[absPeakMatches.length - 1][1])
      : peakMatches.length
        ? Number(peakMatches[peakMatches.length - 1][1])
        : 0;
    if ((minLevel <= -32768 || maxLevel >= 32767) && peakCount > 0) {
      clippingSamples = peakCount;
    }
  }
  return { clippingSamples, clippingRatio: clippingSamples / Math.max(1, total) };
}

function probeFromFfprobe(probe) {
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");
  if (!audioStream) throw new PublicError("No audio stream was found in this file.");
  return {
    duration: Number(probe.format?.duration || audioStream.duration || 0),
    channels: Number(audioStream.channels || 1),
    sampleRate: Number(audioStream.sample_rate || 44100),
    codec: String(audioStream.codec_name || "").toLowerCase(),
    codecLongName: audioStream.codec_long_name || null,
    bitDepth: audioStream.bits_per_raw_sample
      ? Number(audioStream.bits_per_raw_sample)
      : audioStream.bits_per_sample
        ? Number(audioStream.bits_per_sample)
        : null,
  };
}

export function validateAudioProbe(probe) {
  if (!probe || !Number.isFinite(probe.duration) || probe.duration <= 0) {
    throw new PublicError("We could not measure a playable audio duration for this file.");
  }
  if (probe.duration > MAX_DURATION_SECONDS) {
    throw new PublicError(`File is longer than ${MAX_DURATION_SECONDS} seconds.`);
  }
  if (!Number.isFinite(probe.channels) || probe.channels < 1 || probe.channels > MAX_CHANNELS) {
    throw new PublicError("Only mono or stereo audio files are supported.");
  }
  if (
    !Number.isFinite(probe.sampleRate) ||
    probe.sampleRate < MIN_SAMPLE_RATE_HZ ||
    probe.sampleRate > MAX_SAMPLE_RATE_HZ
  ) {
    throw new PublicError(`Audio sample rate must be between ${MIN_SAMPLE_RATE_HZ} Hz and ${MAX_SAMPLE_RATE_HZ} Hz.`);
  }
  if (!probe.codec || !SUPPORTED_AUDIO_CODECS.has(probe.codec)) {
    throw new PublicError("This audio codec is not supported yet.", {
      internalMessage: `Unsupported audio codec: ${probe.codec || "unknown"}`,
    });
  }
  return probe;
}

function buildAnalysisFromMetrics(metrics, clip, silence, channels, bandMetrics = {}) {
  const { peakDb, rmsDb, peak, rms, loudnessDb, truePeakDb } = metrics;
  const safePeakDb = Number.isFinite(peakDb) ? peakDb : null;
  const safeRmsDb = Number.isFinite(rmsDb) ? rmsDb : null;
  return {
    rms,
    peak,
    rmsDb: safeRmsDb,
    peakDb: safePeakDb,
    truePeakDb: Number.isFinite(truePeakDb) ? truePeakDb : null,
    loudnessDb: Number.isFinite(loudnessDb) ? loudnessDb : null,
    crestDb: safePeakDb != null && safeRmsDb != null ? safePeakDb - safeRmsDb : null,
    lowRatioDb: Number.isFinite(bandMetrics.lowRatioDb) ? bandMetrics.lowRatioDb : null,
    mudRatioDb: Number.isFinite(bandMetrics.mudRatioDb) ? bandMetrics.mudRatioDb : null,
    midRatioDb: Number.isFinite(bandMetrics.midRatioDb) ? bandMetrics.midRatioDb : null,
    presenceRatioDb: Number.isFinite(bandMetrics.presenceRatioDb) ? bandMetrics.presenceRatioDb : null,
    highRatioDb: Number.isFinite(bandMetrics.highRatioDb) ? bandMetrics.highRatioDb : null,
    dcOffset: 0,
    dcOffsetDb: -80,
    stereoCorrelation: null,
    serverAnalysis: true,
    leadingSilenceSeconds: silence.leading,
    trailingSilenceSeconds: silence.trailing,
    clippingSamples: clip.clippingSamples,
    clippingRatio: clip.clippingRatio,
  };
}

function inferPeakFromWaveformPeaks(waveformPeaks) {
  if (!waveformPeaks?.length) return null;
  let maxAbs = 0;
  for (const point of waveformPeaks) {
    maxAbs = Math.max(maxAbs, Math.abs(point.min), Math.abs(point.max));
  }
  if (maxAbs <= 0.00001) return null;
  const peakDb = 20 * Math.log10(maxAbs);
  return { peak: maxAbs, peakDb, truePeakDb: peakDb };
}

function applyWaveformFallback(analysis, waveformPeaks) {
  const inferred = inferPeakFromWaveformPeaks(waveformPeaks);
  if (!inferred) return analysis;

  const peakBroken =
    !Number.isFinite(analysis.peakDb) ||
    analysis.peakDb < -60 ||
    !Number.isFinite(analysis.peak) ||
    analysis.peak < 0.00001;
  const loudnessBroken =
    !Number.isFinite(analysis.loudnessDb) ||
    analysis.loudnessDb <= -69;

  if (peakBroken) {
    analysis.peak = inferred.peak;
    analysis.peakDb = inferred.peakDb;
    if (!Number.isFinite(analysis.truePeakDb) || analysis.truePeakDb < -60) {
      analysis.truePeakDb = inferred.truePeakDb;
    }
  }
  if ((!Number.isFinite(analysis.rmsDb) || analysis.rmsDb < -60) && Number.isFinite(analysis.peakDb)) {
    analysis.rmsDb = analysis.peakDb - 12;
    analysis.rms = Math.pow(10, analysis.rmsDb / 20);
  }
  if (loudnessBroken && Number.isFinite(analysis.peakDb) && analysis.peakDb > -60) {
    analysis.loudnessDb = Math.max(analysis.peakDb - 16, -35);
  }
  if (Number.isFinite(analysis.peakDb) && Number.isFinite(analysis.rmsDb)) {
    analysis.crestDb = analysis.peakDb - analysis.rmsDb;
  }
  return analysis;
}

function peaksFromFloat32File(buffer, width = 800) {
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const block = Math.max(1, Math.floor(samples.length / width));
  const peaks = [];
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * block;
    for (let i = 0; i < block && start + i < samples.length; i += 1) {
      const s = samples[start + i];
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    peaks.push({ min, max });
  }
  return peaks;
}

function linearToDb(value) {
  if (value <= 0 || !Number.isFinite(value)) return -Infinity;
  return 20 * Math.log10(value);
}

function rmsFromSamples(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function onePoleLowpassRms(samples, sampleRate, cutoff) {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    y += alpha * (samples[i] - y);
    sum += y * y;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function onePoleHighpassRms(samples, sampleRate, cutoff) {
  const alpha = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let low = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    low = (1 - alpha) * samples[i] + alpha * low;
    const high = samples[i] - low;
    sum += high * high;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function bandpassRms(samples, sampleRate, lowCutoff, highCutoff) {
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowCutoff) / sampleRate);
  const highAlpha = 1 - Math.exp((-2 * Math.PI * highCutoff) / sampleRate);
  let low = 0;
  let high = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    low += lowAlpha * (samples[i] - low);
    high += highAlpha * (samples[i] - high);
    const band = high - low;
    sum += band * band;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function estimateBandMetricsFromMono(buffer, sampleRate = 8000) {
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  const fullRms = rmsFromSamples(samples);
  if (!fullRms) return {};
  const lowRms = onePoleLowpassRms(samples, sampleRate, 160);
  const lowMidRms = bandpassRms(samples, sampleRate, 180, 520);
  const midRms = bandpassRms(samples, sampleRate, 520, 2400);
  const presenceRms = bandpassRms(samples, sampleRate, 2400, 3600);
  const highRms = onePoleHighpassRms(samples, sampleRate, 3600);
  return {
    lowRatioDb: linearToDb(lowRms / fullRms),
    mudRatioDb: linearToDb(lowMidRms / fullRms),
    midRatioDb: linearToDb(midRms / fullRms),
    presenceRatioDb: linearToDb(presenceRms / fullRms),
    highRatioDb: linearToDb(highRms / fullRms),
  };
}

async function readPeaksFile(peaksRaw, width = 800) {
  let buffer;
  try {
    buffer = await fs.readFile(peaksRaw);
  } catch {
    return [];
  } finally {
    await fs.unlink(peaksRaw).catch(() => {});
  }
  return peaksFromFloat32File(buffer, width);
}

async function readPeaksAndBandMetricsFile(peaksRaw, width = 800) {
  let buffer;
  try {
    buffer = await fs.readFile(peaksRaw);
  } catch {
    return { waveformPeaks: [], bandMetrics: {} };
  } finally {
    await fs.unlink(peaksRaw).catch(() => {});
  }
  return {
    waveformPeaks: peaksFromFloat32File(buffer, width),
    bandMetrics: estimateBandMetricsFromMono(buffer),
  };
}

const METRICS_FILTER_COMPLEX = [
  "[0:a]asplit=2[stats][loud]",
  "[stats]aformat=sample_rates=48000:channel_layouts=stereo,astats=metadata=1:reset=1,ametadata=print:file=-,silencedetect=noise=-50dB:d=0.3[sout]",
  "[loud]aformat=sample_rates=48000:channel_layouts=stereo,ebur128=peak=true[lout]",
].join(";");

const ANALYZE_FILTER_COMPLEX = [
  "[0:a]asplit=3[stats][loud][wave]",
  "[stats]aformat=sample_rates=48000:channel_layouts=stereo,astats=metadata=1:reset=1,ametadata=print:file=-,silencedetect=noise=-50dB:d=0.3[sout]",
  "[loud]aformat=sample_rates=48000:channel_layouts=stereo,ebur128=peak=true[lout]",
  "[wave]aresample=8000,aformat=channel_layouts=mono:sample_fmts=flt[wout]",
].join(";");

/** Fast EBU R128 + astats in separate branches (same decode). */
async function runMetricsPass(inputPath) {
  const { code, stdout, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-i",
    inputPath,
    "-vn",
    "-filter_complex",
    METRICS_FILTER_COMPLEX,
    "-map",
    "[sout]",
    "-f",
    "null",
    "-",
    "-map",
    "[lout]",
    "-f",
    "null",
    "-",
  ]);
  if (code !== 0) {
    throw new PublicError("Audio analysis failed. Try another export format or a shorter file.", {
      internalMessage: stderr || "Audio analysis failed",
    });
  }
  const output = `${stderr}\n${stdout}`;
  return {
    loudness: parseEbur128Summary(output),
    stats: parsePeakStats(output),
    clip: parseClipping(output),
    silence: parseSilence(output),
  };
}

/** One decode: stats + loudness + waveform branches in parallel inside FFmpeg. */
async function runCombinedAnalyzePass(inputPath, peaksRaw) {
  const { code, stdout, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-filter_complex",
    ANALYZE_FILTER_COMPLEX,
    "-map",
    "[sout]",
    "-f",
    "null",
    "-",
    "-map",
    "[lout]",
    "-f",
    "null",
    "-",
    "-map",
    "[wout]",
    "-f",
    "f32le",
    peaksRaw,
  ]);
  if (code !== 0) {
    throw new PublicError("Audio analysis failed. Try another export format or a shorter file.", {
      internalMessage: stderr || "Audio analysis failed",
    });
  }
  const output = `${stderr}\n${stdout}`;
  return {
    loudness: parseEbur128Summary(output),
    stats: parsePeakStats(output),
    clip: parseClipping(output),
    silence: parseSilence(output),
  };
}

export async function probeAudioFile(inputPath) {
  return probeFromFfprobe(await ffprobeJson(inputPath));
}

export async function validateAudioFile(inputPath) {
  return validateAudioProbe(await probeAudioFile(inputPath));
}

export async function measureIntegratedLoudness(inputPath) {
  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-i",
    inputPath,
    "-vn",
    "-map",
    "0:a:0",
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  if (code !== 0) {
    throw new PublicError("Loudness measurement failed. Try another export format or a shorter file.", {
      internalMessage: stderr || "Loudness measurement failed",
    });
  }
  return parseEbur128Summary(stderr);
}

export async function analyzeMetricsOnly(inputPath) {
  const probe = await validateAudioFile(inputPath);
  const { loudness, stats, clip, silence } = await runMetricsPass(inputPath);
  const metrics = reconcilePeakMetrics(stats, loudness);
  return buildAnalysisFromMetrics(metrics, clip, silence, probe.channels);
}

export async function analyzeAudioFile(inputPath) {
  const probe = await validateAudioFile(inputPath);
  const peaksRaw = `${inputPath}.peaks.f32le`;
  const { loudness, stats, clip, silence } = await runCombinedAnalyzePass(inputPath, peaksRaw);
  const metrics = reconcilePeakMetrics(stats, loudness);
  const { waveformPeaks, bandMetrics } = await readPeaksAndBandMetricsFile(peaksRaw);
  const analysis = buildAnalysisFromMetrics(metrics, clip, silence, probe.channels, bandMetrics);
  applyWaveformFallback(analysis, waveformPeaks);
  return {
    probe,
    analysis,
    waveformPeaks,
  };
}

export async function extractWaveformPeaks(inputPath, width = 800) {
  const peaksRaw = `${inputPath}.peaks.f32le`;
  const { code } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    peaksRaw,
  ]);
  if (code !== 0) return [];
  return readPeaksFile(peaksRaw, width);
}

export async function applyGainToFile(filePath, gainDb) {
  if (Math.abs(gainDb) <= 0.01) return;
  const ext = path.extname(filePath);
  const tempPath = `${filePath}.gain${ext}`;
  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-y",
    "-i",
    filePath,
    "-vn",
    "-map",
    "0:a:0",
    "-map_metadata",
    "-1",
    "-af",
    `volume=${gainDb.toFixed(2)}dB`,
    tempPath,
  ]);
  if (code !== 0) {
    throw new PublicError("Could not finish the mastered export safely.", {
      internalMessage: stderr || `Gain apply failed for ${path.basename(filePath)}`,
    });
  }
  await fs.rename(tempPath, filePath);
}

async function enforceCeiling(files, masteredAnalysis, ceilingDb) {
  if (!Number.isFinite(masteredAnalysis?.truePeakDb) || !Number.isFinite(ceilingDb)) return 0;
  const excessDb = masteredAnalysis.truePeakDb - ceilingDb;
  if (excessDb <= 0.03) return 0;
  const trimDb = -excessDb - 0.02;
  for (const filePath of Object.values(files)) {
    await applyGainToFile(filePath, trimDb);
  }
  return trimDb;
}

async function applyPreserveTrim(files, sourceLufs, masteredAnalysis, ceilingDb) {
  const trimGain = computePostTrimGainDb(
    sourceLufs,
    masteredAnalysis.loudnessDb,
    masteredAnalysis.truePeakDb,
    ceilingDb,
  );
  if (trimGain <= 0.01) return trimGain;
  for (const filePath of Object.values(files)) {
    await applyGainToFile(filePath, trimGain);
  }
  return trimGain;
}

export async function masterToFiles(inputPath, workDir, filterChain, onProgress, options = {}) {
  const report = (progress, message) => {
    if (typeof onProgress === "function") onProgress({ progress, message });
  };

  const previewPath = path.join(workDir, "preview.wav");
  const wav32Path = path.join(workDir, "master-32float.wav");
  const wav24Path = path.join(workDir, "master-24bit.wav");
  const wav16Path = path.join(workDir, "master-16bit.wav");
  const mp3Path = path.join(workDir, "master-320.mp3");
  const peaksRaw = path.join(workDir, "waveform.peaks.f32le");

  const filterComplex = [
    `[0:a]${filterChain}[master]`,
    "[master]asplit=6[preview][w32][w24][w16][mp3s][wf]",
    "[wf]aresample=8000,aformat=channel_layouts=mono:sample_fmts=flt[wout]",
  ].join(";");

  report(30, "Rendering master and exports");
  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-map_metadata",
    "-1",
    "-filter_complex",
    filterComplex,
    "-map",
    "[preview]",
    "-c:a",
    "pcm_s16le",
    previewPath,
    "-map",
    "[w32]",
    "-c:a",
    "pcm_f32le",
    wav32Path,
    "-map",
    "[w24]",
    "-c:a",
    "pcm_s24le",
    wav24Path,
    "-map",
    "[w16]",
    "-c:a",
    "pcm_s16le",
    wav16Path,
    "-map",
    "[mp3s]",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "320k",
    mp3Path,
    "-map",
    "[wout]",
    "-f",
    "f32le",
    peaksRaw,
  ]);
  if (code !== 0) {
    throw new PublicError("Mastering failed while rendering the audio. Try another file or preset.", {
      internalMessage: stderr || "Mastering failed",
    });
  }

  report(86, "Analyzing master preview");
  let masteredAnalysis = await analyzeMetricsOnly(previewPath);
  const files = {
    preview: previewPath,
    wav32: wav32Path,
    wav24: wav24Path,
    wav16: wav16Path,
    mp3: mp3Path,
  };

  if (options.sourceLufs != null && Number.isFinite(options.sourceLufs)) {
    report(88, "Matching source loudness");
    await applyPreserveTrim(files, options.sourceLufs, masteredAnalysis, options.ceilingDb ?? -1);
    masteredAnalysis = await analyzeMetricsOnly(previewPath);
  }

  if (Number.isFinite(options.ceilingDb)) {
    report(90, "Verifying true peak ceiling");
    await enforceCeiling(files, masteredAnalysis, options.ceilingDb);
    masteredAnalysis = await analyzeMetricsOnly(previewPath);
  }

  const waveformPeaks = await readPeaksFile(peaksRaw);

  return {
    files,
    masteredAnalysis,
    waveformPeaks,
  };
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
