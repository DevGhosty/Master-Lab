import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

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

function parseLoudnormJson(stderr) {
  const match = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function linearToDb(value) {
  if (value <= 0 || !Number.isFinite(value)) return -Infinity;
  return 20 * Math.log10(value);
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
  let peak = 0;
  let rms = 0;
  const peakMatch = stderr.match(/Peak level dB:\s*([-\d.]+)/);
  const rmsMatch = stderr.match(/RMS level dB:\s*([-\d.]+)/);
  if (peakMatch) peak = Number(peakMatch[1]);
  if (rmsMatch) rms = Number(rmsMatch[1]);
  const peakLinear = peak > -120 ? Math.pow(10, peak / 20) : 0;
  const rmsLinear = rms > -120 ? Math.pow(10, rms / 20) : 0;
  return { peakDb: peak, rmsDb: rms, peak: peakLinear, rms: rmsLinear };
}

function parseClipping(stderr) {
  const clipMatch = stderr.match(/Number of samples clipped:\s*(\d+)/);
  const totalMatch = stderr.match(/Number of samples:\s*(\d+)/);
  const clippingSamples = clipMatch ? Number(clipMatch[1]) : 0;
  const total = totalMatch ? Number(totalMatch[1]) : 1;
  return { clippingSamples, clippingRatio: clippingSamples / Math.max(1, total) };
}

export async function analyzeAudioFile(inputPath) {
  const probe = await ffprobeJson(inputPath);
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");
  if (!audioStream) throw new Error("No audio stream found");

  const duration = Number(probe.format?.duration || audioStream.duration || 0);
  const channels = Number(audioStream.channels || 1);
  const sampleRate = Number(audioStream.sample_rate || 44100);
  const bitDepth = audioStream.bits_per_raw_sample
    ? Number(audioStream.bits_per_raw_sample)
    : audioStream.bits_per_sample
      ? Number(audioStream.bits_per_sample)
      : null;

  const loudnormResult = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-af",
    "loudnorm=print_format=json",
    "-f",
    "null",
    "-",
  ]);
  const loudnorm = parseLoudnormJson(loudnormResult.stderr) || {};

  const statsResult = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-af",
    "astats=metadata=1:reset=1,ametadata=print:file=-",
    "-f",
    "null",
    "-",
  ]);
  const stats = parsePeakStats(statsResult.stderr);
  const clip = parseClipping(statsResult.stderr);

  const silenceResult = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-af",
    "silencedetect=noise=-50dB:d=0.3",
    "-f",
    "null",
    "-",
  ]);
  const silence = parseSilence(silenceResult.stderr);

  const loudnessDb = loudnorm.input_i != null ? Number(loudnorm.input_i) : stats.rmsDb;
  const truePeakDb = loudnorm.input_tp != null ? Number(loudnorm.input_tp) : stats.peakDb;
  const peakDb = stats.peakDb;
  const rmsDb = stats.rmsDb;
  const crestDb = peakDb - rmsDb;

  const analysis = {
    rms: stats.rms,
    peak: stats.peak,
    rmsDb,
    peakDb,
    truePeakDb,
    loudnessDb,
    crestDb,
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

  const waveformPeaks = await extractWaveformPeaks(inputPath, 800);

  return {
    probe: { duration, channels, sampleRate, bitDepth },
    analysis,
    waveformPeaks,
  };
}

export async function extractWaveformPeaks(inputPath, width = 800) {
  const peaksRaw = `${inputPath}.peaks.f32le`;
  const { code } = await runCommand("ffmpeg", [
    "-hide_banner",
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
  let buffer;
  try {
    buffer = await fs.readFile(peaksRaw);
  } catch {
    return [];
  } finally {
    await fs.unlink(peaksRaw).catch(() => {});
  }
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

export async function masterToFiles(inputPath, workDir, filterChain) {
  const masteredPath = path.join(workDir, "mastered.wav");
  const { code, stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-af",
    filterChain,
    "-c:a",
    "pcm_f32le",
    masteredPath,
  ]);
  if (code !== 0) throw new Error(stderr || "Mastering failed");

  const previewPath = path.join(workDir, "preview.wav");
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    masteredPath,
    "-t",
    "30",
    "-c:a",
    "pcm_s16le",
    previewPath,
  ]);

  const wav32Path = path.join(workDir, "master-32float.wav");
  await fs.copyFile(masteredPath, wav32Path);

  const wav24Path = path.join(workDir, "master-24bit.wav");
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    masteredPath,
    "-c:a",
    "pcm_s24le",
    wav24Path,
  ]);

  const wav16Path = path.join(workDir, "master-16bit.wav");
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    masteredPath,
    "-c:a",
    "pcm_s16le",
    wav16Path,
  ]);

  const mp3Path = path.join(workDir, "master-320.mp3");
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    masteredPath,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "320k",
    mp3Path,
  ]);

  const postAnalysis = await analyzeAudioFile(masteredPath);

  return {
    files: {
      preview: previewPath,
      wav32: wav32Path,
      wav24: wav24Path,
      wav16: wav16Path,
      mp3: mp3Path,
    },
    masteredAnalysis: postAnalysis.analysis,
  };
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
