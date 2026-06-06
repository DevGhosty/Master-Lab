import { analyzeAudioBuffer } from "./analysis.js";
import { encodeWavFloat32FromChannels, encodeWavPcmFromChannels } from "./audioEncoding.js";

function makeAudioBufferShim(payload) {
  const channelData = payload.channelData.map((buffer) => new Float32Array(buffer));
  return {
    sampleRate: payload.sampleRate,
    numberOfChannels: channelData.length,
    length: payload.length,
    duration: payload.length / payload.sampleRate,
    getChannelData(index) {
      return channelData[index];
    },
  };
}

function buildWaveformPeaks(audio, width = 1200) {
  const channels = audio.numberOfChannels;
  const length = audio.length;
  const block = Math.max(1, Math.floor(length / width));
  const peaks = [];
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * block;
    for (let i = 0; i < block && start + i < length; i += 1) {
      let sample = 0;
      for (let c = 0; c < channels; c += 1) {
        sample += audio.getChannelData(c)[start + i];
      }
      sample /= channels;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    peaks.push({ min, max });
  }
  return peaks;
}

function postProgress(id, progress, message) {
  self.postMessage({ id, type: "progress", progress, message });
}

self.addEventListener("message", (event) => {
  const { id, type, payload } = event.data || {};
  try {
    const audio = makeAudioBufferShim(payload);
    if (type === "analyze") {
      postProgress(id, 35, "Analysis running");
      const analysis = analyzeAudioBuffer(audio);
      postProgress(id, 42, "Preparing waveform");
      const waveformPeaks = buildWaveformPeaks(audio, payload.waveformWidth || 1200);
      self.postMessage({ id, type: "complete", result: { analysis, waveformPeaks } });
      return;
    }

    if (type === "encode-preview") {
      postProgress(id, 84, "Creating preview");
      const wav = encodeWavFloat32FromChannels(audio);
      self.postMessage({ id, type: "complete", result: { wav } }, [wav]);
      return;
    }

    if (type === "encode-exports") {
      postProgress(id, 92, "Export encoding");
      const wav32 = encodeWavFloat32FromChannels(audio);
      postProgress(id, 94, "Export encoding");
      const wav24 = encodeWavPcmFromChannels(audio, 24, false);
      postProgress(id, 96, "Export encoding");
      const wav16 = encodeWavPcmFromChannels(audio, 16, true);
      self.postMessage({ id, type: "complete", result: { wav32, wav24, wav16 } }, [
        wav32,
        wav24,
        wav16,
      ]);
      return;
    }

    throw new Error(`Unknown worker task: ${type}`);
  } catch (error) {
    self.postMessage({ id, type: "error", error: error?.message || "Local audio worker failed" });
  }
});
