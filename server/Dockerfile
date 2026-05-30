FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src

ENV PORT=8080
ENV CORS_ORIGINS=https://devghosty.github.io,http://localhost:8100,http://127.0.0.1:8100

EXPOSE 8080
CMD ["npm", "start"]
