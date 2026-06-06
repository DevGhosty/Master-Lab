# Master Lab API

Ephemeral FFmpeg server for fast analyze + master. Audio is written to a temp directory, processed, returned to the client, then deleted (job artifacts expire after 10 minutes).

The FFmpeg chain consumes the shared root `presetSpec.js` file. Server and browser masters are not bit-identical, but they use the same preset targets, ceilings, default tone controls, EQ frequencies, compressor intent, limiter timing, and special preset behavior.

## Run locally

Requires **FFmpeg** and **ffprobe** on your PATH.

```bash
cd server
npm install
npm start
```

API listens on `http://localhost:8080` when run directly with npm. The Docker image listens on port `7860` for Hugging Face Spaces. Health check: `GET /health`.

Point the static UI at the API by setting `window.MASTER_LAB_API` in [../config.js](../config.js) (see [../config.example.js](../config.example.js)).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analyze` | Multipart field `file` → JSON probe + analysis + waveform peaks |
| POST | `/api/master` | Sync master (≤ 3 min) → ZIP download |
| POST | `/api/master/jobs` | Async master → `{ jobId }` |
| GET | `/api/jobs/:id` | Job status + metadata when done |
| GET | `/api/jobs/:id/download` | ZIP of all exports |
| GET | `/api/jobs/:id/file/:kind` | Single file (`preview`, `wav32`, `wav24`, `wav16`, `mp3`) |

## Tests

From the repo root:

```bash
npm test
npm run test:audio
npm run audit:prod
```

Or from `server/`:

```bash
npm test
npm run test:audio
```

`test:audio` generates repeatable synthetic WAV fixtures and validates silence, clipping, stereo phase/correlation, leading/trailing silence, waveform peaks, LUFS, and true peak. Browser-side analysis is always tested. FFmpeg-backed server/reference comparisons run when `ffmpeg` is installed on `PATH`; otherwise those reference cases are skipped with a clear message.

`test:presets` fails if browser and server preset targets, ceilings, default controls, or core DSP intent drift from the shared spec.

The browser LUFS/true-peak meter is an estimate for local-only mode. Initial UI analysis uses the fast true-peak estimator for responsiveness; final browser master validation uses the accurate full-signal estimator before enforcing the ceiling. The FFmpeg `ebur128=peak=true` path is the reference path for server deployments.

`audit:prod` runs `npm audit --omit=dev --audit-level=high` against the deployed dependency set. The upload parser is kept on Multer 2.x; uploaded files are still treated as untrusted until ffprobe confirms a supported audio stream, duration, channel count, sample rate, and codec.

## Deploy free (no Fly.io credit card)

### Option A — Render (recommended)

Uses the repo root [../render.yaml](../render.yaml) and [../Dockerfile](../Dockerfile).

1. Sign up at [render.com](https://render.com) with GitHub (free web services often do **not** require a card).
2. **New → Blueprint** → connect `DevGhosty/Master-Lab`.
3. Deploy `master-lab-api` (free plan).
4. Copy the service URL, e.g. `https://master-lab-api.onrender.com`.
5. In [../config.js](../config.js):

   ```js
   window.MASTER_LAB_API = "https://master-lab-api.onrender.com";
   ```

6. Push to GitHub Pages.

**Note:** Free Render instances sleep after ~15 minutes of idle traffic. The first request after sleep may take 30–60 seconds (cold start), then analyze/master are fast.

CORS: keep `CORS_ALLOW_PLATFORM_HOSTS=false` and set exact `CORS_ORIGINS`. The API ignores platform-host wildcard CORS while `NODE_ENV=production`, even if `CORS_ALLOW_PLATFORM_HOSTS=true`, so deployed hosts should list the GitHub Pages origin and any custom frontend origins explicitly.

### Option B — Hugging Face Spaces (recommended free CPU backend)

See [../deploy/huggingface/README.md](../deploy/huggingface/README.md).

Create a **Docker** Space from this repo’s root `Dockerfile`, then set `MASTER_LAB_API` to `https://devghosty-master-lab.hf.space`. The root README already includes the Space metadata (`sdk: docker`, `app_port: 7860`).

### Docker locally

```bash
docker compose up --build
```

The API will be available at `http://localhost:8080/health`.

### Option C — Fly.io (requires credit card)

```bash
cd server
fly deploy
```

Only use if you already have Fly billing set up. See [fly.toml](fly.toml).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` npm / `7860` Docker | Listen port (set by host) |
| `HOST` | `0.0.0.0` | Bind address for containers |
| `CORS_ORIGINS` | `https://devghosty.github.io,...` | Exact allowed browser origins |
| `CORS_ALLOW_PLATFORM_HOSTS` | `false` | Optional wildcard platform CORS; keep false in production and use exact origins |
| `CORS_ALLOW_LOCALHOST` | `true` | Allow local test origins during development |
| `MAX_ACTIVE_RENDER_TASKS` | `2` | Limits concurrent FFmpeg analysis/mastering tasks on free hosts |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` | `600000` | Per-IP upload/analyze/master rate-limit window |
| `UPLOAD_RATE_LIMIT_MAX` | `20` | Max upload/analyze/master starts per IP per window |
| `MIN_SAMPLE_RATE_HZ` | `8000` | Lowest accepted probed audio sample rate |
| `MAX_SAMPLE_RATE_HZ` | `192000` | Highest accepted probed audio sample rate |
| `FFMPEG_TIMEOUT_MS` | `720000` | Kills stuck FFmpeg/ffprobe work after 12 minutes |
| `JOB_RESULT_TTL_MS` | `600000` | Keeps completed async job exports available for 10 minutes |
| `JOB_STALE_MS` | `840000` | Expires abandoned active jobs after the FFmpeg timeout plus a small buffer |
| `TEMP_FILE_TTL_MS` | `1800000` | Deletes stale temp uploads left by interrupted requests |
| `OPENAI_API_KEY` | unset | Optional server-only key for AI assistant notes; raw audio is never sent |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional AI model name when `OPENAI_API_KEY` is set |

## Privacy

No database. Uploads and job folders are deleted after the request or TTL. Logs should contain request id, timing, size/duration buckets, preset, and sanitized internal diagnostics; they should not include original file names, session IDs, audio content, stack traces, or raw command output in client responses.
