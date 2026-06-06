const COMMON_DSP = {
  eq: {
    highPassHz: 30,
    hotLowEndHighPassHz: 34,
    bassHighPassHz: 26,
    lowShelfHz: 90,
    mudCutHz: 285,
    bassMudCutHz: 245,
    mudCutQ: 0.82,
    highShelfHz: 8800,
    presenceTameHz: 4500,
    presenceTameQ: 1.15,
    deHarshLowpassHz: 19000,
    deHarshQ: 0.35,
  },
  compressor: {
    thresholdBaseDb: 8.5,
    normalIntensityDb: 2.1,
    enhancementIntensityDb: 1.4,
    minThresholdDb: -19,
    maxThresholdDb: -10.5,
    normalBaseRatio: 1.2,
    normalIntensityRatio: 0.5,
    enhancementBaseRatio: 1.18,
    enhancementIntensityRatio: 0.38,
    kneeDb: 20,
    attackMs: 32,
    releaseMs: 180,
    serverReleaseIntensityMs: 35,
  },
  saturation: {
    driveBase: 1,
    driveIntensity: 0.12,
    trimBaseDb: -0.04,
    trimIntensityDb: -0.08,
    wetIntensity: 0.06,
    maxWet: 0.055,
  },
  gainStage: {
    maxPreGainDb: 2.2,
    maxTotalGainDb: 4.5,
    browserPreGainShare: 0.22,
    preGainShare: 0.45,
    enhancementMakeupMaxDb: 0.85,
    normalMakeupMaxDb: 1.6,
  },
  limiter: {
    attackMs: 7,
    releaseMs: 140,
    loudAttackMs: 5,
    loudReleaseMs: 120,
  },
};

export const PRESET_ORDER = ["balanced", "loud", "warm", "bright", "bass", "streaming"];

export const MASTERING_PRESET_SPEC = {
  balanced: {
    label: "Balanced",
    whenToUse: "Most mixes that need a clear, natural lift without sounding pushed.",
    description: "A clean, natural master with moderate loudness.",
    targetLoudness: -14.5,
    ceilingDb: -1.2,
    intensity: 0.34,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
    dsp: {},
  },
  loud: {
    label: "Loud",
    whenToUse: "Club, rap, or EDM tracks where you want more level and punch.",
    description: "A louder master with more limiting.",
    targetLoudness: -12.3,
    ceilingDb: -1.4,
    intensity: 0.54,
    warmth: 0.47,
    air: 0.48,
    bass: 0,
    dsp: {
      limiter: {
        attackMs: COMMON_DSP.limiter.loudAttackMs,
        releaseMs: COMMON_DSP.limiter.loudReleaseMs,
      },
    },
  },
  warm: {
    label: "Warm",
    whenToUse: "Harsh or bright mixes, acoustic songs, or vocals that feel too edgy.",
    description: "A smoother sound with less harshness.",
    targetLoudness: -14.8,
    ceilingDb: -1.2,
    intensity: 0.32,
    warmth: 0.64,
    air: 0.43,
    bass: 0.1,
    dsp: {
      special: {
        warmDeessIntensity: 0.24,
      },
    },
  },
  bright: {
    label: "Bright",
    whenToUse: "Dull or muddy mixes that need more clarity, air, and presence.",
    description: "Adds clarity and presence.",
    targetLoudness: -14.5,
    ceilingDb: -1.2,
    intensity: 0.34,
    warmth: 0.46,
    air: 0.62,
    bass: -0.03,
    dsp: {
      special: {
        presenceExtraTameDb: 0.15,
      },
    },
  },
  bass: {
    label: "Bass Boost",
    whenToUse: "Thin mixes, hip-hop, or electronic tracks that need more low-end weight.",
    description: "Adds more low-end weight.",
    targetLoudness: -14.4,
    ceilingDb: -1.4,
    intensity: 0.36,
    warmth: 0.58,
    air: 0.48,
    bass: 0.42,
    dsp: {},
  },
  streaming: {
    label: "Streaming Ready",
    whenToUse: "Default for Spotify, Apple Music, and YouTube—balanced loudness with safe peaks.",
    description: "Targets a clean streaming-friendly loudness.",
    targetLoudness: -14,
    ceilingDb: -1.2,
    intensity: 0.32,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
    dsp: {},
  },
};

function mergeSection(section, override = {}) {
  return { ...section, ...override };
}

export function resolvePresetSpec(presetKey) {
  const key = MASTERING_PRESET_SPEC[presetKey] ? presetKey : "streaming";
  const preset = MASTERING_PRESET_SPEC[key];
  return {
    ...preset,
    key,
    dsp: {
      eq: mergeSection(COMMON_DSP.eq, preset.dsp.eq),
      compressor: mergeSection(COMMON_DSP.compressor, preset.dsp.compressor),
      saturation: mergeSection(COMMON_DSP.saturation, preset.dsp.saturation),
      gainStage: mergeSection(COMMON_DSP.gainStage, preset.dsp.gainStage),
      limiter: mergeSection(COMMON_DSP.limiter, preset.dsp.limiter),
      special: mergeSection({}, preset.dsp.special),
    },
  };
}

export function createPresetMap() {
  return Object.fromEntries(PRESET_ORDER.map((key) => [key, resolvePresetSpec(key)]));
}
