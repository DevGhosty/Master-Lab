import { state, getAudioContext } from "./state.js";
import { els, updatePreviewModeHelp } from "./dom.js";
import { clamp, formatTime, mixDown, dbToLinear, formatLufs, formatDbtp, formatDbValue } from "./utils.js";

export function updateStats() {
  if (!state.analysis) return;

  els.originalRms.textContent = formatLufs(state.analysis.loudnessDb);
  els.originalPeak.textContent = formatDbtp(state.analysis.truePeakDb);

  if (state.masteredAnalysis) {
    const delta = state.masteredAnalysis.loudnessDb - state.analysis.loudnessDb;
    const limiterText = state.limiterReductionDb < -0.1 ? ` Limiter reduced peaks by up to ${Math.abs(state.limiterReductionDb).toFixed(1)} dB.` : "";
    els.masterRms.textContent = formatLufs(state.masteredAnalysis.loudnessDb);
    els.masterPeak.textContent = formatDbtp(state.masteredAnalysis.truePeakDb);
    els.levelSummary.textContent = `Master is ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} LU from original. Crest: ${state.analysis.crestDb.toFixed(1)} dB → ${state.masteredAnalysis.crestDb.toFixed(1)} dB.${limiterText}`;
    updatePeakMeter(state.masteredAnalysis.truePeakDb);
  } else {
    els.masterRms.textContent = "--";
    els.masterPeak.textContent = "--";
    els.levelSummary.textContent = "Original LUFS, true peak, and dynamics are shown before mastering.";
    updatePeakMeter(state.analysis.truePeakDb);
  }
}

function updatePeakMeter(peakDb) {
  els.peakMeter.style.width = `${Math.min(100, Math.max(0, (peakDb + 60) * (100 / 60)))}%`;
  els.peakLabel.textContent = formatDbValue(peakDb);
}

export function drawWaveform() {
  const canvas = els.waveCanvas;
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));

  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.strokeStyle = "rgba(104, 112, 108, 0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, rect.height / 2);
  ctx.lineTo(rect.width, rect.height / 2);
  ctx.stroke();

  if (
    state.activeSource === "compare" &&
    state.originalWaveformPeaks &&
    state.masteredWaveformPeaks
  ) {
    drawPeaksWaveform(ctx, state.originalWaveformPeaks, rect, "#64716d", 0.68, -0.08);
    drawPeaksWaveform(ctx, state.masteredWaveformPeaks, rect, "#d98928", 0.6, 0.08);
  } else if (state.activeSource === "compare" && state.originalBuffer && state.masteredBuffer) {
    drawBufferWaveform(ctx, state.originalBuffer, rect, "#64716d", 0.68, -0.08);
    drawBufferWaveform(ctx, state.masteredBuffer, rect, "#d98928", 0.6, 0.08);
    drawDifferenceBand(ctx, state.originalBuffer, state.masteredBuffer, rect);
  } else if (state.activeSource === "mastered" && state.masteredWaveformPeaks) {
    drawPeaksWaveform(ctx, state.masteredWaveformPeaks, rect, "#d98928", 0.9, 0);
  } else if (state.activeSource === "original" && state.originalWaveformPeaks) {
    drawPeaksWaveform(ctx, state.originalWaveformPeaks, rect, "#0a7b75", 0.9, 0);
  } else {
    const buffer = state.activeSource === "mastered" ? state.masteredBuffer : state.originalBuffer;
    if (buffer) {
      drawBufferWaveform(ctx, buffer, rect, state.activeSource === "mastered" ? "#d98928" : "#0a7b75", 0.9, 0);
    }
  }
}

function drawPeaksWaveform(ctx, peaks, rect, color, alpha, offsetRatio) {
  if (!peaks?.length) return;
  const width = rect.width;
  const height = rect.height;
  const mid = height / 2 + height * offsetRatio;
  const maxAmp = height * 0.42;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let x = 0; x < width; x += 1) {
    const index = Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length));
    const { min, max } = peaks[index];
    const y1 = mid + min * maxAmp;
    const y2 = mid + max * maxAmp;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  ctx.globalAlpha = 1;
}

function drawBufferWaveform(ctx, buffer, rect, color, alpha, offsetRatio) {
  const data = mixDown(buffer);
  const width = rect.width;
  const height = rect.height;
  const mid = height / 2 + height * offsetRatio;
  const maxAmp = height * 0.42;
  const step = Math.max(1, Math.floor(data.length / width));

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * step;
    for (let i = 0; i < step && start + i < data.length; i += 1) {
      const sample = data[start + i];
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    const y1 = mid + min * maxAmp;
    const y2 = mid + max * maxAmp;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  ctx.globalAlpha = 1;
}

function drawDifferenceBand(ctx, original, mastered, rect) {
  const originalData = mixDown(original);
  const masteredData = mixDown(mastered);
  const width = rect.width;
  const step = Math.max(1, Math.floor(Math.min(originalData.length, masteredData.length) / width));
  const baseline = rect.height - 20;

  ctx.fillStyle = "rgba(198, 74, 59, 0.2)";
  for (let x = 0; x < width; x += 1) {
    let diff = 0;
    const start = x * step;
    for (let i = 0; i < step && start + i < originalData.length && start + i < masteredData.length; i += 1) {
      diff += Math.abs(masteredData[start + i] - originalData[start + i]);
    }
    diff /= step;
    ctx.fillRect(x, baseline - diff * 120, 1, Math.max(1, diff * 120));
  }
}

export function activePlayer() {
  return state.activeSource === "mastered" ? els.masteredPlayer : els.originalPlayer;
}

export function setPlaybackSource(source, preserveTime = true) {
  const hasMastered = Boolean(state.masteredBuffer || state.masteredPreviewUrl);
  if (source === "mastered" && !hasMastered) return;
  if (source === "compare" && !hasMastered) return;

  const current = activePlayer();
  const time = preserveTime ? current.currentTime : 0;
  const wasPlaying = !current.paused;
  pausePlayback();

  state.activeSource = source;
  const player = activePlayer();
  player.currentTime = Math.min(time, player.duration || time);
  applyPreviewVolume();
  setSourceTabs(source);
  drawWaveform();
  updatePlaybackProgress();

  if (wasPlaying) {
    player.play().then(updatePlaybackProgress).catch(() => {});
    els.playIcon.textContent = "Pause";
  }
  updatePreviewModeHelp(source);
}

export function setSourceTabs(source) {
  [
    [els.originalTab, "original"],
    [els.masteredTab, "mastered"],
    [els.compareTab, "compare"],
  ].forEach(([button, value]) => {
    const selected = source === value;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

export function pausePlayback() {
  els.originalPlayer.pause();
  els.masteredPlayer.pause();
  els.playIcon.textContent = "Play";
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
    state.animationId = null;
  }
}

export async function togglePlayback() {
  const player = activePlayer();
  if (!player.src) return;

  if (player.paused) {
    await getAudioContext().resume();
    await player.play();
    els.playIcon.textContent = "Pause";
    updatePlaybackProgress();
  } else {
    pausePlayback();
  }
}

export function updatePlaybackProgress() {
  const player = activePlayer();
  const duration = getActiveDuration();
  const current = player.currentTime || 0;
  els.currentTime.textContent = formatTime(current);
  els.durationTime.textContent = formatTime(duration);

  const progress = duration > 0 ? clamp(current / duration, 0, 1) : 0;
  els.seekSlider.value = Math.round(progress * 1000).toString();
  els.waveformWrap.setAttribute("aria-valuenow", Math.round(progress * 1000).toString());
  els.playhead.style.left = `${progress * 100}%`;
  els.playhead.classList.toggle("visible", duration > 0 && (state.originalBuffer || state.apiProbe));

  if (!player.paused) {
    state.animationId = requestAnimationFrame(updatePlaybackProgress);
  }
}

function getActiveDuration() {
  if (state.activeSource === "mastered") {
    return state.masteredBuffer?.duration ?? state.apiProbe?.duration ?? 0;
  }
  return state.originalBuffer?.duration ?? state.apiProbe?.duration ?? 0;
}

export function seekPlayback() {
  const player = activePlayer();
  const duration = getActiveDuration();
  if (duration > 0) {
    player.currentTime = (Number(els.seekSlider.value) / 1000) * duration;
    updatePlaybackProgress();
  }
}

export function seekWaveform(event) {
  const duration = getActiveDuration();
  const player = activePlayer();
  if (!duration || !player.src) return;

  const rect = els.waveformWrap.getBoundingClientRect();
  const progress = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  player.currentTime = progress * duration;
  updatePlaybackProgress();
}

export function nudgeWaveformSeek(direction) {
  const duration = getActiveDuration();
  const player = activePlayer();
  if (!duration || !player.src) return;
  player.currentTime = clamp(player.currentTime + direction * 5, 0, duration);
  updatePlaybackProgress();
}

export function applyPreviewVolume() {
  els.originalPlayer.volume = 1;
  els.masteredPlayer.volume = 1;
  if (!els.volumeMatchToggle.checked || !state.analysis || !state.masteredAnalysis) return;

  const diff = state.analysis.loudnessDb - state.masteredAnalysis.loudnessDb;
  els.masteredPlayer.volume = clamp(dbToLinear(diff), 0.25, 1);
  updatePreviewModeHelp();
}

export function drawEmptyCanvas() {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
