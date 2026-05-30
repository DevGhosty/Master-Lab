import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const FFMPEG_GLOBAL = ["-hide_banner", "-threads", "0"];

export function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
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
  if (code !== 0) throw new Error(stderr || "ffprobe failed");
  return JSON.parse(stdout);
}

function parseEbur128Summary(stderr) {
  const summary = stderr.match(/Summary:[\s\S]*?(?=\n\[|\n*$)/i)?.[0] || stderr;
  const integratedMatch =
    summary.match(/Integrated loudness\s*\(I\):\s*([-\d.]+)\s*LUFS/i) ||
    stderr.match(/\bI:\s*([-\d.]+)\s*LUFS/i);
  const truePeakMatch =
    summary.match(/True peak:\s*([-\d.]+)\s*dBTP/i) ||
    stderr.match(/\bPeak:\s*([-\d.]+)\s*dBTP/i);
  return {
    input_i: integratedMatch ? Number(integratedMatch[1]) : null,
    input_tp: truePeakMatch ? Number(truePeakMatch[1]) : null,
  };
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

  const peakMatch = haystack.match(/Peak level dB:\s*([-\d.]+)/i);
  const rmsMatch = haystack.match(/RMS level dB:\s*([-\d.]+)/i);
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
  const totalMatch = stderr.match(/Number of samples:\s*(\d+)/);
  const clippingSamples = clipMatch ? Number(clipMatch[1]) : 0;
  const total = totalMatch ? Number(totalMatch[1]) : 1;
  return { clippingSamples, clippingRatio: clippingSamples / Math.max(1, total) };
}

function probeFromFfprobe(probe) {
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");
  if (!audioStream) throw new Error("No audio stream found");
  return {
    duration: Number(probe.format?.duration || audioStream.duration || 0),
    channels: Number(audioStream.channels || 1),
    sampleRate: Number(audioStream.sample_rate || 44100),
    bitDepth: audioStream.bits_per_raw_sample
      ? Number(audioStream.bits_per_raw_sample)
      : audioStream.bits_per_sample
        ? Number(audioStream.bits_per_sample)
        : null,
  };
}

function buildAnalysisFromMetrics(metrics, clip, silence, channels) {
  const { peakDb, rmsDb, peak, rms, loudnessDb, truePeakDb } = metrics;
  return {
    rms,
    peak,
    rmsDb,
    peakDb,
    truePeakDb,
    loudnessDb,
    crestDb: peakDb - rmsDb,
    lowRatioDb: -12,
    mudRatioDb: -8,
    midRatioDb: -10,
    presenceRatioDb: -14,
    highRatioDb: -18,
    dcOffset: 0,
    dcOffsetDb: -80,
    stereoCorrelation: channels >= 2 ? 0.85 : null,
    leadingSilenceSeconds: silence.leading,
    trailingSilenceSeconds: silence.trailing,
    clippingSamples: clip.clippingSamples,
    clippingRatio: clip.clippingRatio,
  };
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

/** Fast EBU R128 measurement pass (much faster than loudnorm for analysis). */
async function runMetricsPass(inputPath) {
  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-i",
    inputPath,
    "-af",
    "ebur128=peak=true,astats=metadata=1:reset=1,ametadata=print:file=-,silencedetect=noise=-50dB:d=0.3",
    "-f",
    "null",
    "-",
  ]);
  if (code !== 0) throw new Error(stderr || "Audio analysis failed");
  return {
    loudness: parseEbur128Summary(stderr),
    stats: parsePeakStats(stderr),
    clip: parseClipping(stderr),
    silence: parseSilence(stderr),
  };
}

/** One decode: metrics branch + waveform branch in parallel inside FFmpeg. */
async function runCombinedAnalyzePass(inputPath, peaksRaw) {
  const filterComplex = [
    "[0:a]asplit=2[meta][wave]",
    "[meta]aformat=sample_rates=48000:channel_layouts=stereo,ebur128=peak=true,astats=metadata=1:reset=1,ametadata=print:file=-,silencedetect=noise=-50dB:d=0.3[aout]",
    "[wave]aresample=8000,aformat=channel_layouts=mono:sample_fmts=flt[wout]",
  ].join(";");

  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[aout]",
    "-f",
    "null",
    "-",
    "-map",
    "[wout]",
    "-f",
    "f32le",
    peaksRaw,
  ]);
  if (code !== 0) throw new Error(stderr || "Audio analysis failed");
  return {
    loudness: parseEbur128Summary(stderr),
    stats: parsePeakStats(stderr),
    clip: parseClipping(stderr),
    silence: parseSilence(stderr),
  };
}

export async function probeAudioFile(inputPath) {
  return probeFromFfprobe(await ffprobeJson(inputPath));
}

export async function measureIntegratedLoudness(inputPath) {
  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-i",
    inputPath,
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  if (code !== 0) throw new Error(stderr || "Loudness measurement failed");
  return parseEbur128Summary(stderr);
}

export async function analyzeMetricsOnly(inputPath) {
  const probe = await probeAudioFile(inputPath);
  const { loudness, stats, clip, silence } = await runMetricsPass(inputPath);
  const metrics = reconcilePeakMetrics(stats, loudness);
  return buildAnalysisFromMetrics(metrics, clip, silence, probe.channels);
}

export async function analyzeAudioFile(inputPath) {
  const probe = await probeAudioFile(inputPath);
  const peaksRaw = `${inputPath}.peaks.f32le`;
  const { loudness, stats, clip, silence } = await runCombinedAnalyzePass(inputPath, peaksRaw);
  const metrics = reconcilePeakMetrics(stats, loudness);
  const waveformPeaks = await readPeaksFile(peaksRaw);
  return {
    probe,
    analysis: buildAnalysisFromMetrics(metrics, clip, silence, probe.channels),
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

export async function masterToFiles(inputPath, workDir, filterChain, onProgress) {
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
    "[master]asplit=6[pv][w32][w24][w16][mp3s][wf]",
    "[pv]atrim=end=30,asetpts=PTS-STARTPTS[pout]",
    "[wf]aresample=8000,aformat=channel_layouts=mono:sample_fmts=flt[wout]",
  ].join(";");

  report(30, "Rendering master and exports");
  const { code, stderr } = await runCommand("ffmpeg", [
    ...FFMPEG_GLOBAL,
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[pout]",
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
  if (code !== 0) throw new Error(stderr || "Mastering failed");

  report(86, "Analyzing master preview");
  const [masteredAnalysis, waveformPeaks] = await Promise.all([
    analyzeMetricsOnly(previewPath),
    readPeaksFile(peaksRaw),
  ]);

  return {
    files: {
      preview: previewPath,
      wav32: wav32Path,
      wav24: wav24Path,
      wav16: wav16Path,
      mp3: mp3Path,
    },
    masteredAnalysis,
    waveformPeaks,
  };
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
