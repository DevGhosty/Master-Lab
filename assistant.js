import { hasAudibleSignal, recommendPreset } from "./analysis.js";
import { PRESETS } from "./presets.js";
import { clamp } from "./utils.js";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function formatSigned(value, unit) {
  if (!Number.isFinite(value)) return "Not available";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${unit}`;
}

function classifyIntensityCap(analysis, warnings = []) {
  if (!hasAudibleSignal(analysis)) return 0;
  const hot = Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb > -10.5;
  const clipped = warnings.some((warning) => warning.level === "major" || /clipping/i.test(warning.title));
  const lowCrest = Number.isFinite(analysis.crestDb) && analysis.crestDb < 6;
  if (hot || clipped || lowCrest) return 0.28;
  if (Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb < -24) return 0.42;
  return 0.36;
}

function toneNotes(analysis) {
  const notes = [];
  if (Number.isFinite(analysis.lowRatioDb)) {
    if (analysis.lowRatioDb < -16) notes.push("Low end looks thin; avoid cutting bass unless the reference is very lean.");
    if (analysis.lowRatioDb > -7) notes.push("Low end is already strong; use bass enhancement conservatively.");
  }
  if (Number.isFinite(analysis.mudRatioDb) && analysis.mudRatioDb > -6.5) {
    notes.push("Low mids look dense; a small mud cut is safer than broad bass gain.");
  }
  if (Number.isFinite(analysis.highRatioDb)) {
    if (analysis.highRatioDb < -22) notes.push("Top end looks restrained; Bright can help, but keep the presence tamer active.");
    if (analysis.highRatioDb > -15) notes.push("Top end is already forward; avoid extra air to prevent harsh cymbals or sibilance.");
  }
  return notes;
}

export function buildMixAssistant({ analysis, warnings = [], file = null, recommendation = null, ai = null }) {
  if (ai?.summary && ai?.presetKey) {
    return {
      source: "AI",
      presetKey: PRESETS[ai.presetKey] ? ai.presetKey : recommendation?.presetKey || "streaming",
      intensityCap: clamp(Number(ai.intensityCap ?? 0.36), 0, 1),
      title: ai.title || "AI Mix Notes",
      summary: ai.summary,
      rationale: ai.rationale || "",
      notes: Array.isArray(ai.notes) ? ai.notes.slice(0, 5) : [],
      cautions: Array.isArray(ai.cautions) ? ai.cautions.slice(0, 4) : [],
    };
  }

  const fallbackRecommendation = recommendation || recommendPreset(analysis, warnings, file);
  if (!hasAudibleSignal(analysis)) {
    return {
      source: "Local",
      presetKey: "streaming",
      intensityCap: 0,
      title: "Mastering Assistant",
      summary: "No usable audio was detected, so mastering stays locked until a valid source is uploaded.",
      rationale: "The assistant only works from measured audio features; silent files do not provide enough signal.",
      notes: ["Upload a file with audible content before mastering."],
      cautions: [],
    };
  }

  const issueNotes = warnings
    .filter((warning) => warning.level !== "good")
    .slice(0, 3)
    .map((warning) => `${warning.title}: ${warning.try || warning.text}`);
  const presetLabel = PRESETS[fallbackRecommendation.presetKey]?.label || "Streaming Ready";
  const intensityCap = classifyIntensityCap(analysis, warnings);
  const notes = [
    `Recommended goal: ${presetLabel}.`,
    `Suggested intensity ceiling: ${Math.round(intensityCap * 100)}%.`,
    ...toneNotes(analysis),
    ...issueNotes,
  ].slice(0, 5);

  return {
    source: "Local",
    presetKey: fallbackRecommendation.presetKey,
    intensityCap,
    title: "Mastering Assistant",
    summary: fallbackRecommendation.reason,
    rationale: "This guidance is based on loudness, true peak, crest factor, tonal balance, and source warnings.",
    notes,
    cautions: warnings
      .filter((warning) => warning.level === "major")
      .map((warning) => warning.text)
      .slice(0, 3),
  };
}

export function buildMasterReport({ originalAnalysis, masteredAnalysis, presetKey, controls = {}, limiterReductionDb = 0 }) {
  const ceilingDb = finite(controls.ceilingDb);
  const loudnessChange = finite(masteredAnalysis?.loudnessDb - originalAnalysis?.loudnessDb);
  const truePeakMargin = ceilingDb != null && Number.isFinite(masteredAnalysis?.truePeakDb)
    ? ceilingDb - masteredAnalysis.truePeakDb
    : null;
  const crestChange = finite(masteredAnalysis?.crestDb - originalAnalysis?.crestDb);
  const clipped = Number(masteredAnalysis?.clippingSamples || 0) > 0;
  const overCeiling = truePeakMargin != null && truePeakMargin < -0.05;
  const sourceLimited =
    Number.isFinite(originalAnalysis?.loudnessDb) &&
    Number.isFinite(originalAnalysis?.crestDb) &&
    (originalAnalysis.loudnessDb > -10.5 || originalAnalysis.crestDb < 6);
  const pushed = clipped || overCeiling || (Number.isFinite(crestChange) && crestChange < -4);

  let verdict = "safe";
  let label = "Safe master";
  let summary = "The rendered master stays inside the app's conservative loudness and peak policy.";
  if (pushed) {
    verdict = "pushed";
    label = "Pushed master";
    summary = "The result is close to the safety limits; compare by ear before using it as a final master.";
  } else if (sourceLimited) {
    verdict = "source-limited";
    label = "Source-limited";
    summary = "The source was already loud or low-dynamic, so the master focused on polish instead of extra level.";
  }

  const presetLabel = PRESETS[presetKey]?.label || "Selected preset";
  const notes = [
    `${presetLabel} rendered with an effective ceiling of ${ceilingDb != null ? `${ceilingDb.toFixed(1)} dBTP` : "the selected preset ceiling"}.`,
    `Loudness change: ${formatSigned(loudnessChange, "LU")}.`,
    `Crest factor change: ${formatSigned(crestChange, "dB")}.`,
  ];
  if (truePeakMargin != null) notes.push(`True peak margin: ${formatSigned(truePeakMargin, "dB")} below the ceiling.`);
  if (Number.isFinite(limiterReductionDb) && limiterReductionDb > 0.1) {
    notes.push(`Estimated limiter reduction: ${limiterReductionDb.toFixed(1)} dB.`);
  }

  return {
    verdict,
    label,
    summary,
    notes,
    metrics: {
      originalLoudnessDb: finite(originalAnalysis?.loudnessDb),
      masteredLoudnessDb: finite(masteredAnalysis?.loudnessDb),
      loudnessChangeDb: loudnessChange,
      originalTruePeakDb: finite(originalAnalysis?.truePeakDb),
      masteredTruePeakDb: finite(masteredAnalysis?.truePeakDb),
      truePeakMarginDb: truePeakMargin,
      originalCrestDb: finite(originalAnalysis?.crestDb),
      masteredCrestDb: finite(masteredAnalysis?.crestDb),
      crestChangeDb: crestChange,
      clippingSamples: Number(masteredAnalysis?.clippingSamples || 0),
    },
  };
}
