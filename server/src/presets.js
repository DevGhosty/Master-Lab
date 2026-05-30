import {
  computeAdaptiveCeiling,
  computeAdaptiveTarget,
  isEnhancementOnlyMode,
} from "./loudnessPolicy.js";

/** FFmpeg-oriented preset targets, kept aligned with the browser presets. */
export const PRESETS = {
  balanced: {
    targetLoudness: -14.5,
    ceilingDb: -1.2,
    intensity: 0.34,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
  },
  loud: {
    targetLoudness: -12.3,
    ceilingDb: -1.4,
    intensity: 0.54,
    warmth: 0.47,
    air: 0.48,
    bass: 0,
  },
  warm: {
    targetLoudness: -14.8,
    ceilingDb: -1.2,
    intensity: 0.32,
    warmth: 0.64,
    air: 0.43,
    bass: 0.1,
  },
  bright: {
    targetLoudness: -14.5,
    ceilingDb: -1.2,
    intensity: 0.34,
    warmth: 0.46,
    air: 0.62,
    bass: -0.03,
  },
  bass: {
    targetLoudness: -14.4,
    ceilingDb: -1.4,
    intensity: 0.36,
    warmth: 0.58,
    air: 0.48,
    bass: 0.42,
  },
  streaming: {
    targetLoudness: -14,
    ceilingDb: -1.2,
    intensity: 0.32,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function pushVolume(parts, gainDb) {
  if (Math.abs(gainDb) > 0.01) {
    parts.push(`volume=${gainDb.toFixed(2)}dB`);
  }
}

/**
 * Build mastering filter chain for FFmpeg (-af).
 * Preserve-level policy: avoid reducing already-loud sources, and split quiet
 * source gain around dynamics so the compressor is not doing all the loudness work.
 */
export function buildMasterFilter(presetKey, controls = {}, options = {}) {
  const preset = PRESETS[presetKey] || PRESETS.streaming;
  const intensity = clamp(Number(controls.intensity ?? preset.intensity), 0, 1);
  const warmth = clamp(Number(controls.warmth ?? preset.warmth), 0, 1);
  const air = clamp(Number(controls.air ?? preset.air), 0, 1);
  const bass = Number(controls.bass ?? preset.bass);

  const presetTarget = Number.isFinite(Number(controls.targetLoudness))
    ? Number(controls.targetLoudness)
    : preset.targetLoudness;
  const tp = Number.isFinite(Number(controls.ceilingDb))
    ? Number(controls.ceilingDb)
    : preset.ceilingDb;

  const measuredLufs = options.measuredLufs;
  const effectiveTarget = options.effectiveTargetLufs ?? presetTarget;
  const enhancementOnly = options.enhancementOnly === true;

  const highpass = `highpass=f=${bass > 0.25 ? 26 : 30}`;
  const bassDb = clamp((warmth - 0.5) * 1.4 + bass * 2.4, -1.2, bass > 0.25 ? 1.8 : 1.35);
  const airDb = clamp((air - 0.5) * 2, -0.85, 1.05);
  const lowShelf = `lowshelf=f=90:g=${bassDb.toFixed(2)}`;
  const highShelf = `highshelf=f=8800:g=${airDb.toFixed(2)}`;
  const mudIntensity = enhancementOnly ? intensity * 0.55 : intensity;
  const mudCut = -clamp(
    0.1 + mudIntensity * 0.55 + Math.max(0, bass) * 0.65,
    0.1,
    enhancementOnly ? 0.75 : 1.25,
  );
  const peaking = `equalizer=f=${bass > 0.25 ? 245 : 285}:t=q:w=0.82:g=${mudCut.toFixed(2)}`;
  const presenceTame = -clamp(
    Math.max(0, air - 0.55) * 1.15 + (presetKey === "bright" ? 0.15 : 0),
    0,
    0.9,
  );
  const presence = `equalizer=f=4500:t=q:w=1.15:g=${presenceTame.toFixed(2)}`;

  const totalGainDb =
    measuredLufs != null && Number.isFinite(measuredLufs)
      ? clamp(Math.max(0, effectiveTarget - measuredLufs), 0, 4.5)
      : 0;
  const preGainDb = enhancementOnly ? 0 : Math.min(totalGainDb * 0.45, 2.2);
  const postGainDb = Math.max(0, totalGainDb - preGainDb);
  const toneTrimDb = -clamp(
    Math.max(0, bassDb) * 0.18 + Math.max(0, airDb) * 0.12 + Math.max(0, bass) * 0.25,
    0,
    0.55,
  );
  const approximateRmsDb = Number.isFinite(measuredLufs) ? measuredLufs - 6 : -20;
  const compThresh = clamp(
    approximateRmsDb + 8.5 - intensity * (enhancementOnly ? 1.4 : 2.1),
    -19,
    -10.5,
  );
  const compRatio = enhancementOnly ? 1.18 + intensity * 0.38 : 1.2 + intensity * 0.5;
  const releaseMs = 180 + Math.round(intensity * 35);
  const compressor = `acompressor=threshold=${compThresh.toFixed(2)}dB:ratio=${compRatio.toFixed(2)}:attack=32:release=${releaseMs}`;

  const deess = presetKey === "warm" ? "deesser=i=0.24" : null;

  const limiter = `alimiter=limit=${dbToLinear(tp).toFixed(4)}:attack=${presetKey === "loud" ? 5 : 7}:release=${presetKey === "loud" ? 120 : 140}`;

  // Match the browser chain's intent: shape tone broadly, trim EQ boosts before
  // dynamics, and leave most level work to conservative post gain + limiter.
  const parts = [highpass, lowShelf, peaking, highShelf];
  if (presenceTame < -0.01) parts.push(presence);
  pushVolume(parts, preGainDb + toneTrimDb);
  parts.push(compressor);
  if (deess) parts.push(deess);
  pushVolume(parts, postGainDb);

  parts.push(limiter, "lowpass=f=19000");

  return parts.join(",");
}

export function resolveMasteringTargets(presetKey, controls = {}, analysis = {}) {
  const preset = PRESETS[presetKey] || PRESETS.streaming;
  const presetTarget = Number.isFinite(Number(controls.targetLoudness))
    ? Number(controls.targetLoudness)
    : preset.targetLoudness;
  const ceilingDb = Number.isFinite(Number(controls.ceilingDb))
    ? Number(controls.ceilingDb)
    : preset.ceilingDb;

  const measuredLufs = analysis.loudnessDb ?? analysis.input_i ?? null;
  const analysisForAdaptive = {
    loudnessDb: measuredLufs,
    truePeakDb: analysis.truePeakDb ?? analysis.input_tp ?? null,
  };

  const effectiveTargetLufs = computeAdaptiveTarget(presetTarget, analysisForAdaptive);

  return {
    presetTarget,
    ceilingDb,
    effectiveTargetLufs,
    effectiveCeilingDb: computeAdaptiveCeiling(ceilingDb, analysisForAdaptive),
    enhancementOnly: isEnhancementOnlyMode(measuredLufs, effectiveTargetLufs),
    measuredLufs,
  };
}
