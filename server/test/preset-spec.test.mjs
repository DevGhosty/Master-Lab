import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PRESETS as browserPresets } from "../../presets.js";
import { PRESET_ORDER, resolvePresetSpec } from "../../presetSpec.js";
import { VALID_PRESETS } from "../src/constants.js";
import { buildMasterFilter, PRESETS as serverPresets, resolveMasteringTargets } from "../src/presets.js";

const DEFAULT_FIELDS = ["targetLoudness", "ceilingDb", "intensity", "warmth", "air", "bass"];

describe("shared mastering preset spec", () => {
  test("browser and server expose the same preset keys", () => {
    assert.deepEqual(Object.keys(browserPresets), PRESET_ORDER);
    assert.deepEqual(Object.keys(serverPresets), PRESET_ORDER);
    assert.deepEqual([...VALID_PRESETS], PRESET_ORDER);
  });

  test("browser and server defaults resolve from the shared spec", () => {
    for (const key of PRESET_ORDER) {
      const spec = resolvePresetSpec(key);
      for (const field of DEFAULT_FIELDS) {
        assert.equal(browserPresets[key][field], spec[field], `browser ${key}.${field}`);
        assert.equal(serverPresets[key][field], spec[field], `server ${key}.${field}`);
      }
      assert.equal(browserPresets[key].label, spec.label, `browser ${key}.label`);
      assert.equal(serverPresets[key].label, spec.label, `server ${key}.label`);
    }
  });

  test("server target resolution cannot drift from shared target and ceiling defaults", () => {
    for (const key of PRESET_ORDER) {
      const spec = resolvePresetSpec(key);
      const targets = resolveMasteringTargets(key, {}, { loudnessDb: -18, truePeakDb: -6 });
      assert.equal(targets.presetTarget, spec.targetLoudness, `${key} target loudness`);
      assert.equal(targets.ceilingDb, spec.ceilingDb, `${key} ceiling`);
    }
  });

  test("core DSP intent is available to both runtimes from one spec", () => {
    for (const key of PRESET_ORDER) {
      const spec = resolvePresetSpec(key);
      assert.equal(browserPresets[key].dsp.eq.lowShelfHz, spec.dsp.eq.lowShelfHz);
      assert.equal(serverPresets[key].dsp.eq.lowShelfHz, spec.dsp.eq.lowShelfHz);
      assert.equal(browserPresets[key].dsp.eq.highShelfHz, spec.dsp.eq.highShelfHz);
      assert.equal(serverPresets[key].dsp.eq.highShelfHz, spec.dsp.eq.highShelfHz);
      assert.equal(browserPresets[key].dsp.eq.presenceTameHz, spec.dsp.eq.presenceTameHz);
      assert.equal(serverPresets[key].dsp.eq.presenceTameHz, spec.dsp.eq.presenceTameHz);
      assert.equal(browserPresets[key].dsp.compressor.attackMs, spec.dsp.compressor.attackMs);
      assert.equal(serverPresets[key].dsp.compressor.attackMs, spec.dsp.compressor.attackMs);
      assert.equal(browserPresets[key].dsp.limiter.attackMs, spec.dsp.limiter.attackMs);
      assert.equal(serverPresets[key].dsp.limiter.releaseMs, spec.dsp.limiter.releaseMs);
    }
  });

  test("FFmpeg filters reflect shared EQ, limiter, and special behavior", () => {
    for (const key of PRESET_ORDER) {
      const spec = resolvePresetSpec(key);
      const filter = buildMasterFilter(key, {}, { measuredLufs: -18, effectiveTargetLufs: spec.targetLoudness });
      assert.match(filter, new RegExp(`lowshelf=f=${spec.dsp.eq.lowShelfHz}:`), `${key} low shelf`);
      assert.match(filter, new RegExp(`highshelf=f=${spec.dsp.eq.highShelfHz}:`), `${key} high shelf`);
      assert.match(filter, new RegExp(`alimiter=limit=.*:attack=${spec.dsp.limiter.attackMs}:release=${spec.dsp.limiter.releaseMs}`), `${key} limiter`);
    }

    assert.match(
      buildMasterFilter("warm"),
      /deesser=i=0\.24/,
      "warm de-essing comes from shared special behavior",
    );
    assert.match(
      buildMasterFilter("bright"),
      /equalizer=f=4500:t=q:w=1\.15:g=-/,
      "bright presence taming comes from shared special behavior",
    );
  });
});
