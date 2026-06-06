import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JOB_RESULT_TTL_MS, JOB_STALE_MS } from "./constants.js";
import { buildMasterFilter, resolveMasteringTargets } from "./presets.js";
import { analyzeMetricsOnly, masterToFiles, measureIntegratedLoudness, removeDir, validateAudioFile } from "./ffmpeg.js";
import { buildMasterReport } from "./assistant.js";
import { clientErrorMessage, internalErrorMessage } from "./errors.js";

/** @type {Map<string, object>} */
const jobs = new Map();

function errorMessage(error) {
  return internalErrorMessage(error);
}

export function createJob(requestId = null) {
  const id = randomUUID();
  const dir = path.join(os.tmpdir(), "master-lab", id);
  const job = {
    id,
    requestId,
    dir,
    status: "queued",
    progress: 0,
    message: "Queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
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
  let probe = null;
  job.status = "processing";
  job.progress = 8;
  job.message = "Validating audio";
  job.updatedAt = Date.now();
  await fs.mkdir(job.dir, { recursive: true });

  try {
    probe = await validateAudioFile(inputPath);
    job.progress = 15;
    job.message = "Measuring loudness";
    job.updatedAt = Date.now();
    const loudness = await measureIntegratedLoudness(inputPath);
    const originalAnalysis = await analyzeMetricsOnly(inputPath);
    const sourceLufs = Number.isFinite(Number(controls.sourceLoudnessDb))
      ? Number(controls.sourceLoudnessDb)
      : loudness.input_i;
    const targets = resolveMasteringTargets(preset, controls, {
      loudnessDb: sourceLufs,
      truePeakDb: loudness.input_tp,
    });
    job.progress = 20;
    job.message = "Applying mastering preset";
    job.updatedAt = Date.now();
    const filter = buildMasterFilter(
      preset,
      {
        ...controls,
        targetLoudness: targets.effectiveTargetLufs,
        ceilingDb: targets.effectiveCeilingDb,
      },
      {
        measuredLufs: targets.measuredLufs,
        effectiveTargetLufs: targets.effectiveTargetLufs,
        enhancementOnly: targets.enhancementOnly,
      },
    );
    job.progress = 25;
    job.message = "Rendering master and exports";
    job.updatedAt = Date.now();
    const result = await masterToFiles(
      inputPath,
      job.dir,
      filter,
      ({ progress, message }) => {
        job.progress = progress;
        job.message = message;
        job.updatedAt = Date.now();
      },
      {
        sourceLufs,
        ceilingDb: targets.effectiveCeilingDb,
      },
    );
    job.progress = 88;
    job.message = "Preparing downloads";
    job.updatedAt = Date.now();
    job.files = result.files;
    job.meta = {
      masteredAnalysis: result.masteredAnalysis,
      originalAnalysis,
      masterReport: buildMasterReport(originalAnalysis, result.masteredAnalysis, {
        ceilingDb: targets.effectiveCeilingDb,
        preset,
      }),
      limiterReductionDb: 0,
      preset,
      serverMaster: true,
      preserveLevel: true,
      waveformPeaks: result.waveformPeaks || null,
    };
    job.status = "done";
    job.progress = 100;
    job.message = "Master ready";
    job.updatedAt = Date.now();
    job.finishedAt = Date.now();
    console.info(
      `[master] ok request=${job.requestId || "async"} preset=${preset} duration=${Math.round(probe.duration)}s elapsed=${Date.now() - startedAt}ms`,
    );
  } catch (error) {
    job.status = "failed";
    job.error = clientErrorMessage(error, "Mastering failed. Try another audio file or preset.");
    job.message = "Mastering failed";
    job.updatedAt = Date.now();
    job.finishedAt = Date.now();
    console.error(
      `[master] fail request=${job.requestId || "async"} preset=${preset} elapsed=${Date.now() - startedAt}ms error=${errorMessage(error)}`,
    );
    await removeDir(job.dir).catch(() => {});
  }
}

export function scheduleJobCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      const finishedAt = job.finishedAt || job.createdAt;
      const activeAge = now - (job.updatedAt || job.createdAt);
      if ((job.status === "done" || job.status === "failed") && now - finishedAt > JOB_RESULT_TTL_MS) {
        removeDir(job.dir).catch(() => {});
        jobs.delete(id);
        continue;
      }
      if ((job.status === "queued" || job.status === "processing") && activeAge > JOB_STALE_MS) {
        job.status = "failed";
        job.error = "Job expired while processing";
        job.message = "Mastering failed";
        job.updatedAt = now;
        job.finishedAt = now;
        removeDir(job.dir).catch(() => {});
        jobs.delete(id);
      }
    }
  }, 60_000);
}
