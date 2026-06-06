import { analyzeAudioBuffer } from "./analysis.js";
import { encodeWavFloat32FromChannels, encodeWavPcmFromChannels } from "./audioEncoding.js";

let worker = null;
let workerFailed = false;
let nextTaskId = 1;
const pendingTasks = new Map();

export class LocalJobCancelled extends Error {
  constructor(message = "Local job cancelled") {
    super(message);
    this.name = "LocalJobCancelled";
  }
}

export function cancelLocalAudioWork() {
  if (worker) worker.terminate();
  worker = null;
  for (const task of pendingTasks.values()) {
    task.reject(new LocalJobCancelled());
  }
  pendingTasks.clear();
}

export async function analyzeBufferLocally(buffer, options = {}) {
  return runWorkerTask("analyze", buffer, options, () => {
    options.onProgress?.({ progress: 35, message: "Analysis running" });
    const analysis = analyzeAudioBuffer(buffer);
    options.onProgress?.({ progress: 42, message: "Preparing waveform" });
    return {
      analysis,
      waveformPeaks: buildWaveformPeaks(buffer, options.waveformWidth || 1200),
    };
  });
}

export async function encodePreviewLocally(buffer, options = {}) {
  return runWorkerTask("encode-preview", buffer, options, () => {
    options.onProgress?.({ progress: 84, message: "Creating preview" });
    return { wav: encodeWavFloat32FromChannels(buffer) };
  });
}

export async function encodeExportsLocally(buffer, options = {}) {
  return runWorkerTask("encode-exports", buffer, options, () => {
    options.onProgress?.({ progress: 92, message: "Export encoding" });
    return {
      wav32: encodeWavFloat32FromChannels(buffer),
      wav24: encodeWavPcmFromChannels(buffer, 24, false),
      wav16: encodeWavPcmFromChannels(buffer, 16, true),
    };
  });
}

async function runWorkerTask(type, buffer, options, fallback) {
  if (options.signal?.aborted) throw new LocalJobCancelled();
  if (!canUseWorker()) return fallback();

  try {
    return await postWorkerTask(type, buffer, options);
  } catch (error) {
    if (error instanceof LocalJobCancelled) throw error;
    console.warn("Local audio worker failed; falling back to main thread.", error);
    workerFailed = true;
    cancelLocalAudioWork();
    return fallback();
  }
}

function canUseWorker() {
  return !workerFailed && typeof Worker !== "undefined";
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker("local-audio-worker.js", { type: "module" });
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Local audio worker error");
    failWorker(error);
  });
  return worker;
}

function failWorker(error) {
  workerFailed = true;
  if (worker) worker.terminate();
  worker = null;
  for (const task of pendingTasks.values()) {
    task.reject(error);
  }
  pendingTasks.clear();
}

function postWorkerTask(type, buffer, options) {
  return new Promise((resolve, reject) => {
    const taskWorker = getWorker();
    const id = nextTaskId;
    nextTaskId += 1;
    const { payload, transfer } = serializeAudioBuffer(buffer);
    payload.waveformWidth = options.waveformWidth || 1200;

    const abort = () => {
      pendingTasks.delete(id);
      cancelLocalAudioWork();
      reject(new LocalJobCancelled());
    };
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
        return;
      }
      options.signal.addEventListener("abort", abort, { once: true });
    }

    pendingTasks.set(id, {
      resolve(value) {
        options.signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject(error) {
        options.signal?.removeEventListener("abort", abort);
        reject(error);
      },
      onProgress: options.onProgress,
    });
    try {
      taskWorker.postMessage({ id, type, payload }, transfer);
    } catch (error) {
      pendingTasks.delete(id);
      reject(error);
    }
  });
}

function handleWorkerMessage(event) {
  const { id, type, result, error, progress, message } = event.data || {};
  const task = pendingTasks.get(id);
  if (!task) return;
  if (type === "progress") {
    task.onProgress?.({ progress, message });
    return;
  }
  pendingTasks.delete(id);
  if (type === "complete") {
    task.resolve(result);
  } else {
    task.reject(new Error(error || "Local audio worker failed"));
  }
}

function serializeAudioBuffer(buffer) {
  const channelData = [];
  const transfer = [];
  const channels = Math.min(buffer.numberOfChannels, 2);
  for (let c = 0; c < channels; c += 1) {
    const copy = buffer.getChannelData(c).slice();
    channelData.push(copy.buffer);
    transfer.push(copy.buffer);
  }
  return {
    payload: {
      sampleRate: buffer.sampleRate,
      numberOfChannels: channels,
      length: buffer.length,
      channelData,
    },
    transfer,
  };
}

function buildWaveformPeaks(buffer, width = 1200) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const block = Math.max(1, Math.floor(length / width));
  const peaks = [];
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * block;
    for (let i = 0; i < block && start + i < length; i += 1) {
      let sample = 0;
      for (let c = 0; c < channels; c += 1) {
        sample += buffer.getChannelData(c)[start + i];
      }
      sample /= channels;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    peaks.push({ min, max });
  }
  return peaks;
}
