import { state } from "./state.js";
import { els, setExportState, updateExportRecommendation } from "./dom.js";
import { COPY } from "./constants.js";
import { clamp } from "./utils.js";
import { encodePreviewLocally, encodeExportsLocally } from "./localAudio.js";

export async function createPreviewUrl(buffer, options = {}) {
  if (state.masteredPreviewUrl) URL.revokeObjectURL(state.masteredPreviewUrl);
  const { wav } = await encodePreviewLocally(buffer, options);
  state.masteredPreviewUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  els.masteredPlayer.src = state.masteredPreviewUrl;
  els.masteredPlayer.load();
}

export async function prepareDownloads(buffer, options = {}) {
  const baseName = state.fileName || "mastered";
  const wavName = `${baseName}-master-32float.wav`;
  const wav24Name = `${baseName}-master-24bit.wav`;
  const wav16Name = `${baseName}-master-16bit-dithered.wav`;
  const mp3Name = `${baseName}-master-320.mp3`;
  const wavExports = await encodeExportsLocally(buffer, options);

  if (state.wavUrl) URL.revokeObjectURL(state.wavUrl);
  state.wavUrl = URL.createObjectURL(new Blob([wavExports.wav32], { type: "audio/wav" }));
  enableDownload(els.wavDownloadLink, state.wavUrl, wavName, "Download WAV 32-bit float");

  if (state.wav24Url) URL.revokeObjectURL(state.wav24Url);
  state.wav24Url = URL.createObjectURL(new Blob([wavExports.wav24], { type: "audio/wav" }));
  enableDownload(els.wav24DownloadLink, state.wav24Url, wav24Name, "Download WAV 24-bit PCM");

  if (state.wav16Url) URL.revokeObjectURL(state.wav16Url);
  state.wav16Url = URL.createObjectURL(new Blob([wavExports.wav16], { type: "audio/wav" }));
  enableDownload(els.wav16DownloadLink, state.wav16Url, wav16Name, "Download WAV 16-bit dithered");

  if (state.mp3Url) URL.revokeObjectURL(state.mp3Url);
  if (window.lamejs?.Mp3Encoder || isMp3WorkerAvailable()) {
    try {
      const mp3 = await encodeMp3Local(buffer, 320);
      state.mp3Url = URL.createObjectURL(mp3.blob);
      enableDownload(els.mp3DownloadLink, state.mp3Url, mp3Name, "Download MP3 320");
      els.encoderStatus.textContent = mp3.offMainThread ? COPY.encoder.localWorker : COPY.encoder.local;
    } catch (error) {
      console.error(error);
      disableDownload(els.mp3DownloadLink, "MP3 encode failed");
      els.encoderStatus.textContent = "MP3 export failed, but the lossless WAV downloads are ready.";
    }
  } else {
    disableDownload(els.mp3DownloadLink, "MP3 encoder unavailable");
    els.encoderStatus.textContent = "Local MP3 encoder did not load. WAV downloads are still ready.";
  }

  els.exportText.textContent = COPY.export.ready;
  setExportState("is-ready");
  updateExportRecommendation();
}

function isMp3WorkerAvailable() {
  return !state.mp3WorkerFailed && typeof Worker !== "undefined";
}

function getMp3Worker() {
  if (state.mp3WorkerFailed) return null;
  if (!state.mp3Worker) {
    try {
      state.mp3Worker = new Worker("mp3-worker.js");
    } catch (error) {
      console.warn("MP3 worker could not be created; will encode on the main thread.", error);
      state.mp3WorkerFailed = true;
      state.mp3Worker = null;
    }
  }
  return state.mp3Worker;
}

export function disposeMp3Worker(markFailed = false) {
  if (state.mp3Worker) state.mp3Worker.terminate();
  state.mp3Worker = null;
  if (markFailed) state.mp3WorkerFailed = true;
}

function encodeMp3WithWorker(buffer, kbps) {
  return new Promise((resolve, reject) => {
    const worker = getMp3Worker();
    if (!worker) {
      reject(new Error("MP3 worker unavailable"));
      return;
    }

    const channels = Math.min(buffer.numberOfChannels, 2);
    const left = buffer.getChannelData(0).slice();
    const right = channels > 1 ? buffer.getChannelData(1).slice() : null;
    const transfer = [left.buffer];
    if (right) transfer.push(right.buffer);

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = (event) => {
      cleanup();
      if (event.data && event.data.ok) {
        resolve(event.data.data);
      } else {
        reject(new Error(event.data?.error || "MP3 worker failed"));
      }
    };
    const onError = (event) => {
      cleanup();
      disposeMp3Worker(true);
      reject(new Error(event.message || "MP3 worker error"));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ channels, sampleRate: buffer.sampleRate, kbps, left, right }, transfer);
  });
}

async function encodeMp3Local(buffer, kbps) {
  if (isMp3WorkerAvailable()) {
    try {
      const data = await encodeMp3WithWorker(buffer, kbps);
      return { blob: new Blob([data], { type: "audio/mpeg" }), offMainThread: true };
    } catch (error) {
      console.warn("Falling back to main-thread MP3 encoding.", error);
    }
  }
  const chunks = encodeMp3(buffer, kbps);
  return { blob: new Blob(chunks, { type: "audio/mpeg" }), offMainThread: false };
}

export function enableDownload(link, href, download, text) {
  link.href = href;
  link.download = download;
  link.textContent = text;
  link.classList.remove("disabled");
  link.removeAttribute("aria-disabled");
}

export function disableDownload(link, text) {
  link.removeAttribute("href");
  link.removeAttribute("download");
  link.textContent = text;
  link.classList.add("disabled");
  link.setAttribute("aria-disabled", "true");
}

export function disableExports() {
  disableDownload(els.wavDownloadLink, "Download WAV 32-bit float");
  disableDownload(els.wav24DownloadLink, "Download WAV 24-bit PCM");
  disableDownload(els.wav16DownloadLink, "Download WAV 16-bit dithered");
  disableDownload(els.mp3DownloadLink, "Download MP3 320");
  els.exportText.textContent = COPY.export.busy;
  setExportState("is-busy");
}

function encodeMp3(buffer, kbps) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const encoder = new window.lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps);
  const blockSize = 1152;
  const mp3Data = [];
  const left = floatToInt16(buffer.getChannelData(0));
  const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : left;

  for (let i = 0; i < left.length; i += blockSize) {
    const leftChunk = left.subarray(i, i + blockSize);
    const rightChunk = right.subarray(i, i + blockSize);
    const chunk = channels > 1 ? encoder.encodeBuffer(leftChunk, rightChunk) : encoder.encodeBuffer(leftChunk);
    if (chunk.length > 0) mp3Data.push(chunk);
  }
  const flush = encoder.flush();
  if (flush.length > 0) mp3Data.push(flush);
  return mp3Data;
}

function floatToInt16(floatData) {
  const output = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i += 1) {
    const sample = clamp(floatData[i], -1, 1);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function loadLocalEncoderScript() {
  if (window.lamejs?.Mp3Encoder) return;
  const script = document.createElement("script");
  script.src = "vendor/lame.min.js";
  script.defer = true;
  document.head.appendChild(script);
}
