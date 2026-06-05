FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV HOME=/home/node \
  PATH=/home/node/.local/bin:$PATH \
  NODE_ENV=production \
  PORT=7860 \
  CORS_ORIGINS=https://devghosty.github.io,http://localhost:8100,http://127.0.0.1:8100 \
  CORS_ALLOW_PLATFORM_HOSTS=false \
  MAX_ACTIVE_RENDER_TASKS=2 \
  FFMPEG_TIMEOUT_MS=720000 \
  JOB_RESULT_TTL_MS=600000 \
  JOB_STALE_MS=840000

WORKDIR /home/node/app
COPY --chown=node:node package.json package-lock.json* ./
USER node
RUN npm ci --omit=dev --no-audit --ignore-scripts
COPY --chown=node:node src ./src

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 7860) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "start"]
