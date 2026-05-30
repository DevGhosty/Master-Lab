import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JOB_TTL_MS, MAX_CHANNELS, MAX_DURATION_SECONDS } from "./constants.js";
import { buildMasterFilter } from "./presets.js";
import { extractWaveformPeaks, masterToFiles, probeAudioFile, removeDir } from "./ffmpeg.js";

function validateProbe(probe) {
  if (probe.duration > MAX_DURATION_SECONDS) {
    throw new Error(`File is longer than ${MAX_DURATION_SECONDS} seconds`);
  }
  if (probe.channels > MAX_CHANNELS) {
    throw new Error("Only mono or stereo files are supported");
  }
}

/** @type {Map<string, object>} */
const jobs = new Map();

export function createJob() {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), "master-lab", id);
  const job = {
    id,
    dir,
    status: "queued",
    progress: 0,
    message: "Queued",
    createdAt: Date.now(),
    meta: null,
    files: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export async function runMasterJob(job, inputPath, preset, controls) {
  const startedAt = Date.now();
  job.status = "processing";
  job.progress = 8;
  job.message = "Validating audio";
  await fs.mkdir(job.dir, { recursive: true });

  try {
    const probe = await probeAudioFile(inputPath);
    validateProbe(probe);
    job.progress = 15;
    job.message = "Applying mastering preset";
    const filter = buildMasterFilter(preset, controls);
    job.progress = 25;
    job.message = "Rendering master (this can take several minutes)";
    const result = await masterToFiles(inputPath, job.dir, filter, ({ progress, message }) => {
      job.progress = progress;
      job.message = message;
    });
    job.progress = 88;
    job.message = "Preparing downloads";
    job.files = result.files;
    job.meta = {
      masteredAnalysis: result.masteredAnalysis,
      limiterReductionDb: 0,
      preset,
      serverMaster: true,
      waveformPeaks: await extractWaveformPeaks(result.files.wav32, 800),
    };
    job.status = "done";
    job.progress = 100;
    job.message = "Master ready";
    console.info(
      `[master] ok job=${job.id} duration=${probe.duration}s elapsed=${Date.now() - startedAt}ms`,
    );
  } catch (error) {
    job.status = "failed";
    job.error = error.message || String(error);
    job.message = "Mastering failed";
    console.error(`[master] fail job=${job.id} elapsed=${Date.now() - startedAt}ms`, error);
    await removeDir(job.dir).catch(() => {});
  }
}

export function scheduleJobCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (now - job.createdAt > JOB_TTL_MS) {
        removeDir(job.dir).catch(() => {});
        jobs.delete(id);
      }
    }
  }, 60_000);
}
