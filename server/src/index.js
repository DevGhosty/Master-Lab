import express from "express";
import cors from "cors";
import multer from "multer";
import archiver from "archiver";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_CHANNELS,
  MAX_ACTIVE_RENDER_TASKS,
  MAX_DURATION_SECONDS,
  MAX_FILE_SIZE_BYTES,
  SYNC_MASTER_MAX_SECONDS,
  SUPPORTED_EXTENSIONS,
  VALID_PRESETS,
} from "./constants.js";
import { analyzeAudioFile, masterToFiles, measureIntegratedLoudness, removeDir } from "./ffmpeg.js";
import { buildMasterFilter, resolveMasteringTargets } from "./presets.js";
import { createJob, getJob, runMasterJob, scheduleJobCleanup } from "./jobs.js";
import { buildAssistantResponse, buildMasterReport } from "./assistant.js";
import {
  createUploadSession,
  getUploadSession,
  releaseUploadSession,
  scheduleSessionCleanup,
} from "./sessions.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:8100,http://127.0.0.1:8100,https://devghosty.github.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CORS_ALLOW_PLATFORM_HOSTS = process.env.CORS_ALLOW_PLATFORM_HOSTS === "true";
const CORS_ALLOW_LOCALHOST = process.env.CORS_ALLOW_LOCALHOST !== "false";
let activeRenderTasks = 0;

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (CORS_ALLOW_LOCALHOST && (hostname === "localhost" || hostname === "127.0.0.1")) return true;
    if (!CORS_ALLOW_PLATFORM_HOSTS) return false;
    if (hostname.endsWith(".onrender.com")) return true;
    if (hostname.endsWith(".hf.space")) return true;
    if (hostname.endsWith(".fly.dev")) return true;
  } catch {
    return false;
  }
  return false;
}

function requestId() {
  return randomUUID().slice(0, 12);
}

function errorMessage(error) {
  return error?.message || String(error);
}

function getExtension(fileName = "") {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function isSupportedAudioUpload(file) {
  const ext = getExtension(file.originalname);
  return file.mimetype?.startsWith("audio/") || SUPPORTED_EXTENSIONS.has(ext);
}

function sizeBucket(bytes = 0) {
  if (bytes < 10 * 1024 * 1024) return "<10MB";
  if (bytes < 50 * 1024 * 1024) return "10-50MB";
  if (bytes < 100 * 1024 * 1024) return "50-100MB";
  return "100-150MB";
}

function durationBucket(seconds = 0) {
  if (seconds < 60) return "<1m";
  if (seconds < 180) return "1-3m";
  if (seconds < 600) return "3-10m";
  return "10-15m";
}

function acquireRenderTask() {
  if (activeRenderTasks >= MAX_ACTIVE_RENDER_TASKS) return false;
  activeRenderTasks += 1;
  return true;
}

function releaseRenderTask() {
  activeRenderTasks = Math.max(0, activeRenderTasks - 1);
}

function sendBusy(res) {
  res.setHeader("Retry-After", "15");
  res.status(429).json({ error: "Server is busy. Try again in a moment." });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), "master-lab", "uploads");
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".bin";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isSupportedAudioUpload(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("This file type is not supported yet."));
  },
});

const app = express();
app.use((req, res, next) => {
  req.id = requestId();
  res.setHeader("X-Request-Id", req.id);
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
  }),
);
app.use(express.json({ limit: "96kb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "master-lab-api",
    activeRenderTasks,
    maxActiveRenderTasks: MAX_ACTIVE_RENDER_TASKS,
    aiAvailable: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.post("/api/assistant", async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const assistant = await buildAssistantResponse(payload);
    res.json({ assistant });
  } catch (error) {
    console.error(`[assistant] fail request=${req.id}`, error);
    res.status(500).json({ error: "Assistant analysis failed" });
  }
});

async function cleanupUpload(filePath) {
  if (filePath) await fs.unlink(filePath).catch(() => {});
}

function validateProbe(probe) {
  if (probe.duration > MAX_DURATION_SECONDS) {
    throw new Error(`File is longer than ${MAX_DURATION_SECONDS} seconds`);
  }
  if (probe.channels > MAX_CHANNELS) {
    throw new Error("Only mono or stereo files are supported");
  }
}

app.post("/api/analyze", upload.single("file"), async (req, res) => {
  let uploadPath = req.file?.path;
  const startedAt = Date.now();
  let taskAcquired = false;
  try {
    if (!uploadPath) {
      res.status(400).json({ error: "Missing audio file" });
      return;
    }
    if (!acquireRenderTask()) {
      sendBusy(res);
      return;
    }
    taskAcquired = true;
    const result = await analyzeAudioFile(uploadPath);
    validateProbe(result.probe);
    const sessionId = createUploadSession(uploadPath, path.extname(req.file.originalname) || ".wav");
    uploadPath = null;
    console.info(
      `[analyze] ok request=${req.id} size=${sizeBucket(req.file.size)} duration=${durationBucket(result.probe.duration)} elapsed=${Date.now() - startedAt}ms`,
    );
    res.json({
      probe: result.probe,
      analysis: result.analysis,
      waveformPeaks: result.waveformPeaks,
      sessionId,
    });
  } catch (error) {
    console.error(
      `[analyze] fail request=${req.id} size=${sizeBucket(req.file?.size || 0)} elapsed=${Date.now() - startedAt}ms`,
      error,
    );
    res.status(400).json({ error: error.message || "Analysis failed" });
  } finally {
    if (taskAcquired) releaseRenderTask();
    if (uploadPath) await cleanupUpload(uploadPath);
  }
});

async function streamZip(files, meta, res) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="master-lab-export.zip"');
  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.on("error", (err) => {
    console.error(`[download] archive fail error=${errorMessage(err)}`);
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);
  archive.append(JSON.stringify(meta, null, 2), { name: "metadata.json" });
  const zipNames = {
    preview: "preview.wav",
    wav32: "master-32float.wav",
    wav24: "master-24bit.wav",
    wav16: "master-16bit-dithered.wav",
    mp3: "master-320.mp3",
  };
  for (const [name, filePath] of Object.entries(files)) {
    archive.file(filePath, { name: zipNames[name] || `${name}${path.extname(filePath)}` });
  }
  await archive.finalize();
}

app.post("/api/master", upload.single("file"), async (req, res) => {
  const uploadPath = req.file?.path;
  const preset = req.body?.preset || "streaming";
  if (!VALID_PRESETS.has(preset)) {
    await cleanupUpload(uploadPath);
    res.status(400).json({ error: "Invalid preset" });
    return;
  }
  const controls = {
    intensity: Number(req.body?.intensity),
    warmth: Number(req.body?.warmth),
    air: Number(req.body?.air),
    trimSilence: req.body?.trimSilence === "true" || req.body?.trimSilence === true,
    targetLoudness: Number(req.body?.targetLoudness),
    ceilingDb: Number(req.body?.ceilingDb),
    sourceLoudnessDb: Number(req.body?.sourceLoudnessDb),
  };
  const workDir = path.join(os.tmpdir(), "master-lab", randomUUID());
  let taskAcquired = false;
  try {
    if (!uploadPath) {
      res.status(400).json({ error: "Missing audio file" });
      return;
    }
    if (!acquireRenderTask()) {
      sendBusy(res);
      return;
    }
    taskAcquired = true;
    const analyzed = await analyzeAudioFile(uploadPath);
    validateProbe(analyzed.probe);
    if (analyzed.probe.duration > SYNC_MASTER_MAX_SECONDS) {
      res.status(409).json({
        error: "File too long for sync master; use /api/master/jobs",
        duration: analyzed.probe.duration,
      });
      return;
    }
    await fs.mkdir(workDir, { recursive: true });
    const loudness = await measureIntegratedLoudness(uploadPath);
    const sourceLufs = Number.isFinite(Number(controls.sourceLoudnessDb))
      ? Number(controls.sourceLoudnessDb)
      : loudness.input_i;
    const targets = resolveMasteringTargets(preset, controls, {
      loudnessDb: sourceLufs,
      truePeakDb: loudness.input_tp,
    });
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
    const result = await masterToFiles(uploadPath, workDir, filter, null, {
      sourceLufs,
      ceilingDb: targets.effectiveCeilingDb,
    });
    const meta = {
      masteredAnalysis: result.masteredAnalysis,
      originalAnalysis: analyzed.analysis,
      masterReport: buildMasterReport(analyzed.analysis, result.masteredAnalysis, {
        ceilingDb: targets.effectiveCeilingDb,
        preset,
      }),
      limiterReductionDb: 0,
      preset,
      serverMaster: true,
      waveformPeaks: result.waveformPeaks || null,
    };
    await streamZip(result.files, meta, res);
  } catch (error) {
    console.error(`[master] fail request=${req.id} preset=${preset} elapsed=sync error=${errorMessage(error)}`);
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage(error) || "Mastering failed" });
    }
  } finally {
    if (taskAcquired) releaseRenderTask();
    await cleanupUpload(uploadPath);
    await removeDir(workDir);
  }
});

app.post("/api/master/jobs", upload.single("file"), async (req, res) => {
  const sessionId = req.body?.sessionId;
  let uploadPath = req.file?.path;
  let ownsUpload = Boolean(uploadPath);
  let consumedSessionId = null;
  let cachedSession = null;
  const preset = req.body?.preset || "streaming";
  if (!VALID_PRESETS.has(preset)) {
    if (ownsUpload) await cleanupUpload(uploadPath);
    res.status(400).json({ error: "Invalid preset" });
    return;
  }
  const controls = {
    intensity: Number(req.body?.intensity),
    warmth: Number(req.body?.warmth),
    air: Number(req.body?.air),
    trimSilence: req.body?.trimSilence === "true" || req.body?.trimSilence === true,
    targetLoudness: Number(req.body?.targetLoudness),
    ceilingDb: Number(req.body?.ceilingDb),
    sourceLoudnessDb: Number(req.body?.sourceLoudnessDb),
  };
  let taskAcquired = false;
  try {
    if (!uploadPath && sessionId) {
      cachedSession = getUploadSession(sessionId);
      if (!cachedSession) {
        res.status(404).json({ error: "Session expired; re-upload and analyze again." });
        return;
      }
      uploadPath = cachedSession.path;
      consumedSessionId = sessionId;
    }
    if (!uploadPath) {
      res.status(400).json({ error: "Missing audio file or sessionId" });
      return;
    }
    if (!acquireRenderTask()) {
      sendBusy(res);
      return;
    }
    taskAcquired = true;
    const sourceExt = req.file?.originalname
      ? path.extname(req.file.originalname)
      : cachedSession?.originalExt || ".wav";
    const sourceSize = req.file?.size || 0;
    console.info(`[master] start request=${req.id} preset=${preset} size=${sourceSize ? sizeBucket(sourceSize) : "session"}`);
    const job = createJob(req.id);
    const ext = sourceExt || path.extname(uploadPath) || ".wav";
    const inputCopy = path.join(job.dir, `input${ext}`);
    await fs.mkdir(job.dir, { recursive: true });
    await fs.copyFile(uploadPath, inputCopy);
    if (consumedSessionId) {
      await releaseUploadSession(consumedSessionId);
      consumedSessionId = null;
    }
    res.status(202).json({
      jobId: job.id,
      status: job.status,
    });
    runMasterJob(job, inputCopy, preset, controls).catch((err) => {
      console.error(`[master] async crash request=${req.id} preset=${preset} error=${errorMessage(err)}`);
    }).finally(releaseRenderTask);
    taskAcquired = false;
  } catch (error) {
    console.error(`[master] start fail request=${req.id} preset=${preset} error=${errorMessage(error)}`);
    if (consumedSessionId) await releaseUploadSession(consumedSessionId).catch(() => {});
    res.status(400).json({ error: errorMessage(error) || "Could not start job" });
  } finally {
    if (taskAcquired) releaseRenderTask();
    if (ownsUpload) await cleanupUpload(uploadPath);
  }
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    meta: job.status === "done" ? job.meta : null,
  });
});

app.get("/api/jobs/:id/download", async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "done" || !job.files) {
    res.status(409).json({ error: "Job not ready", status: job.status });
    return;
  }
  try {
    await streamZip(job.files, job.meta, res);
  } catch (error) {
    console.error(`[download] fail request=${req.id} error=${errorMessage(error)}`);
    if (!res.headersSent) res.status(500).json({ error: "Download failed" });
  }
});

app.get("/api/jobs/:id/file/:kind", async (req, res) => {
  const job = getJob(req.params.id);
  const kind = req.params.kind;
  if (!job?.files?.[kind]) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  const filePath = job.files[kind];
  const ext = path.extname(filePath);
  const types = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
  };
  res.setHeader("Content-Type", types[ext] || "application/octet-stream");
  createReadStream(filePath).pipe(res);
});

app.use((error, req, res, _next) => {
  const status = error?.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  console.error(`[request] fail request=${req.id} status=${status} error=${errorMessage(error)}`);
  if (!res.headersSent) {
    res.status(status).json({ error: errorMessage(error) || "Request failed" });
  }
});

scheduleJobCleanup();
scheduleSessionCleanup();

const server = app.listen(PORT, HOST, () => {
  console.log(`Master Lab API listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`[server] ${signal} received; closing HTTP server`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
