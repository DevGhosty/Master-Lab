import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeAudioBuffer, estimateTruePeakDb } from "../../analysis.js";
import { analyzeAudioFile, masterToFiles, measureIntegratedLoudness, probeAudioFile, runCommand } from "../src/ffmpeg.js";
import { buildMasterFilter } from "../src/presets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, ".generated-audio");
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;

function dbToLinear(db) {
  return 10 ** (db / 20);
}

function nearly(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function fixturePath(name) {
  return path.join(FIXTURE_DIR, `${name}.wav`);
}

function makeChannels(length, renderSample) {
  const channels = Array.from({ length: CHANNELS }, () => new Float32Array(length));
  for (let i = 0; i < length; i += 1) {
    const frame = renderSample(i);
    for (let c = 0; c < CHANNELS; c += 1) {
      channels[c][i] = Math.max(-1, Math.min(1, frame[c] ?? frame[0] ?? 0));
    }
  }
  return channels;
}

function sineFrame(frequency, amplitude, phase = 0) {
  return (i) => {
    const sample = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE + phase);
    return [sample, sample];
  };
}

function audioBufferFromChannels(channels, sampleRate = SAMPLE_RATE) {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length || 0,
    getChannelData(index) {
      return channels[index];
    },
  };
}

async function writePcm16Wav(filePath, channels, sampleRate = SAMPLE_RATE) {
  const channelCount = channels.length;
  const frameCount = channels[0]?.length || 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const intSample = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, intSample)), offset);
      offset += bytesPerSample;
    }
  }

  await fs.writeFile(filePath, buffer);
}

async function createFixtures() {
  await fs.rm(FIXTURE_DIR, { recursive: true, force: true });
  await fs.mkdir(FIXTURE_DIR, { recursive: true });

  const fixtures = {};
  const addFixture = async (name, channels) => {
    const file = fixturePath(name);
    await writePcm16Wav(file, channels);
    fixtures[name] = {
      file,
      buffer: audioBufferFromChannels(channels),
    };
  };

  await addFixture("silence", makeChannels(SAMPLE_RATE, () => [0, 0]));

  await addFixture(
    "sine-known-peak",
    makeChannels(SAMPLE_RATE * 3, sineFrame(997, dbToLinear(-6))),
  );

  await addFixture(
    "clipped-sine",
    makeChannels(SAMPLE_RATE * 3, (i) => {
      const sample = Math.max(-1, Math.min(1, 1.25 * Math.sin((2 * Math.PI * 997 * i) / SAMPLE_RATE)));
      return [sample, sample];
    }),
  );

  await addFixture(
    "stereo-phase",
    makeChannels(SAMPLE_RATE * 2, (i) => {
      const sample = dbToLinear(-9) * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
      return [sample, -sample];
    }),
  );

  await addFixture(
    "trimmed-silence",
    makeChannels(Math.round(SAMPLE_RATE * 2.5), (i) => {
      const t = i / SAMPLE_RATE;
      if (t < 0.5 || t >= 1.75) return [0, 0];
      const sample = dbToLinear(-9) * Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE);
      return [sample, sample];
    }),
  );

  await addFixture(
    "inter-sample-peak",
    makeChannels(SAMPLE_RATE * 3, sineFrame(15_000, dbToLinear(-1.2))),
  );

  await addFixture(
    "inter-sample-peak-low-fast-miss",
    makeChannels(SAMPLE_RATE * 3, sineFrame(12_000, 0.2, Math.PI / 4)),
  );

  return fixtures;
}

let fixtures;
let ffmpegAvailable = false;

before(async () => {
  try {
    const { code } = await runCommand("ffmpeg", ["-version"], { timeoutMs: 10_000 });
    ffmpegAvailable = code === 0;
  } catch {
    ffmpegAvailable = false;
  }
  fixtures = await createFixtures();
});

function skipWithoutFfmpeg(t) {
  if (!ffmpegAvailable) {
    t.skip("FFmpeg is not installed on PATH; server/reference audio checks skipped");
    return true;
  }
  return false;
}

describe("audio analysis fixtures", () => {
  test("generated WAV fixtures are probeable and deterministic", async () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      const stat = await fs.stat(fixture.file);
      assert.ok(stat.size > 44, `${name} wav size`);
      assert.equal(fixture.buffer.numberOfChannels, CHANNELS, `${name} channel count`);
      assert.equal(fixture.buffer.sampleRate, SAMPLE_RATE, `${name} sample rate`);
      assert.ok(fixture.buffer.length > 0, `${name} buffer length`);
    }
  });

  test("FFmpeg can probe generated fixtures", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    for (const [name, fixture] of Object.entries(fixtures)) {
      const probe = await probeAudioFile(fixture.file);
      assert.equal(probe.channels, CHANNELS, `${name} channel count`);
      assert.equal(probe.sampleRate, SAMPLE_RATE, `${name} sample rate`);
      assert.ok(probe.duration > 0, `${name} duration`);
    }
  });

  test("silence is silent in browser analysis", () => {
    const fixture = fixtures.silence;
    const browser = analyzeAudioBuffer(fixture.buffer);

    assert.equal(browser.peak, 0);
    assert.equal(browser.clippingSamples, 0);
    assert.equal(browser.loudnessDb, -Infinity);
    assert.equal(browser.truePeakDb, -Infinity);
  });

  test("silence is silent in server analysis", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    const server = await analyzeAudioFile(fixtures.silence.file);
    assert.equal(server.analysis.peak, 0);
    assert.equal(server.analysis.clippingSamples, 0);
    assert.ok(server.waveformPeaks.every((point) => point.min === 0 && point.max === 0));
  });

  test("simple sine has expected browser peak and stable loudness estimate", () => {
    const fixture = fixtures["sine-known-peak"];
    const browser = analyzeAudioBuffer(fixture.buffer);

    nearly(browser.peakDb, -6, 0.05, "known sample peak");
    nearly(browser.truePeakDb, -6, 0.1, "browser true peak for simple sine");
    assert.ok(Number.isFinite(browser.loudnessDb), "browser LUFS is finite");
  });

  test("browser LUFS and true peak match FFmpeg on a simple sine", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    const fixture = fixtures["sine-known-peak"];
    const browser = analyzeAudioBuffer(fixture.buffer);
    const reference = await measureIntegratedLoudness(fixture.file);
    const server = await analyzeAudioFile(fixture.file);

    nearly(browser.loudnessDb, reference.input_i, 0.2, "browser LUFS vs FFmpeg ebur128");
    nearly(browser.truePeakDb, reference.input_tp, 0.2, "browser true peak vs FFmpeg ebur128");
    nearly(server.analysis.loudnessDb, reference.input_i, 0.05, "server LUFS vs FFmpeg ebur128");
    nearly(server.analysis.truePeakDb, reference.input_tp, 0.05, "server true peak vs FFmpeg ebur128");
  });

  test("clipped sine reports browser clipping and near-full-scale true peak", () => {
    const fixture = fixtures["clipped-sine"];
    const browser = analyzeAudioBuffer(fixture.buffer);

    assert.ok(browser.clippingSamples > 0, "browser clipping count");
    assert.ok(browser.clippingRatio > 0.05, "browser clipping ratio");
    assert.ok(browser.truePeakDb >= -0.1, "browser true peak near 0 dBTP");
  });

  test("clipped sine reports server clipping and near-full-scale true peak", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    const server = await analyzeAudioFile(fixtures["clipped-sine"].file);

    assert.ok(server.analysis.clippingSamples > 0, "server clipping count");
    assert.ok(server.analysis.clippingRatio > 0.05, "server clipping ratio");
    assert.ok(server.analysis.truePeakDb >= -0.1, "server true peak near 0 dBTP");
  });

  test("stereo phase fixture reports negative browser correlation", () => {
    const browser = analyzeAudioBuffer(fixtures["stereo-phase"].buffer);
    assert.ok(browser.stereoCorrelation < -0.99, `correlation was ${browser.stereoCorrelation}`);
  });

  test("browser leading and trailing silence are detected", () => {
    const fixture = fixtures["trimmed-silence"];
    const browser = analyzeAudioBuffer(fixture.buffer);

    nearly(browser.leadingSilenceSeconds, 0.5, 0.01, "browser leading silence");
    nearly(browser.trailingSilenceSeconds, 0.75, 0.01, "browser trailing silence");
  });

  test("server leading and trailing silence plus waveform are detected", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    const server = await analyzeAudioFile(fixtures["trimmed-silence"].file);

    nearly(server.analysis.leadingSilenceSeconds, 0.5, 0.05, "server leading silence");
    nearly(server.analysis.trailingSilenceSeconds, 0.75, 0.05, "server trailing silence");
    assert.ok(server.waveformPeaks.length > 100, "waveform peak count");
    assert.ok(server.waveformPeaks.some((point) => Math.max(Math.abs(point.min), Math.abs(point.max)) > 0.2));
  });

  test("inter-sample peak stress fixture raises browser true peak above sample peak", () => {
    const fixture = fixtures["inter-sample-peak"];
    const browser = analyzeAudioBuffer(fixture.buffer);
    const accurateTruePeakDb = estimateTruePeakDb(fixture.buffer, { mode: "accurate" });

    assert.ok(browser.truePeakDb > browser.peakDb, "browser true peak should exceed sample peak");
    nearly(browser.truePeakDb, accurateTruePeakDb, 0.2, "fast and accurate agree on loud stress fixture");
  });

  test("accurate true-peak mode catches full-signal inter-sample peaks fast mode can miss", () => {
    const fixture = fixtures["inter-sample-peak-low-fast-miss"];
    const browser = analyzeAudioBuffer(fixture.buffer);
    const fastTruePeakDb = estimateTruePeakDb(fixture.buffer, { mode: "fast" });
    const accurateTruePeakDb = estimateTruePeakDb(fixture.buffer, { mode: "accurate" });

    assert.equal(browser.truePeakDb, fastTruePeakDb, "public analysis metric keeps using fast mode");
    assert.ok(
      accurateTruePeakDb - fastTruePeakDb > 2.5,
      `expected accurate mode to exceed fast mode by >2.5 dB, got fast=${fastTruePeakDb}, accurate=${accurateTruePeakDb}`,
    );
  });

  test("inter-sample peak stress fixture stays close to FFmpeg true-peak reference", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    const fixture = fixtures["inter-sample-peak"];
    const browser = analyzeAudioBuffer(fixture.buffer);
    const reference = await measureIntegratedLoudness(fixture.file);

    assert.ok(reference.input_tp > browser.peakDb, "FFmpeg true peak should exceed sample peak");
    nearly(browser.truePeakDb, reference.input_tp, 0.35, "browser inter-sample true peak vs FFmpeg");
  });

  test("server analysis and mastering ignore MP3 attached artwork streams", async (t) => {
    if (skipWithoutFfmpeg(t)) return;
    const coverPath = path.join(FIXTURE_DIR, "cover.jpg");
    const mp3Path = path.join(FIXTURE_DIR, "attached-artwork.mp3");
    const masterDir = path.join(FIXTURE_DIR, "attached-artwork-master");
    await fs.mkdir(masterDir, { recursive: true });

    await runCommand("ffmpeg", [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:d=0.1",
      "-frames:v",
      "1",
      "-update",
      "1",
      coverPath,
    ]);
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      fixtures["sine-known-peak"].file,
      "-i",
      coverPath,
      "-map",
      "0:a:0",
      "-map",
      "1:v:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "320k",
      "-c:v",
      "mjpeg",
      "-disposition:v:0",
      "attached_pic",
      "-id3v2_version",
      "3",
      mp3Path,
    ]);

    const probe = await probeAudioFile(mp3Path);
    const reference = await measureIntegratedLoudness(mp3Path);
    const server = await analyzeAudioFile(mp3Path);
    const filter = buildMasterFilter(
      "warm",
      { intensity: 0.32, warmth: 0.5, air: 0.5, ceilingDb: -1.2, targetLoudness: -14.8 },
      server.analysis,
    );
    const mastered = await masterToFiles(mp3Path, masterDir, filter, null, {
      ceilingDb: -1.2,
      sourceLufs: server.analysis.loudnessDb,
    });

    assert.equal(probe.codec, "mp3");
    assert.ok(Number.isFinite(reference.input_i), "artwork MP3 loudness reference");
    assert.ok(Number.isFinite(reference.input_tp), "artwork MP3 true peak reference");
    assert.ok(Number.isFinite(server.analysis.crestDb), "artwork MP3 server crest metric");
    assert.ok(mastered.waveformPeaks.length > 100, "artwork MP3 mastered waveform");
    assert.ok(Number.isFinite(mastered.masteredAnalysis.truePeakDb), "artwork MP3 mastered true peak");
  });
});
