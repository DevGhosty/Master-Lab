import {
  computeAdaptiveCeiling,
  computeAdaptiveTarget,
  isEnhancementOnlyMode,
} from "./loudnessPolicy.js";
import { createPresetMap, resolvePresetSpec } from "../../presetSpec.js";

export const PRESETS = createPresetMap();

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
  const preset = resolvePresetSpec(presetKey);
  const { eq, compressor: comp, gainStage, limiter: limiterSpec, special } = preset.dsp;
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

  const highpass = `highpass=f=${bass > 0.25 ? eq.bassHighPassHz : eq.highPassHz}`;
  const bassDb = clamp((warmth - 0.5) * 1.4 + bass * 2.4, -1.2, bass > 0.25 ? 1.8 : 1.35);
  const airDb = clamp((air - 0.5) * 2, -0.85, 1.05);
  const lowShelf = `lowshelf=f=${eq.lowShelfHz}:g=${bassDb.toFixed(2)}`;
  const highShelf = `highshelf=f=${eq.highShelfHz}:g=${airDb.toFixed(2)}`;
  const mudIntensity = enhancementOnly ? intensity * 0.55 : intensity;
  const mudCut = -clamp(
    0.1 + mudIntensity * 0.55 + Math.max(0, bass) * 0.65,
    0.1,
    enhancementOnly ? 0.75 : 1.25,
  );
  const peaking = `equalizer=f=${bass > 0.25 ? eq.bassMudCutHz : eq.mudCutHz}:t=q:w=${eq.mudCutQ}:g=${mudCut.toFixed(2)}`;
  const presenceTame = -clamp(
    Math.max(0, air - 0.55) * 1.15 + (special.presenceExtraTameDb || 0),
    0,
    0.9,
  );
  const presence = `equalizer=f=${eq.presenceTameHz}:t=q:w=${eq.presenceTameQ}:g=${presenceTame.toFixed(2)}`;

  const totalGainDb =
    measuredLufs != null && Number.isFinite(measuredLufs)
      ? clamp(Math.max(0, effectiveTarget - measuredLufs), 0, gainStage.maxTotalGainDb)
      : 0;
  const preGainDb = enhancementOnly ? 0 : Math.min(totalGainDb * gainStage.preGainShare, gainStage.maxPreGainDb);
  const postGainDb = Math.max(0, totalGainDb - preGainDb);
  const toneTrimDb = -clamp(
    Math.max(0, bassDb) * 0.18 + Math.max(0, airDb) * 0.12 + Math.max(0, bass) * 0.25,
    0,
    0.55,
  );
  const approximateRmsDb = Number.isFinite(measuredLufs) ? measuredLufs - 6 : -20;
  const compThresh = clamp(
    approximateRmsDb + comp.thresholdBaseDb - intensity * (enhancementOnly ? comp.enhancementIntensityDb : comp.normalIntensityDb),
    comp.minThresholdDb,
    comp.maxThresholdDb,
  );
  const compRatio = enhancementOnly
    ? comp.enhancementBaseRatio + intensity * comp.enhancementIntensityRatio
    : comp.normalBaseRatio + intensity * comp.normalIntensityRatio;
  const releaseMs = comp.releaseMs + Math.round(intensity * comp.serverReleaseIntensityMs);
  const compressor = `acompressor=threshold=${compThresh.toFixed(2)}dB:ratio=${compRatio.toFixed(2)}:attack=${comp.attackMs}:release=${releaseMs}`;

  const deess = special.warmDeessIntensity ? `deesser=i=${special.warmDeessIntensity}` : null;

  const limiter = `alimiter=limit=${dbToLinear(tp).toFixed(4)}:attack=${limiterSpec.attackMs}:release=${limiterSpec.releaseMs}`;

  // Match the browser chain's intent: shape tone broadly, trim EQ boosts before
  // dynamics, and leave most level work to conservative post gain + limiter.
  const parts = [highpass, lowShelf, peaking, highShelf];
  if (presenceTame < -0.01) parts.push(presence);
  pushVolume(parts, preGainDb + toneTrimDb);
  parts.push(compressor);
  if (deess) parts.push(deess);
  pushVolume(parts, postGainDb);

  parts.push(limiter, `lowpass=f=${eq.deHarshLowpassHz}`);

  return parts.join(",");
}

export function resolveMasteringTargets(presetKey, controls = {}, analysis = {}) {
  const preset = resolvePresetSpec(presetKey);
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
