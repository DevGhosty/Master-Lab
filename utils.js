import { LOSSY_EXTENSIONS } from "./constants.js";

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Not available";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

export function linearToDb(value) {
  if (value <= 0 || !Number.isFinite(value)) return -Infinity;
  return 20 * Math.log10(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatDbValue(value) {
  if (!Number.isFinite(value)) return "-inf dB";
  return `${value.toFixed(1)} dB`;
}

export function formatEstimate(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value.toFixed(1)} dB`;
}

export function formatLufs(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value.toFixed(1)} LUFS`;
}

export function formatDbtp(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value.toFixed(1)} dBTP`;
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${Math.round(value * 100)}%`;
}

export function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function sanitizeBaseName(name) {
  const base = (name || "mastered").replace(/\.[^/.]+$/, "");
  return base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "mastered";
}

export function getExtension(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

export function isLossyFile(file) {
  const ext = getExtension(file.name);
  return LOSSY_EXTENSIONS.has(ext) || /mpeg|mp4|aac|ogg|opus/i.test(file.type);
}

export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export function mixDown(buffer) {
  const output = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      output[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return output;
}
