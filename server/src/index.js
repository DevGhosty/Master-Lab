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
  MAX_DURATION_SECONDS,
  MAX_FILE_SIZE_BYTES,
  SYNC_MASTER_MAX_SECONDS,
  VALID_PRESETS,
} from "./constants.js";
import { analyzeAudioFile, extractWaveformPeaks, masterToFiles, removeDir } from "./ffmpeg.js";
import { buildMasterFilter } from "./presets.js";
import { createJob, getJob, runMasterJob, scheduleJobCleanup } from "./jobs.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:8100,http://127.0.0.1:8100,https://devghosty.github.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CORS_ALLOW_PLATFORM_HOSTS = process.env.CORS_ALLOW_PLATFORM_HOSTS !== "false";

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (CORS_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (!CORS_ALLOW_PLATFORM_HOSTS) return false;
    if (hostname.endsWith(".onrender.com")) return true;
    if (hostname.endsWith(".hf.space")) return true;
    if (hostname.endsWith(".fly.dev")) return true;
  } catch {
    return false;
  }
  return false;
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
});

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "master-lab-api" });
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
  const uploadPath = req.file?.path;
  const startedAt = Date.now();
  try {
    if (!uploadPath) {
      res.status(400).json({ error: "Missing audio file" });
      return;
    }
    const result = await analyzeAudioFile(uploadPath);
    validateProbe(result.probe);
    console.log(
      `[analyze] ok ${req.file.originalname} size=${req.file.size} duration=${result.probe.duration}s elapsed=${Date.now() - startedAt}ms`,
    );
    res.json({
      probe: result.probe,
      analysis: result.analysis,
      waveformPeaks: result.waveformPeaks,
    });
  } catch (error) {
    console.error(
      `[analyze] fail ${req.file?.originalname || "unknown"} size=${req.file?.size || 0} elapsed=${Date.now() - startedAt}ms`,
      error,
    );
    res.status(400).json({ error: error.message || "Analysis failed" });
  } finally {
    await cleanupUpload(uploadPath);
  }
});

async function streamZip(files, meta, res) {
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="master-lab-export.zip"');
  const archive = archiver("zip", { zlib: { level: 5 } });
  archive.on("error", (err) => {
    console.error(err);
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
  };
  const workDir = path.join(os.tmpdir(), "master-lab", randomUUID());
  try {
    if (!uploadPath) {
      res.status(400).json({ error: "Missing audio file" });
      return;
    }
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
    const filter = buildMasterFilter(preset, controls);
    const result = await masterToFiles(uploadPath, workDir, filter);
    const meta = {
      masteredAnalysis: result.masteredAnalysis,
      originalAnalysis: analyzed.analysis,
      limiterReductionDb: 0,
      preset,
      serverMaster: true,
      waveformPeaks: await extractWaveformPeaks(result.files.wav32, 800),
    };
    await streamZip(result.files, meta, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Mastering failed" });
    }
  } finally {
    await cleanupUpload(uploadPath);
    await removeDir(workDir);
  }
});

app.post("/api/master/jobs", upload.single("file"), async (req, res) => {
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
  };
  try {
    if (!uploadPath) {
      res.status(400).json({ error: "Missing audio file" });
      return;
    }
    const job = createJob();
    const inputCopy = path.join(job.dir, `input${path.extname(req.file.originalname) || ".wav"}`);
    await fs.mkdir(job.dir, { recursive: true });
    await fs.copyFile(uploadPath, inputCopy);
    res.status(202).json({
      jobId: job.id,
      status: job.status,
    });
    runMasterJob(job, inputCopy, preset, controls).catch((err) => {
      console.error(err);
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: error.message || "Could not start job" });
  } finally {
    await cleanupUpload(uploadPath);
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
    console.error(error);
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

scheduleJobCleanup();

app.listen(PORT, HOST, () => {
  console.log(`Master Lab API listening on http://${HOST}:${PORT}`);
});
