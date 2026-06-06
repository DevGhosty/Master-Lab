import { PRESET_ORDER } from "../../presetSpec.js";

export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 15 * 60;
export const MAX_CHANNELS = 2;
export const JOB_RESULT_TTL_MS = Number(process.env.JOB_RESULT_TTL_MS || 10 * 60 * 1000);
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SYNC_MASTER_MAX_SECONDS = 180;
export const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 12 * 60 * 1000);
export const JOB_STALE_MS = Number(process.env.JOB_STALE_MS || FFMPEG_TIMEOUT_MS + 2 * 60 * 1000);
export const MAX_ACTIVE_RENDER_TASKS = Number(process.env.MAX_ACTIVE_RENDER_TASKS || 2);
export const SUPPORTED_EXTENSIONS = new Set(["wav", "aif", "aiff", "flac", "mp3", "m4a", "aac", "ogg", "opus"]);
export const VALID_PRESETS = new Set(PRESET_ORDER);
