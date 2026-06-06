import { clamp } from "./utils.js";

export const PRESERVE_POLICY = "preserve";
const HOT_SOURCE_LUFS = -10.5;
const HOT_SOURCE_TRUE_PEAK_DB = -0.8;
const HOT_SOURCE_CEILING_DB = -2;

export function isHotSource(analysis) {
  if (!analysis) return false;
  return (
    (Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb > HOT_SOURCE_LUFS) ||
    (Number.isFinite(analysis.truePeakDb) && analysis.truePeakDb > HOT_SOURCE_TRUE_PEAK_DB)
  );
}

export function computeAdaptiveTarget(preset, analysis) {
  const presetTarget = preset.targetLoudness;
  if (!analysis || !Number.isFinite(analysis.loudnessDb)) return presetTarget;

  const measured = analysis.loudnessDb;
  if (isHotSource(analysis)) {
    return Math.max(measured, presetTarget, -12);
  }
  if (measured >= presetTarget) {
    return Math.max(measured, presetTarget);
  }
  return presetTarget;
}

export function computeAdaptiveCeiling(preset, analysis) {
  if (isHotSource(analysis)) return HOT_SOURCE_CEILING_DB;
  return preset.ceilingDb;
}

/** Never attenuate for LUFS under preserve policy; only boost quiet sources toward target. */
export function computePreserveGainDb(measuredLufs, effectiveTargetLufs) {
  if (!Number.isFinite(measuredLufs) || !Number.isFinite(effectiveTargetLufs)) return 0;
  return clamp(Math.max(0, effectiveTargetLufs - measuredLufs), 0, 4.5);
}

export function computePreGainDb(loudnessGap, enhancementOnly = false, options = {}) {
  if (enhancementOnly) return 0;
  const share = options.share ?? 0.22;
  const maxPreGainDb = options.maxPreGainDb ?? 2.2;
  return clamp(Math.max(0, loudnessGap * share), 0, maxPreGainDb);
}

export function computeFinalizeGainDb({
  loudnessDb,
  targetLoudness,
  ceilingDb,
  truePeakDb,
  sourceLoudnessDb,
}) {
  const peakRoomDb = ceilingDb - truePeakDb;
  const targetGap = Math.max(0, targetLoudness - loudnessDb);
  let desiredGainDb = Math.min(targetGap, peakRoomDb);

  if (Number.isFinite(sourceLoudnessDb)) {
    const matchSourceGainDb = Math.max(0, sourceLoudnessDb - loudnessDb);
    const sourceAtOrAboveTarget = sourceLoudnessDb >= targetLoudness;
    const sourceMatch = Math.min(matchSourceGainDb, peakRoomDb, 1.5);
    desiredGainDb = sourceAtOrAboveTarget
      ? sourceMatch
      : Math.max(desiredGainDb, sourceMatch);
  }

  const boostCap = loudnessDb < targetLoudness ? 4.5 : 1.5;
  return clamp(desiredGainDb, 0, boostCap);
}

export function isEnhancementOnlyMode(measuredLufs, effectiveTargetLufs) {
  return Number.isFinite(measuredLufs) && Number.isFinite(effectiveTargetLufs) && measuredLufs >= effectiveTargetLufs;
}
