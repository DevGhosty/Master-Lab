export const state = {
  audioContext: null,
  originalBuffer: null,
  masteredBuffer: null,
  originalUrl: null,
  masteredPreviewUrl: null,
  wavUrl: null,
  wav24Url: null,
  wav16Url: null,
  mp3Url: null,
  activeSource: "original",
  selectedPreset: "streaming",
  animationId: null,
  file: null,
  fileName: "",
  fileExtension: "",
  bitDepth: null,
  analysis: null,
  masteredAnalysis: null,
  limiterReductionDb: 0,
  progressStep: null,
  mp3Worker: null,
  mp3WorkerFailed: false,
  apiProbe: null,
  originalWaveformPeaks: null,
  masteredWaveformPeaks: null,
  masterJobId: null,
  lastReadiness: null,
};

export function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  return state.audioContext;
}

export function cleanupUrls() {
  if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
  if (state.masteredPreviewUrl) URL.revokeObjectURL(state.masteredPreviewUrl);
  if (state.wavUrl) URL.revokeObjectURL(state.wavUrl);
  if (state.wav24Url) URL.revokeObjectURL(state.wav24Url);
  if (state.wav16Url) URL.revokeObjectURL(state.wav16Url);
  if (state.mp3Url) URL.revokeObjectURL(state.mp3Url);
  state.originalUrl = null;
  state.masteredPreviewUrl = null;
  state.wavUrl = null;
  state.wav24Url = null;
  state.wav16Url = null;
  state.mp3Url = null;
}
