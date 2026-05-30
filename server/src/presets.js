import {
  computeAdaptiveCeiling,
  computeAdaptiveTarget,
  isEnhancementOnlyMode,
} from "./loudnessPolicy.js";

/** FFmpeg-oriented preset targets (aligned with browser PRESETS in app.js). */
export const PRESETS = {
  balanced: {
    targetLoudness: -14.5,
    ceilingDb: -1,
    intensity: 0.38,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
  },
  loud: {
    targetLoudness: -12.5,
    ceilingDb: -1.2,
    intensity: 0.62,
    warmth: 0.48,
    air: 0.52,
    bass: 0,
  },
  warm: {
    targetLoudness: -14.8,
    ceilingDb: -1,
    intensity: 0.36,
    warmth: 0.68,
    air: 0.38,
    bass: 0.15,
  },
  bright: {
    targetLoudness: -14.5,
    ceilingDb: -1,
    intensity: 0.4,
    warmth: 0.45,
    air: 0.68,
    bass: -0.05,
  },
  bass: {
    targetLoudness: -14.3,
    ceilingDb: -1.2,
    intensity: 0.42,
    warmth: 0.6,
    air: 0.46,
    bass: 0.36,
  },
  streaming: {
    targetLoudness: -14,
    ceilingDb: -1,
    intensity: 0.42,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Build mastering filter chain for FFmpeg (-af).
 * Preserve-level policy: never attenuate below source LUFS; volume after dynamics.
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

  const highpass = "highpass=f=30";
  const bassDb = clamp((warmth - 0.5) * 2 + bass * 2.1, -1.5, 1.6);
  const airDb = clamp((air - 0.5) * 2.2, -1, 1.25);
  const lowShelf = `lowshelf=f=105:g=${bassDb.toFixed(2)}`;
  const highShelf = `highshelf=f=9000:g=${airDb.toFixed(2)}`;
  const mudIntensity = enhancementOnly ? intensity * 0.55 : intensity;
  const mudCut = -clamp(0.12 + mudIntensity * 0.72, 0.1, enhancementOnly ? 0.65 : 1.05);
  const peaking = `equalizer=f=285:t=q:w=0.82:g=${mudCut.toFixed(2)}`;

  const compThresh = enhancementOnly ? -20 - intensity * 3 : -18 - intensity * 4;
  const compRatio = enhancementOnly ? 1.35 + intensity * 0.9 : 1.5 + intensity * 1.2;
  const compressor = `acompressor=threshold=${compThresh}dB:ratio=${compRatio.toFixed(2)}:attack=26:release=150`;

  const deess = presetKey === "warm" ? "deesser=i=0.4" : null;
  const treble = presetKey === "bright" ? `treble=g=${(1 + air * 2).toFixed(2)}` : null;

  let limiter = `alimiter=limit=${Math.pow(10, tp / 20).toFixed(4)}:attack=5:release=50`;
  if (presetKey === "loud") {
    limiter = `alimiter=limit=${Math.pow(10, (tp - 0.2) / 20).toFixed(4)}:attack=3:release=40`;
  }

  const parts = [highpass, lowShelf, peaking, highShelf, compressor];
  if (deess) parts.push(deess);
  if (treble) parts.push(treble);

  if (measuredLufs != null && Number.isFinite(measuredLufs)) {
    const gainDb = clamp(Math.max(0, effectiveTarget - measuredLufs), 0, 6);
    if (gainDb > 0.01) {
      parts.push(`volume=${gainDb.toFixed(2)}dB`);
    }
  }

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
