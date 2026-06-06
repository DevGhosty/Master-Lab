import { PRESET_ORDER } from "../../presetSpec.js";

export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 15 * 60;
export const MAX_CHANNELS = 2;
export const MIN_SAMPLE_RATE_HZ = Number(process.env.MIN_SAMPLE_RATE_HZ || 8000);
export const MAX_SAMPLE_RATE_HZ = Number(process.env.MAX_SAMPLE_RATE_HZ || 192000);
export const JOB_RESULT_TTL_MS = Number(process.env.JOB_RESULT_TTL_MS || 10 * 60 * 1000);
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SYNC_MASTER_MAX_SECONDS = 180;
export const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 12 * 60 * 1000);
export const JOB_STALE_MS = Number(process.env.JOB_STALE_MS || FFMPEG_TIMEOUT_MS + 2 * 60 * 1000);
export const MAX_ACTIVE_RENDER_TASKS = Number(process.env.MAX_ACTIVE_RENDER_TASKS || 2);
export const UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
export const UPLOAD_RATE_LIMIT_MAX = Number(process.env.UPLOAD_RATE_LIMIT_MAX || 20);
export const TEMP_FILE_TTL_MS = Number(process.env.TEMP_FILE_TTL_MS || SESSION_TTL_MS);
export const SUPPORTED_EXTENSIONS = new Set(["wav", "aif", "aiff", "flac", "mp3", "m4a", "aac", "ogg", "opus"]);
export const SUPPORTED_AUDIO_CODECS = new Set([
  "aac",
  "alac",
  "flac",
  "mp3",
  "mp3float",
  "mp3adu",
  "mp3adufloat",
  "mp3on4",
  "mp3on4float",
  "opus",
  "pcm_f32be",
  "pcm_f32le",
  "pcm_f64be",
  "pcm_f64le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24be",
  "pcm_s24le",
  "pcm_s32be",
  "pcm_s32le",
  "pcm_u8",
  "vorbis",
]);
export const VALID_PRESETS = new Set(PRESET_ORDER);
