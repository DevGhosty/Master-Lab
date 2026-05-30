function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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

export function computeAdaptiveTarget(presetTarget, analysis) {
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

export function computeAdaptiveCeiling(presetCeiling, analysis) {
  if (isHotSource(analysis)) return HOT_SOURCE_CEILING_DB;
  return presetCeiling;
}

export function computePreserveGainDb(measuredLufs, effectiveTargetLufs) {
  if (!Number.isFinite(measuredLufs) || !Number.isFinite(effectiveTargetLufs)) return 0;
  return clamp(Math.max(0, effectiveTargetLufs - measuredLufs), 0, 4.5);
}

export function isEnhancementOnlyMode(measuredLufs, effectiveTargetLufs) {
  return Number.isFinite(measuredLufs) && Number.isFinite(effectiveTargetLufs) && measuredLufs >= effectiveTargetLufs;
}

export function computePostTrimGainDb(sourceLufs, masteredLufs, masteredTruePeakDb, ceilingDb) {
  if (!Number.isFinite(sourceLufs) || !Number.isFinite(masteredLufs)) return 0;
  if (isHotSource({ loudnessDb: sourceLufs })) return 0;
  const gap = sourceLufs - masteredLufs;
  if (gap <= 1) return 0;
  const headroom = ceilingDb - masteredTruePeakDb;
  return clamp(Math.min(gap, 1.5, headroom - 0.3), 0, 1.5);
}
