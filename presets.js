import { createPresetMap } from "./presetSpec.js";

export const PRESETS = createPresetMap();

export function formatPresetGuidance(preset) {
  return `Best for: ${preset.whenToUse} ${preset.description}`;
}
