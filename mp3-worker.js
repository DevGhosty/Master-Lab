/* MP3 encode worker: runs the lamejs encoder off the main thread to keep the UI responsive. */
importScripts("vendor/lame.min.js");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function floatToInt16(floatData) {
  const output = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i += 1) {
    const sample = clamp(floatData[i], -1, 1);
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

self.onmessage = (event) => {
  const { channels, sampleRate, kbps, left, right } = event.data;
  try {
    if (!self.lamejs || !self.lamejs.Mp3Encoder) {
      throw new Error("lamejs encoder unavailable in worker");
    }
    const encoder = new self.lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const blockSize = 1152;
    const leftInt = floatToInt16(left);
    const rightInt = channels > 1 ? floatToInt16(right) : leftInt;
    const chunks = [];
    let total = 0;

    for (let i = 0; i < leftInt.length; i += blockSize) {
      const leftChunk = leftInt.subarray(i, i + blockSize);
      const rightChunk = rightInt.subarray(i, i + blockSize);
      const chunk = channels > 1 ? encoder.encodeBuffer(leftChunk, rightChunk) : encoder.encodeBuffer(leftChunk);
      if (chunk.length > 0) {
        chunks.push(chunk);
        total += chunk.length;
      }
    }

    const flush = encoder.flush();
    if (flush.length > 0) {
      chunks.push(flush);
      total += flush.length;
    }

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    self.postMessage({ ok: true, data: output }, [output.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: String(error && error.message ? error.message : error) });
  }
};
