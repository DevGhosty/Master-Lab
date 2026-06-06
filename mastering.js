import { state } from "./state.js";
import { analyzeAudioBuffer, estimateLoudnessDb, estimateTruePeakDb } from "./analysis.js";
import {
  computeAdaptiveCeiling,
  computeAdaptiveTarget,
  computeFinalizeGainDb,
  computePreGainDb,
  isEnhancementOnlyMode,
} from "./loudnessPolicy.js";
import { resolvePresetSpec } from "./presetSpec.js";
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

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
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
  lowShelf.frequency.value = dsp.lowShelfHz;
  lowShelf.gain.value = dsp.lowShelfDb;

  const lowMid = offline.createBiquadFilter();
  lowMid.type = "peaking";
  lowMid.frequency.value = dsp.mudCutHz;
  lowMid.Q.value = dsp.mudCutQ;
  lowMid.gain.value = dsp.mudCutDb;

  const highShelf = offline.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = dsp.highShelfHz;
  highShelf.gain.value = dsp.airDb;

  const presenceTame = offline.createBiquadFilter();
  presenceTame.type = "peaking";
  presenceTame.frequency.value = dsp.presenceTameHz;
  presenceTame.Q.value = dsp.presenceTameQ;
  presenceTame.gain.value = dsp.presenceTameDb;

  const toneTrim = offline.createGain();
  toneTrim.gain.value = dbToLinear(dsp.toneTrimDb);

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
  compressor.knee.value = dsp.compressorKneeDb;
  compressor.ratio.value = dsp.compressorRatio;
  compressor.attack.value = dsp.attackSeconds;
  compressor.release.value = dsp.releaseSeconds;

  const makeupGain = offline.createGain();
  makeupGain.gain.value = dbToLinear(dsp.makeupGainDb);

  const deHarsh = offline.createBiquadFilter();
  deHarsh.type = "lowpass";
  deHarsh.frequency.value = dsp.deHarshLowpassHz;
  deHarsh.Q.value = dsp.deHarshQ;

  // Conservative mastering chain: broad tone shaping first, tiny trim for EQ
  // boosts, then split loudness gain so quiet mixes rise without overdriving
  // already-loud sources into saturation or compression.
  source
    .connect(highPass)
    .connect(lowShelf)
    .connect(lowMid)
    .connect(highShelf)
    .connect(presenceTame)
    .connect(toneTrim)
    .connect(preGain);

  // Parallel saturation keeps transients on the dry path and adds only a small
  // harmonic layer on the wet path. It should feel like density, not distortion.
  preGain.connect(saturationDry).connect(compressor);
  preGain.connect(saturator).connect(saturationTrim).connect(saturationWet).connect(compressor);
  compressor.connect(makeupGain).connect(deHarsh).connect(offline.destination);

  source.start(0);
  const rendered = await offline.startRendering();
  return finalizeMaster(rendered, dsp, sourceAnalysis.loudnessDb);
}

export function getAdaptiveTarget(preset) {
  if (!state.analysis) return preset.targetLoudness;
  return computeAdaptiveTarget(preset, state.analysis);
}

export function getAdaptiveCeiling(preset) {
  return computeAdaptiveCeiling(preset, state.analysis);
}

function buildMasteringSettings(analysis, controls) {
  const presetSpec = resolvePresetSpec(controls.presetKey);
  const { eq, compressor: comp, saturation, gainStage } = presetSpec.dsp;
  const intensity = controls.intensity;
  const warmth = controls.warmth;
  const air = controls.air;
  const lowRatioDb = finiteOr(analysis.lowRatioDb, -12);
  const mudRatioDb = finiteOr(analysis.mudRatioDb, -8);
  const presenceRatioDb = finiteOr(analysis.presenceRatioDb, -18);
  const highRatioDb = finiteOr(analysis.highRatioDb, -20);
  const sourceLoudnessDb = finiteOr(analysis.loudnessDb, controls.targetLoudness);
  const rmsDb = finiteOr(analysis.rmsDb, sourceLoudnessDb - 6);
  const crestDb = finiteOr(analysis.crestDb, 10);
  const lowCorrection = clamp((-12 - lowRatioDb) * 0.07, -0.55, 0.55);
  const highCorrection = clamp((-20 - highRatioDb) * -0.055, -0.5, 0.55);
  const loudnessGap = controls.targetLoudness - sourceLoudnessDb;
  const enhancementOnly = isEnhancementOnlyMode(sourceLoudnessDb, controls.targetLoudness);
  const mudIntensity = enhancementOnly ? intensity * 0.55 : intensity;
  const lowShelfDb = clamp(
    (warmth - 0.5) * 1.4 + lowCorrection + controls.bass * 2.4,
    -1.2,
    controls.bass > 0.25 ? 1.8 : 1.35,
  );
  const mudCutDb = -clamp(
    0.1 + mudIntensity * 0.55 + Math.max(0, mudRatioDb + 7) * 0.08 + Math.max(0, controls.bass) * 0.65,
    0.1,
    enhancementOnly ? 0.75 : 1.25,
  );
  const airDb = clamp((air - 0.5) * 2 + highCorrection, -0.85, 1.05);
  const presenceTameDb = -clamp(
    Math.max(0, air - 0.55) * 1.15 +
      Math.max(0, presenceRatioDb + 15) * 0.05 +
      (highRatioDb > -16 ? 0.15 : 0),
    0,
    0.9,
  );
  const toneTrimDb = -clamp(
    Math.max(0, lowShelfDb) * 0.18 + Math.max(0, airDb) * 0.12 + Math.max(0, controls.bass) * 0.25,
    0,
    0.55,
  );
  const makeupMaxDb = enhancementOnly ? gainStage.enhancementMakeupMaxDb : gainStage.normalMakeupMaxDb;

  return {
    targetLoudness: controls.targetLoudness,
    ceilingDb: controls.ceilingDb,
    highPassHz: lowRatioDb > -7 ? eq.hotLowEndHighPassHz : eq.bassHighPassHz,
    lowShelfHz: eq.lowShelfHz,
    lowShelfDb,
    mudCutHz: controls.bass > 0.25 ? eq.bassMudCutHz : eq.mudCutHz,
    mudCutQ: eq.mudCutQ,
    mudCutDb,
    highShelfHz: eq.highShelfHz,
    airDb,
    presenceTameHz: eq.presenceTameHz,
    presenceTameQ: eq.presenceTameQ,
    presenceTameDb,
    deHarshLowpassHz: eq.deHarshLowpassHz,
    deHarshQ: eq.deHarshQ,
    toneTrimDb,
    preGainDb: computePreGainDb(loudnessGap, enhancementOnly, {
      share: gainStage.browserPreGainShare,
      maxPreGainDb: gainStage.maxPreGainDb,
    }),
    saturationDrive: saturation.driveBase + intensity * saturation.driveIntensity,
    saturationTrimDb: saturation.trimBaseDb + intensity * saturation.trimIntensityDb,
    saturationWet: clamp(intensity * saturation.wetIntensity, 0, saturation.maxWet),
    compressorThresholdDb: clamp(
      rmsDb + comp.thresholdBaseDb - intensity * (enhancementOnly ? comp.enhancementIntensityDb : comp.normalIntensityDb),
      comp.minThresholdDb,
      comp.maxThresholdDb,
    ),
    compressorRatio: enhancementOnly
      ? comp.enhancementBaseRatio + intensity * comp.enhancementIntensityRatio
      : comp.normalBaseRatio + intensity * comp.normalIntensityRatio,
    compressorKneeDb: comp.kneeDb,
    attackSeconds: comp.attackMs / 1000,
    releaseSeconds: comp.releaseMs / 1000 + clamp((crestDb - 11) * 0.007, -0.025, 0.06),
    makeupGainDb: clamp(0.25 + intensity * 0.7 + Math.max(0, loudnessGap) * 0.035, 0.05, makeupMaxDb),
    limiterAttackMs: presetSpec.dsp.limiter.attackMs,
    limiterReleaseMs: presetSpec.dsp.limiter.releaseMs,
  };
}

function finalizeMaster(buffer, dsp, sourceLoudnessDb) {
  const loudness = estimateLoudnessDb(buffer);
  const truePeakDb = estimateTruePeakDb(buffer, { mode: "accurate" });
  const desiredGainDb = computeFinalizeGainDb({
    loudnessDb: loudness,
    targetLoudness: dsp.targetLoudness,
    ceilingDb: dsp.ceilingDb,
    truePeakDb,
    sourceLoudnessDb,
  });
  const gained = applyGain(buffer, dbToLinear(desiredGainDb));
  const limited = lookaheadLimit(gained, dsp.ceilingDb, dsp.limiterAttackMs, dsp.limiterReleaseMs);
  const validated = normalizeToCeiling(limited, dsp.ceilingDb);
  const postTruePeakDb = estimateTruePeakDb(validated, { mode: "accurate" });
  if (postTruePeakDb > dsp.ceilingDb) {
    return applyGain(validated, dbToLinear(dsp.ceilingDb - postTruePeakDb));
  }
  return validated;
}

function normalizeToCeiling(buffer, ceilingDb) {
  const peak = dbToLinear(estimateTruePeakDb(buffer, { mode: "accurate" }));
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
