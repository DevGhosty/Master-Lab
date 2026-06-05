# Deploy Master Lab API on Hugging Face Spaces

Hugging Face Spaces is the recommended free target for the FFmpeg API because it can run the existing Docker server without moving audio rendering into short-lived frontend/serverless functions.

## Create the Space

1. Create or sign in to a Hugging Face account.
2. New Space -> choose **Docker**.
3. Connect this repository or upload the repo contents.
4. Use the repository root `Dockerfile`.
5. Keep the Space public if you want the free public URL to work from GitHub Pages.

The root README includes the Space metadata Hugging Face expects:

```yaml
sdk: docker
app_port: 7860
```

The Docker image runs as Hugging Face’s non-root `user` account, installs FFmpeg, exposes `/health`, and sets conservative memory/concurrency defaults for the free CPU tier.

## Required variables

Set these in the Space settings:

```text
PORT=7860
CORS_ORIGINS=https://devghosty.github.io,http://localhost:8100,http://127.0.0.1:8100
CORS_ALLOW_PLATFORM_HOSTS=false
MAX_ACTIVE_RENDER_TASKS=2
FFMPEG_TIMEOUT_MS=720000
JOB_RESULT_TTL_MS=600000
JOB_STALE_MS=840000
```

Then set the frontend API URL in `config.js`:

```js
window.MASTER_LAB_API = "https://devghosty-master-lab.hf.space";
```

## Optional AI assistant

The app works without paid AI. If you want optional AI notes, add server-only secrets:

```text
OPENAI_API_KEY=<your server-side key>
OPENAI_MODEL=gpt-4.1-mini
```

The assistant endpoint receives only analysis and mastering-report JSON. It does not receive raw audio.

## Verify

1. Open `https://devghosty-master-lab.hf.space/health`.
2. Confirm `{ "ok": true }`.
3. Upload a short WAV in the GitHub Pages app.
4. Confirm analysis, mastering, preview, and all downloads work.

If the Space restarts, in-progress jobs are lost because storage is ephemeral. The app already tells users to retry if a free host restarts during mastering.

## Local Docker smoke test

From the repo root:

```bash
docker compose up --build
```

Then open `http://localhost:8080/health`. This uses the same root Dockerfile as the Hugging Face Space.
