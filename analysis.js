import {
  COPY,
  CLIPPING_THRESHOLD,
  TRUE_PEAK_OVERSAMPLE,
  LUFS_ABSOLUTE_GATE,
  LUFS_RELATIVE_GATE_OFFSET,
} from "./constants.js";
import { clamp, linearToDb, mixDown, isLossyFile } from "./utils.js";

export function analyzeAudioBuffer(buffer) {
  const mono = mixDown(buffer);
  const maxSamples = 250000;
  const step = Math.max(1, Math.ceil(mono.length / maxSamples));
  const effectiveSampleRate = buffer.sampleRate / step;
  const fullRms = getRms(buffer);
  const peak = getPeak(buffer);
  const lufs = estimateLoudnessDb(buffer);
  const truePeakDb = estimateTruePeakDb(buffer);
  const lowRms = getOnePoleLowpassRms(mono, effectiveSampleRate, step, 160);
  const lowMidRms = getBandpassRms(mono, effectiveSampleRate, step, 180, 520);
  const midRms = getBandpassRms(mono, effectiveSampleRate, step, 520, 2400);
  const presenceRms = getBandpassRms(mono, effectiveSampleRate, step, 2400, 6200);
  const highRms = getOnePoleHighpassRms(mono, effectiveSampleRate, step, 6200);
  const clippingSamples = countClippingSamples(buffer);
  const rmsDb = linearToDb(fullRms);
  const peakDb = linearToDb(peak);
  const silence = detectSilence(buffer);
  const dcOffset = getDcOffset(buffer);

  return {
    rms: fullRms,
    peak,
    rmsDb,
    peakDb,
    truePeakDb,
    loudnessDb: lufs,
    crestDb: peakDb - rmsDb,
    lowRatioDb: linearToDb(lowRms / Math.max(fullRms, 1e-9)),
    mudRatioDb: linearToDb(lowMidRms / Math.max(fullRms, 1e-9)),
    midRatioDb: linearToDb(midRms / Math.max(fullRms, 1e-9)),
    presenceRatioDb: linearToDb(presenceRms / Math.max(fullRms, 1e-9)),
    highRatioDb: linearToDb(highRms / Math.max(fullRms, 1e-9)),
    dcOffset,
    dcOffsetDb: linearToDb(Math.abs(dcOffset)),
    stereoCorrelation: getStereoCorrelation(buffer),
    leadingSilenceSeconds: silence.leading,
    trailingSilenceSeconds: silence.trailing,
    clippingSamples,
    clippingRatio: clippingSamples / Math.max(1, buffer.length * buffer.numberOfChannels),
  };
}

// ITU-R BS.1770 style loudness: K-weight each channel, integrate in 400 ms
// blocks, then apply absolute (-70 LUFS) and relative (-10 LU) gating.
export function estimateLoudnessDb(buffer) {
  const sampleRate = buffer.sampleRate;
  const blockSize = Math.max(1, Math.round(sampleRate * 0.4));
  const blockCount = Math.max(1, Math.ceil(buffer.length / blockSize));
  const blockEnergies = new Float64Array(blockCount);

  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    const highpass = createBiquadState(makeHighpassCoefficients(38, 0.5, sampleRate));
    const highShelf = createBiquadState(makeHighShelfCoefficients(1681.974, 4, 0.707, sampleRate));
    const channelWeight = c < 3 ? 1 : 1.41;
    for (let i = 0; i < data.length; i += 1) {
      const weighted = processBiquad(processBiquad(data[i], highpass), highShelf);
      blockEnergies[Math.floor(i / blockSize)] += channelWeight * weighted * weighted;
    }
  }

  const energies = Array.from(blockEnergies, (energy, index) => {
    const frames = Math.min(blockSize, buffer.length - index * blockSize);
    return energy / Math.max(1, frames);
  }).filter((energy) => energy > 0);

  if (!energies.length) return -Infinity;

  const absoluteGate = dbToEnergy(LUFS_ABSOLUTE_GATE);
  const absoluteGated = energies.filter((energy) => energy > absoluteGate);
  if (!absoluteGated.length) return -Infinity;

  const preliminary = energyToLufs(mean(absoluteGated));
  const relativeGate = dbToEnergy(preliminary + LUFS_RELATIVE_GATE_OFFSET);
  const gated = absoluteGated.filter((energy) => energy > Math.max(absoluteGate, relativeGate));
  return gated.length ? energyToLufs(mean(gated)) : preliminary;
}

// Inter-sample true peak: only oversample around samples that are already loud
// enough to plausibly produce a reconstruction peak above the sample peak.
export function estimateTruePeakDb(buffer) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    let previous = data[0] ?? 0;
    peak = Math.max(peak, Math.abs(previous));
    for (let i = 1; i < data.length; i += 1) {
      const current = data[i];
      peak = Math.max(peak, Math.abs(current));
      if (Math.max(Math.abs(previous), Math.abs(current)) > 0.25) {
        for (let j = 1; j < TRUE_PEAK_OVERSAMPLE; j += 1) {
          const t = j / TRUE_PEAK_OVERSAMPLE;
          const interpolated = sincInterpolate(data, i - 1 + t, 8);
          peak = Math.max(peak, Math.abs(interpolated));
        }
      }
      previous = current;
    }
  }
  return linearToDb(peak);
}

function sincInterpolate(samples, position, radius) {
  const center = Math.floor(position);
  let sum = 0;
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = center + offset;
    if (index < 0 || index >= samples.length) continue;
    const x = position - index;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / (radius + 1));
    const weight = sinc * window;
    sum += samples[index] * weight;
    weightSum += weight;
  }
  return weightSum ? sum / weightSum : 0;
}

function makeHighpassCoefficients(frequency, q, sampleRate) {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return normalizeBiquad({ b0, b1, b2, a0, a1, a2 });
}

function makeHighShelfCoefficients(frequency, gainDb, slope, sampleRate) {
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = (sin / 2) * Math.sqrt((a + 1 / a) * (1 / slope - 1) + 2);
  const beta = 2 * Math.sqrt(a) * alpha;
  const b0 = a * ((a + 1) + (a - 1) * cos + beta);
  const b1 = -2 * a * ((a - 1) + (a + 1) * cos);
  const b2 = a * ((a + 1) + (a - 1) * cos - beta);
  const a0 = (a + 1) - (a - 1) * cos + beta;
  const a1 = 2 * ((a - 1) - (a + 1) * cos);
  const a2 = (a + 1) - (a - 1) * cos - beta;
  return normalizeBiquad({ b0, b1, b2, a0, a1, a2 });
}

function normalizeBiquad(coefficients) {
  return {
    b0: coefficients.b0 / coefficients.a0,
    b1: coefficients.b1 / coefficients.a0,
    b2: coefficients.b2 / coefficients.a0,
    a1: coefficients.a1 / coefficients.a0,
    a2: coefficients.a2 / coefficients.a0,
  };
}

function createBiquadState(coefficients) {
  return { ...coefficients, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquad(input, biquad) {
  const output =
    biquad.b0 * input +
    biquad.b1 * biquad.x1 +
    biquad.b2 * biquad.x2 -
    biquad.a1 * biquad.y1 -
    biquad.a2 * biquad.y2;
  biquad.x2 = biquad.x1;
  biquad.x1 = input;
  biquad.y2 = biquad.y1;
  biquad.y1 = output;
  return output;
}

function dbToEnergy(db) {
  return Math.pow(10, (db + 0.691) / 10);
}

function energyToLufs(energy) {
  return -0.691 + 10 * Math.log10(Math.max(energy, 1e-12));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function countClippingSamples(buffer) {
  let clipped = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      if (Math.abs(data[i]) >= CLIPPING_THRESHOLD) clipped += 1;
    }
  }
  return clipped;
}

function getRms(buffer) {
  let total = 0;
  let count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      total += data[i] * data[i];
    }
    count += data.length;
  }
  return Math.sqrt(total / Math.max(1, count));
}

function getPeak(buffer) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  return peak;
}

function getDcOffset(buffer) {
  let total = 0;
  let count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      total += data[i];
    }
    count += data.length;
  }
  return total / Math.max(1, count);
}

function getStereoCorrelation(buffer) {
  if (buffer.numberOfChannels < 2) return null;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const step = Math.max(1, Math.ceil(left.length / 500000));
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  for (let i = 0; i < left.length; i += step) {
    sumLR += left[i] * right[i];
    sumL2 += left[i] * left[i];
    sumR2 += right[i] * right[i];
  }
  const denominator = Math.sqrt(sumL2 * sumR2);
  return denominator > 0 ? clamp(sumLR / denominator, -1, 1) : null;
}

function detectSilence(buffer, threshold = 0.0005) {
  const isSilentFrame = (index) => {
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      if (Math.abs(buffer.getChannelData(c)[index]) > threshold) return false;
    }
    return true;
  };

  let leading = 0;
  while (leading < buffer.length && isSilentFrame(leading)) leading += 1;

  let trailing = buffer.length - 1;
  while (trailing > leading && isSilentFrame(trailing)) trailing -= 1;

  return {
    leading: leading / buffer.sampleRate,
    trailing: Math.max(0, buffer.length - 1 - trailing) / buffer.sampleRate,
  };
}

function getOnePoleLowpassRms(samples, sampleRate, step, cutoff) {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    y += alpha * (samples[i] - y);
    sum += y * y;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function getOnePoleHighpassRms(samples, sampleRate, step, cutoff) {
  const alpha = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let low = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    low = (1 - alpha) * samples[i] + alpha * low;
    const high = samples[i] - low;
    sum += high * high;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function getBandpassRms(samples, sampleRate, step, lowCutoff, highCutoff) {
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowCutoff) / sampleRate);
  const highAlpha = 1 - Math.exp((-2 * Math.PI * highCutoff) / sampleRate);
  let low = 0;
  let high = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    low += lowAlpha * (samples[i] - low);
    high += highAlpha * (samples[i] - high);
    const band = high - low;
    sum += band * band;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

export function parseBitDepth(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 36) return null;
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && chunkSize >= 16) {
      return view.getUint16(offset + 22, true);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

function readAscii(view, offset, length) {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function warningFromCopy(copyKey, level, extraText = "") {
  const copy = COPY.warnings[copyKey];
  const tryLine = copy.try ? ` ${copy.try}` : "";
  return {
    level,
    title: copy.title,
    text: extraText ? `${copy.text} ${extraText}` : `${copy.text}${tryLine}`,
  };
}

export function buildWarnings(file, buffer, analysis) {
  const warnings = [];

  if (isLossyFile(file)) {
    warnings.push(warningFromCopy("lossy", "minor"));
  }
  if (analysis.peak < 0.00001 || !Number.isFinite(analysis.rmsDb)) {
    warnings.push(warningFromCopy("silent", "major"));
  }
  if (analysis.loudnessDb < -32) {
    warnings.push(warningFromCopy("quiet", "minor"));
  }
  if (analysis.loudnessDb > -10 || analysis.peakDb > -0.5) {
    warnings.push(warningFromCopy("loud", "minor"));
  }
  if (analysis.truePeakDb > -0.2) {
    warnings.push(warningFromCopy("truePeak", "minor"));
  }
  if (analysis.clippingSamples > 0) {
    warnings.push(warningFromCopy("clipping", analysis.clippingRatio > 0.001 ? "major" : "minor"));
  }
  if (buffer.numberOfChannels === 1) {
    warnings.push(warningFromCopy("mono", "minor"));
  }
  if (buffer.sampleRate < 44100) {
    warnings.push(warningFromCopy("lowSampleRate", "minor"));
  }
  if (analysis.leadingSilenceSeconds > 3 || analysis.trailingSilenceSeconds > 8) {
    warnings.push(warningFromCopy("silence", "minor"));
  }
  if (Number.isFinite(analysis.stereoCorrelation) && analysis.stereoCorrelation < -0.2) {
    warnings.push(warningFromCopy("phase", "minor"));
  }
  if (analysis.crestDb < 6 && analysis.loudnessDb > -12) {
    warnings.push(warningFromCopy("overLimited", "minor"));
  }

  return warnings;
}

export function getReadiness(warnings, analysis) {
  const majorWarnings = warnings.filter((w) => w.level === "major");
  if (majorWarnings.length > 0 || analysis.peak < 0.00001) {
    if (analysis.peak < 0.00001) {
      return {
        status: "Major issues detected",
        level: "major",
        copy: "No usable audio was detected. Upload a file with audible signal before mastering.",
        nextStep: COPY.readiness.majorSilent,
      };
    }
    const hasClipping = majorWarnings.some((w) => w.title.includes("clipping"));
    return {
      status: "Major issues detected",
      level: "major",
      copy: "Fix the major issue below for the best result. Mastering stays disabled until the file is usable.",
      nextStep: hasClipping ? COPY.readiness.majorClipping : COPY.readiness.majorGeneric,
    };
  }
  if (warnings.length > 0) {
    return {
      status: "Minor issues detected",
      level: "minor",
      copy: `${warnings.length} note${warnings.length === 1 ? "" : "s"} below—you can still master.`,
      nextStep: COPY.readiness.minorNext(warnings.length),
    };
  }
  return {
    status: "Good to master",
    level: "good",
    copy: "This file looks ready for mastering.",
    nextStep: COPY.readiness.goodNext,
  };
}
