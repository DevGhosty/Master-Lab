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
 * Uses a fast ebur128 measurement + volume gain instead of loudnorm in the render pass.
 */
export function buildMasterFilter(presetKey, controls = {}, options = {}) {
  const preset = PRESETS[presetKey] || PRESETS.streaming;
  const intensity = clamp(Number(controls.intensity ?? preset.intensity), 0, 1);
  const warmth = clamp(Number(controls.warmth ?? preset.warmth), 0, 1);
  const air = clamp(Number(controls.air ?? preset.air), 0, 1);
  const bass = Number(controls.bass ?? preset.bass);
  const target = preset.targetLoudness;
  const tp = preset.ceilingDb;

  const highpass = "highpass=f=30";
  const bassDb = clamp((warmth - 0.5) * 2 + bass * 2.1, -1.5, 1.6);
  const airDb = clamp((air - 0.5) * 2.2, -1, 1.25);
  const lowShelf = `lowshelf=f=105:g=${bassDb.toFixed(2)}`;
  const highShelf = `highshelf=f=9000:g=${airDb.toFixed(2)}`;
  const mudCut = -clamp(0.12 + intensity * 0.72, 0.1, 1.05);
  const peaking = `equalizer=f=285:t=q:w=0.82:g=${mudCut.toFixed(2)}`;

  const compThresh = -18 - intensity * 4;
  const compRatio = 1.5 + intensity * 1.2;
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

  const measuredLufs = options.measuredLufs;
  if (measuredLufs != null && Number.isFinite(measuredLufs)) {
    const gainDb = clamp(target - measuredLufs, -12, 12);
    parts.push(`volume=${gainDb.toFixed(2)}dB`);
  }

  parts.push(limiter, "lowpass=f=19000");

  return parts.join(",");
}
