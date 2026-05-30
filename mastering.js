import { state } from "./state.js";
import { analyzeAudioBuffer, estimateLoudnessDb, estimateTruePeakDb } from "./analysis.js";
import {
  computeAdaptiveCeiling,
  computeAdaptiveTarget,
  computeFinalizeGainDb,
  computePreGainDb,
  isEnhancementOnlyMode,
} from "./loudnessPolicy.js";
import { clamp, dbToLinear, linearToDb } from "./utils.js";

function makeWaveShaperCurve(amount) {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const drive = Math.max(0.01, amount);

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }

  return curve;
}

function trimLeadingSilence(buffer, threshold = 0.0008) {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const lookAhead = Math.floor(sampleRate * 0.02);
  let start = 0;

  scan: for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      if (Math.abs(buffer.getChannelData(c)[i]) > threshold) {
        start = Math.max(0, i - lookAhead);
        break scan;
      }
    }
  }

  if (start === 0) return buffer;
  const context = new OfflineAudioContext(channels, buffer.length - start, sampleRate);
  const trimmed = context.createBuffer(channels, buffer.length - start, sampleRate);
  for (let c = 0; c < channels; c += 1) {
    trimmed.copyToChannel(buffer.getChannelData(c).slice(start), c);
  }
  return trimmed;
}

export async function masterBuffer(inputBuffer, controls) {
  const sourceBuffer = controls.trimSilence ? trimLeadingSilence(inputBuffer) : inputBuffer;
  const sourceAnalysis = state.analysis ?? analyzeAudioBuffer(sourceBuffer);
  const dsp = buildMasteringSettings(sourceAnalysis, controls);
  const offline = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  );

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;

  const highPass = offline.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = dsp.highPassHz;
  highPass.Q.value = 0.7;

  const lowShelf = offline.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 105;
  lowShelf.gain.value = dsp.lowShelfDb;

  const lowMid = offline.createBiquadFilter();
  lowMid.type = "peaking";
  lowMid.frequency.value = 285;
  lowMid.Q.value = 0.82;
  lowMid.gain.value = dsp.mudCutDb;

  const highShelf = offline.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 9000;
  highShelf.gain.value = dsp.airDb;

  const preGain = offline.createGain();
  preGain.gain.value = dbToLinear(dsp.preGainDb);

  const saturator = offline.createWaveShaper();
  saturator.curve = makeWaveShaperCurve(dsp.saturationDrive);
  saturator.oversample = "4x";

  const saturationTrim = offline.createGain();
  saturationTrim.gain.value = dbToLinear(dsp.saturationTrimDb);

  const saturationDry = offline.createGain();
  saturationDry.gain.value = 1 - dsp.saturationWet;

  const saturationWet = offline.createGain();
  saturationWet.gain.value = dsp.saturationWet;

  const compressor = offline.createDynamicsCompressor();
  compressor.threshold.value = dsp.compressorThresholdDb;
  compressor.knee.value = 20;
  compressor.ratio.value = dsp.compressorRatio;
  compressor.attack.value = dsp.attackSeconds;
  compressor.release.value = dsp.releaseSeconds;

  const makeupGain = offline.createGain();
  makeupGain.gain.value = dbToLinear(dsp.makeupGainDb);

  const deHarsh = offline.createBiquadFilter();
  deHarsh.type = "lowpass";
  deHarsh.frequency.value = 19000;
  deHarsh.Q.value = 0.35;

  // Parallel saturation: dry path keeps transients while the wet (waveshaped)
  // path adds harmonics, both summing back into the compressor input.
  source
    .connect(highPass)
    .connect(lowShelf)
    .connect(lowMid)
    .connect(highShelf)
    .connect(preGain);
  preGain.connect(saturationDry).connect(compressor);
  preGain.connect(saturator).connect(saturationTrim).connect(saturationWet).connect(compressor);
  compressor.connect(makeupGain).connect(deHarsh).connect(offline.destination);

  source.start(0);
  const rendered = await offline.startRendering();
  return finalizeMaster(rendered, dsp.targetLoudness, dsp.ceilingDb, sourceAnalysis.loudnessDb);
}

export function getAdaptiveTarget(preset) {
  if (!state.analysis) return preset.targetLoudness;
  return computeAdaptiveTarget(preset, state.analysis);
}

export function getAdaptiveCeiling(preset) {
  return computeAdaptiveCeiling(preset, state.analysis);
}

function buildMasteringSettings(analysis, controls) {
  const intensity = controls.intensity;
  const warmth = controls.warmth;
  const air = controls.air;
  const lowCorrection = clamp((-12 - analysis.lowRatioDb) * 0.08, -0.7, 0.7);
  const highCorrection = clamp((-20 - analysis.highRatioDb) * -0.07, -0.7, 0.8);
  const loudnessGap = controls.targetLoudness - analysis.loudnessDb;
  const enhancementOnly = isEnhancementOnlyMode(analysis.loudnessDb, controls.targetLoudness);
  const mudIntensity = enhancementOnly ? intensity * 0.55 : intensity;

  return {
    targetLoudness: controls.targetLoudness,
    ceilingDb: controls.ceilingDb,
    highPassHz: analysis.lowRatioDb > -7 ? 32 : 25,
    lowShelfDb: clamp((warmth - 0.5) * 2 + lowCorrection + controls.bass * 2.1, -1.5, 1.6),
    mudCutDb: -clamp(0.12 + mudIntensity * 0.72 + Math.max(0, analysis.mudRatioDb + 7) * 0.06, 0.1, enhancementOnly ? 0.65 : 1.05),
    airDb: clamp((air - 0.5) * 2.2 + highCorrection, -1, 1.25),
    preGainDb: computePreGainDb(loudnessGap),
    saturationDrive: 1 + intensity * 0.18,
    saturationTrimDb: -0.05 - intensity * 0.12,
    saturationWet: clamp(intensity * 0.08, 0, 0.08),
    compressorThresholdDb: clamp(analysis.rmsDb + 7 - intensity * (enhancementOnly ? 2 : 3), -21, -12),
    compressorRatio: enhancementOnly ? 1.28 + intensity * 0.5 : 1.28 + intensity * 0.6,
    attackSeconds: 0.026,
    releaseSeconds: 0.15 + clamp((analysis.crestDb - 11) * 0.006, -0.02, 0.05),
    makeupGainDb: clamp(0.55 + intensity * 1.15 + Math.max(0, loudnessGap) * 0.08, 0.15, 2.6),
  };
}

function finalizeMaster(buffer, targetLoudness, ceilingDb, sourceLoudnessDb) {
  const loudness = estimateLoudnessDb(buffer);
  const truePeakDb = estimateTruePeakDb(buffer);
  const desiredGainDb = computeFinalizeGainDb({
    loudnessDb: loudness,
    targetLoudness,
    ceilingDb,
    truePeakDb,
    sourceLoudnessDb,
  });
  const gained = applyGain(buffer, dbToLinear(desiredGainDb));
  const limited = lookaheadLimit(gained, ceilingDb, 5, 110);
  const validated = normalizeToCeiling(limited, ceilingDb);
  const postTruePeakDb = estimateTruePeakDb(validated);
  if (postTruePeakDb > ceilingDb) {
    return applyGain(validated, dbToLinear(ceilingDb - postTruePeakDb));
  }
  return validated;
}

function normalizeToCeiling(buffer, ceilingDb) {
  const peak = dbToLinear(estimateTruePeakDb(buffer));
  const target = dbToLinear(ceilingDb);
  const gain = peak > 0 ? Math.min(target / peak, 1) : 1;
  return applyGain(buffer, gain);
}

function applyGain(buffer, gain) {
  const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const outputBuffer = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const input = buffer.getChannelData(c);
    const output = outputBuffer.getChannelData(c);
    for (let i = 0; i < input.length; i += 1) {
      output[i] = input[i] * gain;
    }
  }
  return outputBuffer;
}

// True-peak lookahead limiter. A monotonic deque tracks the maximum upcoming
// peak within the lookahead window so gain can duck before a transient hits,
// then recovers exponentially over the release time.
function lookaheadLimit(buffer, ceilingDb, lookaheadMs, releaseMs) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const ceiling = dbToLinear(ceilingDb);
  const lookahead = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  const release = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  const peaks = new Float32Array(length + lookahead + 2);
  const deque = new Int32Array(length + lookahead + 2);
  const context = new OfflineAudioContext(channels, length, sampleRate);
  const outputBuffer = context.createBuffer(channels, length, sampleRate);

  for (let i = 0; i < length; i += 1) {
    let samplePeak = 0;
    for (let c = 0; c < channels; c += 1) {
      samplePeak = Math.max(samplePeak, Math.abs(buffer.getChannelData(c)[i]));
    }
    peaks[i] = samplePeak;
  }

  let head = 0;
  let tail = 0;
  let gain = 1;
  const pushPeak = (index) => {
    if (index >= peaks.length) return;
    while (head < tail && peaks[deque[tail - 1]] <= peaks[index]) tail -= 1;
    deque[tail] = index;
    tail += 1;
  };

  for (let i = 0; i <= lookahead && i < peaks.length; i += 1) pushPeak(i);
  let minGain = 1;
  for (let i = 0; i < length; i += 1) {
    while (head < tail && deque[head] < i) head += 1;
    const futurePeak = peaks[deque[head]];
    const targetGain = futurePeak > ceiling ? ceiling / futurePeak : 1;
    gain = targetGain < gain ? targetGain : gain + (1 - gain) * release;
    minGain = Math.min(minGain, gain);
    for (let c = 0; c < channels; c += 1) {
      outputBuffer.getChannelData(c)[i] = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i] * gain));
    }
    pushPeak(i + lookahead + 1);
  }
  state.limiterReductionDb = linearToDb(minGain);
  return outputBuffer;
}
