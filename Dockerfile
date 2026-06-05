# Root Dockerfile for free hosts (Render, Hugging Face Spaces). Builds server/ only.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1000 user

ENV HOME=/home/user \
  PATH=/home/user/.local/bin:$PATH \
  NODE_ENV=production \
  PORT=7860 \
  NODE_OPTIONS=--max-old-space-size=384 \
  CORS_ORIGINS=https://devghosty.github.io,http://localhost:8100,http://127.0.0.1:8100 \
  CORS_ALLOW_PLATFORM_HOSTS=false \
  MAX_ACTIVE_RENDER_TASKS=2 \
  FFMPEG_TIMEOUT_MS=720000 \
  JOB_RESULT_TTL_MS=600000 \
  JOB_STALE_MS=840000

WORKDIR /home/user/app
COPY --chown=user:user server/package.json server/package-lock.json* ./
USER user
RUN npm ci --omit=dev --no-audit --ignore-scripts
COPY --chown=user:user server/src ./src

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 7860) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "start"]
