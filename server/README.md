# Master Lab API

Ephemeral FFmpeg server for fast analyze + master. Audio is written to a temp directory, processed, returned to the client, then deleted (job artifacts expire after 10 minutes).

## Run locally

Requires **FFmpeg** and **ffprobe** on your PATH.

```bash
cd server
npm install
npm start
```

API listens on `http://localhost:8080`. Health check: `GET /health`.

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

CORS: set `CORS_ALLOW_PLATFORM_HOSTS=true` (default in `render.yaml`) so `*.onrender.com` is allowed automatically.

### Option B — Hugging Face Spaces (also free, no card)

See [deploy/huggingface/README.md](deploy/huggingface/README.md).

Create a **Docker** Space from this repo’s root `Dockerfile`, then set `MASTER_LAB_API` to `https://<user>-<space>.hf.space`.

### Option C — Fly.io (requires credit card)

```bash
cd server
fly deploy
```

Only use if you already have Fly billing set up. See [fly.toml](fly.toml).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | Listen port (set by host) |
| `HOST` | `0.0.0.0` | Bind address for containers |
| `CORS_ORIGINS` | `https://devghosty.github.io,...` | Exact allowed browser origins |
| `CORS_ALLOW_PLATFORM_HOSTS` | `true` | Also allow `*.onrender.com`, `*.hf.space`, `*.fly.dev` |

## Privacy

No database. Uploads and job folders are deleted after the request or TTL. Logs should contain only request id and timing, not audio content.
