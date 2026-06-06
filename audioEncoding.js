import { clamp } from "./utils.js";

export function encodeWavFloat32FromChannels(audio) {
  const channels = Math.min(audio.numberOfChannels, 2);
  const sampleRate = audio.sampleRate;
  const length = audio.length;
  const bytesPerSample = 4;
  const blockAlign = channels * bytesPerSample;
  const dataLength = length * blockAlign;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  writeWavHeader(view, {
    audioFormat: 3,
    channels,
    sampleRate,
    bitsPerSample: 32,
    dataLength,
    blockAlign,
  });

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      view.setFloat32(offset, audio.getChannelData(c)[i], true);
      offset += bytesPerSample;
    }
  }
  return wav;
}

export function encodeWavPcmFromChannels(audio, bitDepth, dither) {
  const channels = Math.min(audio.numberOfChannels, 2);
  const sampleRate = audio.sampleRate;
  const length = audio.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataLength = length * blockAlign;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  writeWavHeader(view, {
    audioFormat: 1,
    channels,
    sampleRate,
    bitsPerSample: bitDepth,
    dataLength,
    blockAlign,
  });

  let offset = 44;
  const maxInt = bitDepth === 24 ? 0x7fffff : 0x7fff;
  const minInt = bitDepth === 24 ? -0x800000 : -0x8000;
  const ditherScale = dither ? 1 / maxInt : 0;
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      // TPDF dither decorrelates 16-bit quantization error from the signal.
      const noise = dither ? (Math.random() - Math.random()) * ditherScale : 0;
      const sample = clamp(audio.getChannelData(c)[i] + noise, -1, 1);
      const intSample = Math.max(minInt, Math.min(maxInt, Math.round(sample < 0 ? sample * -minInt : sample * maxInt)));
      if (bitDepth === 24) {
        view.setUint8(offset, intSample & 0xff);
        view.setUint8(offset + 1, (intSample >> 8) & 0xff);
        view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        offset += 3;
      } else {
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }
  }
  return wav;
}

function writeWavHeader(view, config) {
  const { audioFormat, channels, sampleRate, bitsPerSample, dataLength, blockAlign } = config;
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
