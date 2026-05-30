import { clamp } from "./utils.js";

export const PRESERVE_POLICY = "preserve";

export function isHotSource(analysis) {
  if (!analysis) return false;
  return (
    (Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb > -10) ||
    (Number.isFinite(analysis.truePeakDb) && analysis.truePeakDb > -0.5)
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
  if (isHotSource(analysis)) return -2;
  return preset.ceilingDb;
}

/** Never attenuate for LUFS under preserve policy; only boost quiet sources toward target. */
export function computePreserveGainDb(measuredLufs, effectiveTargetLufs) {
  if (!Number.isFinite(measuredLufs) || !Number.isFinite(effectiveTargetLufs)) return 0;
  return clamp(Math.max(0, effectiveTargetLufs - measuredLufs), 0, 6);
}

export function computePreGainDb(loudnessGap) {
  return clamp(Math.max(0, loudnessGap * 0.3), 0, 3);
}

export function computeFinalizeGainDb({
  loudnessDb,
  targetLoudness,
  ceilingDb,
  truePeakDb,
  sourceLoudnessDb,
}) {
  const peakRoomDb = ceilingDb - truePeakDb;
  const targetGap = targetLoudness - loudnessDb;
  let desiredGainDb = Math.min(Math.max(0, targetGap), peakRoomDb);

  if (Number.isFinite(sourceLoudnessDb)) {
    const maxBoostToMatchSource = sourceLoudnessDb - loudnessDb;
    desiredGainDb = Math.max(desiredGainDb, Math.min(maxBoostToMatchSource, peakRoomDb, 2));
  }

  const boostCap = loudnessDb < targetLoudness ? 6 : 2;
  return clamp(desiredGainDb, 0, boostCap);
}

export function isEnhancementOnlyMode(measuredLufs, effectiveTargetLufs) {
  return Number.isFinite(measuredLufs) && Number.isFinite(effectiveTargetLufs) && measuredLufs >= effectiveTargetLufs;
}
