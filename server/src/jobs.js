import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JOB_TTL_MS } from "./constants.js";
import { buildMasterFilter } from "./presets.js";
import { extractWaveformPeaks, masterToFiles, removeDir } from "./ffmpeg.js";

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
  job.status = "processing";
  job.progress = 10;
  job.message = "Applying mastering preset";
  await fs.mkdir(job.dir, { recursive: true });

  try {
    const filter = buildMasterFilter(preset, controls);
    job.progress = 40;
    job.message = "Rendering master";
    const result = await masterToFiles(inputPath, job.dir, filter);
    job.progress = 90;
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
  } catch (error) {
    job.status = "failed";
    job.error = error.message || String(error);
    job.message = "Mastering failed";
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
