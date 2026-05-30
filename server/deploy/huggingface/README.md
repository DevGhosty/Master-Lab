# Hugging Face Spaces (free, no credit card)

CPU Docker Spaces can run this API with FFmpeg. Good alternative if Fly.io or Render ask for a card.

## Create the Space

1. Go to [huggingface.co/new-space](https://huggingface.co/new-space)
2. Name: e.g. `master-lab-api`
3. **SDK: Docker**
4. Connect GitHub repo `DevGhosty/Master-Lab` (or upload files)
5. Set **Dockerfile** to the repo root `Dockerfile` (builds `server/`)

## Space settings

In the Space **Settings → Variables**:

| Variable | Value |
|----------|--------|
| `PORT` | `7860` (required for Hugging Face Docker Spaces) |
| `CORS_ORIGINS` | `https://devghosty.github.io` |
| `CORS_ALLOW_PLATFORM_HOSTS` | `true` |

## Use with GitHub Pages

Your Space URL looks like:

```text
https://<your-username>-master-lab-api.hf.space
```

Set in the main repo [`config.js`](../../../config.js):

```js
window.MASTER_LAB_API = "https://<your-username>-master-lab-api.hf.space";
```

Push to GitHub Pages. First request after idle may take 30–60s while the Space wakes up.

## Notes

- Free CPU is slower than a paid VM but still much faster than in-browser mastering for long files.
- Space must be **public** (or you need HF tokens in the browser — not supported in this app).
- Audio is ephemeral on the Space container temp disk, same as other deploy targets.
