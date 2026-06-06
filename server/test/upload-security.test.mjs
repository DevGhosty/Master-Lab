import assert from "node:assert/strict";
import test from "node:test";

import { PublicError, clientErrorMessage, internalErrorMessage } from "../src/errors.js";
import { validateAudioProbe } from "../src/ffmpeg.js";

const VALID_PROBE = {
  duration: 12,
  channels: 2,
  sampleRate: 48000,
  codec: "pcm_s16le",
};

test("probe validation accepts a normal supported stereo WAV stream", () => {
  assert.equal(validateAudioProbe({ ...VALID_PROBE }).codec, "pcm_s16le");
});

test("probe validation rejects non-audio or unsupported codec metadata", () => {
  assert.throws(
    () => validateAudioProbe({ ...VALID_PROBE, codec: "h264" }),
    /codec is not supported/i,
  );
});

test("probe validation rejects unsafe duration, channel, and sample-rate envelopes", () => {
  assert.throws(() => validateAudioProbe({ ...VALID_PROBE, duration: 0 }), /playable audio duration/i);
  assert.throws(() => validateAudioProbe({ ...VALID_PROBE, duration: 901 }), /longer than/i);
  assert.throws(() => validateAudioProbe({ ...VALID_PROBE, channels: 6 }), /mono or stereo/i);
  assert.throws(() => validateAudioProbe({ ...VALID_PROBE, sampleRate: 4000 }), /sample rate/i);
  assert.throws(() => validateAudioProbe({ ...VALID_PROBE, sampleRate: 384000 }), /sample rate/i);
});

test("public errors keep internal FFmpeg details out of client-facing messages", () => {
  const error = new PublicError("Audio analysis failed. Try another export format.", {
    internalMessage: "ffmpeg stderr: decoder exploded at /tmp/master-lab/private-file.wav",
  });

  assert.equal(clientErrorMessage(error), "Audio analysis failed. Try another export format.");
  assert.match(internalErrorMessage(error), /decoder exploded/);
  assert.doesNotMatch(clientErrorMessage(error), /ffmpeg|tmp|private-file/);
});
