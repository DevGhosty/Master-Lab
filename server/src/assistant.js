import { PRESETS } from "./presets.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function hasSignal(analysis) {
  return Boolean(
    analysis &&
      ((Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb > -50) ||
        (Number.isFinite(analysis.truePeakDb) && analysis.truePeakDb > -40) ||
        (Number.isFinite(analysis.peakDb) && analysis.peakDb > -60)),
  );
}

function recommendedPreset(analysis, warnings = []) {
  const warningText = warnings.map((warning) => `${warning.title || ""} ${warning.text || ""}`).join(" ");
  if (!hasSignal(analysis)) return { presetKey: "streaming", reason: "No usable audio was detected." };
  if (/over-limited|already very loud/i.test(warningText)) {
    return { presetKey: "balanced", reason: "The source is already loud, so preserve dynamics and avoid more limiting." };
  }
  if (/compressed source|lossy/i.test(warningText) && Number.isFinite(analysis.truePeakDb) && analysis.truePeakDb > -0.5) {
    return { presetKey: "warm", reason: "Lossy source with hot peaks benefits from smoother processing." };
  }
  if (Number.isFinite(analysis.highRatioDb) && analysis.highRatioDb < -22) {
    return { presetKey: "bright", reason: "The top end measures restrained, so a careful clarity preset is useful." };
  }
  if (Number.isFinite(analysis.lowRatioDb) && analysis.lowRatioDb < -16) {
    return { presetKey: "bass", reason: "The low end measures thin, so Bass Boost can add weight safely." };
  }
  return { presetKey: "streaming", reason: "Streaming Ready is the safest default for clean level and conservative peaks." };
}

function intensityCap(analysis, warnings = []) {
  if (!hasSignal(analysis)) return 0;
  const text = warnings.map((warning) => `${warning.title || ""} ${warning.text || ""}`).join(" ");
  if (
    /clipping|over-limited|already very loud/i.test(text) ||
    (Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb > -10.5) ||
    (Number.isFinite(analysis.crestDb) && analysis.crestDb < 6)
  ) {
    return 0.28;
  }
  if (Number.isFinite(analysis.loudnessDb) && analysis.loudnessDb < -24) return 0.42;
  return 0.36;
}

function localAssistant(payload) {
  const analysis = payload.analysis || {};
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const rec = recommendedPreset(analysis, warnings);
  const cap = intensityCap(analysis, warnings);
  return {
    source: "Local",
    title: payload.stage === "mastered" ? "Master Report Notes" : "Mastering Assistant",
    presetKey: rec.presetKey,
    intensityCap: cap,
    summary: payload.stage === "mastered" && payload.report?.summary ? payload.report.summary : rec.reason,
    rationale: "Generated from measured loudness, true peak, crest factor, tonal balance, and source warnings.",
    notes: [
      `Recommended goal: ${PRESETS[rec.presetKey]?.label || rec.presetKey}.`,
      `Suggested intensity ceiling: ${Math.round(cap * 100)}%.`,
      Number.isFinite(analysis.mudRatioDb) && analysis.mudRatioDb > -6.5
        ? "Low mids look dense; keep bass boosts conservative."
        : "",
      Number.isFinite(analysis.highRatioDb) && analysis.highRatioDb > -15
        ? "Top end is already forward; avoid extra air."
        : "",
    ].filter(Boolean).slice(0, 5),
    cautions: warnings.filter((warning) => warning.level === "major").map((warning) => warning.text).slice(0, 3),
  };
}

function schema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      presetKey: { type: "string", enum: Object.keys(PRESETS) },
      intensityCap: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      rationale: { type: "string" },
      notes: { type: "array", items: { type: "string" }, maxItems: 5 },
      cautions: { type: "array", items: { type: "string" }, maxItems: 4 },
    },
    required: ["title", "presetKey", "intensityCap", "summary", "rationale", "notes", "cautions"],
  };
}

function safePayload(payload) {
  return {
    stage: payload.stage === "mastered" ? "mastered" : "analysis",
    preset: payload.preset || null,
    controls: payload.controls || null,
    analysis: payload.analysis || null,
    masteredAnalysis: payload.masteredAnalysis || null,
    report: payload.report || null,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.slice(0, 8) : [],
  };
}

function parseResponsesOutput(data) {
  if (typeof data.output_text === "string") return JSON.parse(data.output_text);
  const text = data.output
    ?.flatMap((item) => item.content || [])
    ?.map((content) => content.text || "")
    ?.join("")
    ?.trim();
  if (!text) throw new Error("AI response did not include text");
  return JSON.parse(text);
}

function validateAssistant(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  const presetKey = PRESETS[value.presetKey] ? value.presetKey : fallback.presetKey;
  return {
    source: "AI",
    title: String(value.title || fallback.title).slice(0, 80),
    presetKey,
    intensityCap: clamp(Number(value.intensityCap ?? fallback.intensityCap), 0, 1),
    summary: String(value.summary || fallback.summary).slice(0, 280),
    rationale: String(value.rationale || fallback.rationale).slice(0, 320),
    notes: Array.isArray(value.notes) ? value.notes.map(String).slice(0, 5) : fallback.notes,
    cautions: Array.isArray(value.cautions) ? value.cautions.map(String).slice(0, 4) : fallback.cautions,
  };
}

export async function buildAssistantResponse(payload) {
  const fallback = localAssistant(payload);
  if (!OPENAI_API_KEY) {
    return { ...fallback, aiAvailable: false };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content:
              "You are Master Lab's cautious mastering assistant. Use only the provided JSON metrics. Do not claim certified, professional, or human mastering. Never imply you heard raw audio.",
          },
          {
            role: "user",
            content: JSON.stringify(safePayload(payload)),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "master_lab_assistant",
            strict: true,
            schema: schema(),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`AI request failed with ${response.status}`);
    const data = await response.json();
    return { ...validateAssistant(parseResponsesOutput(data), fallback), aiAvailable: true };
  } catch (error) {
    console.error("[assistant] AI fallback", error.message || error);
    return { ...fallback, source: "Local", aiAvailable: false, aiError: true };
  }
}

export function buildMasterReport(originalAnalysis, masteredAnalysis, options = {}) {
  const ceilingDb = finite(options.ceilingDb);
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

  let verdict = "safe";
  let label = "Safe master";
  let summary = "The rendered master stays inside the app's conservative loudness and peak policy.";
  if (clipped || overCeiling || (Number.isFinite(crestChange) && crestChange < -4)) {
    verdict = "pushed";
    label = "Pushed master";
    summary = "The result is close to the safety limits; compare by ear before using it as a final master.";
  } else if (sourceLimited) {
    verdict = "source-limited";
    label = "Source-limited";
    summary = "The source was already loud or low-dynamic, so the master focused on polish instead of extra level.";
  }

  return {
    verdict,
    label,
    summary,
    notes: [
      `Loudness change: ${Number.isFinite(loudnessChange) ? `${loudnessChange.toFixed(1)} LU` : "not available"}.`,
      `True peak margin: ${Number.isFinite(truePeakMargin) ? `${truePeakMargin.toFixed(1)} dB` : "not available"}.`,
      `Crest change: ${Number.isFinite(crestChange) ? `${crestChange.toFixed(1)} dB` : "not available"}.`,
    ],
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
