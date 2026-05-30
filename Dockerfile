# Root Dockerfile for free hosts (Render, Hugging Face Spaces). Builds server/ only.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/src ./src

ENV PORT=8080
ENV NODE_OPTIONS=--max-old-space-size=384
ENV CORS_ORIGINS=https://devghosty.github.io,http://localhost:8100,http://127.0.0.1:8100

EXPOSE 8080
CMD ["npm", "start"]
