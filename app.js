import {
  COPY,
  isApiMode,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_DURATION_SECONDS,
  MAX_CHANNELS,
} from "./constants.js";
import {
  sanitizeBaseName,
  getExtension,
  formatBytes,
  formatTime,
  clearChildren,
  nextFrame,
} from "./utils.js";
import { PRESETS } from "./presets.js";
import { state, getAudioContext, cleanupUrls } from "./state.js";
import { buildWarnings, getReadiness, parseBitDepth, hasAudibleSignal } from "./analysis.js";
import { buildMixAssistant, buildMasterReport } from "./assistant.js";
import { masterBuffer } from "./mastering.js";
import { analyzeBufferLocally, cancelLocalAudioWork, LocalJobCancelled } from "./localAudio.js";
import {
  els,
  setStatus,
  setAppPhase,
  setStatusBanner,
  clearStatusBanner,
  updateDropzoneState,
  setExportState,
  applyModeCopy,
  syncPresetButtonCopy,
  resetAnalysisPanel,
  setMasteringControlsLocked,
  updatePreviewModeHelp,
  updateExportRecommendation,
  updateWorkflowGuidance,
  setProgress,
  selectPreset,
  updateControlOutputs,
  readControls,
  renderAnalysis,
  renderDecodeError,
  renderMixAssistant,
  renderMasterReport,
} from "./dom.js";
import {
  updateStats,
  drawWaveform,
  setPlaybackSource,
  setSourceTabs,
  pausePlayback,
  togglePlayback,
  seekPlayback,
  seekWaveform,
  nudgeWaveformSeek,
  applyPreviewVolume,
  updatePlaybackProgress,
  drawEmptyCanvas,
} from "./waveform.js";
import {
  disableExports,
  disableDownload,
  prepareDownloads,
  createPreviewUrl,
  disposeMp3Worker,
  loadLocalEncoderScript,
} from "./export.js";
import { loadFileViaApi, runMasteringViaApi, startServerStatusMonitor, stopServerStatusMonitor, wakeServer } from "./api.js";

function beginLocalJob(label) {
  cancelLocalJob(false);
  const controller = new AbortController();
  const job = {
    id: state.localJobSeq + 1,
    label,
    controller,
  };
  state.localJobSeq = job.id;
  state.localJob = job;
  if (els.cancelLocalButton) {
    els.cancelLocalButton.hidden = false;
    els.cancelLocalButton.disabled = false;
  }
  return job;
}

function finishLocalJob(job) {
  if (state.localJob?.id !== job.id) return;
  state.localJob = null;
  if (els.cancelLocalButton) {
    els.cancelLocalButton.hidden = true;
    els.cancelLocalButton.disabled = false;
  }
}

function ensureLocalJobActive(job) {
  if (state.localJob?.id !== job.id || job.controller.signal.aborted) {
    throw new LocalJobCancelled();
  }
}

function cancelLocalJob(showStatus = true) {
  if (!state.localJob) return;
  state.localJob.controller.abort();
  state.localJob = null;
  cancelLocalAudioWork();
  disposeMp3Worker();
  if (els.cancelLocalButton) {
    els.cancelLocalButton.hidden = true;
    els.cancelLocalButton.disabled = false;
  }
  if (showStatus) {
    setStatus("Local processing cancelled.");
    setProgress("analyze", 0, "Cancelled");
  }
}

async function loadFile(file) {
  resetSession(false);
  clearStatusBanner();
  updateDropzoneState(true, file.name);
  state.file = file;
  state.fileName = sanitizeBaseName(file.name);
  state.fileExtension = getExtension(file.name);

  if (isApiMode()) {
    return loadFileViaApi(file);
  }

  if (!file.type.startsWith("audio/") && !SUPPORTED_EXTENSIONS.has(state.fileExtension)) {
    renderDecodeError(file, "This file type is not supported yet.");
    return;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    renderDecodeError(file, `This file is larger than ${formatBytes(MAX_FILE_SIZE_BYTES)}. Try a shorter export or a smaller file.`);
    return;
  }

  setAppPhase("loaded");
  setStatus("Uploading audio...");
  setProgress("analyze", 12, "Uploading audio");
  const localJob = beginLocalJob("analysis");

  try {
    const arrayBuffer = await file.arrayBuffer();
    ensureLocalJobActive(localJob);
    state.bitDepth = parseBitDepth(arrayBuffer);
    setStatus("Decoding audio...");
    setProgress("analyze", 24, "Decoding started");

    const decoded = await getAudioContext().decodeAudioData(arrayBuffer.slice(0));
    ensureLocalJobActive(localJob);
    if (!decoded.duration || decoded.length === 0) {
      renderDecodeError(file, "No usable audio was detected in this file.");
      return;
    }
    if (decoded.duration > MAX_DURATION_SECONDS) {
      renderDecodeError(file, `This file is longer than ${formatTime(MAX_DURATION_SECONDS)}. For now, upload a shorter master.`);
      return;
    }
    if (decoded.numberOfChannels > MAX_CHANNELS) {
      renderDecodeError(file, "This prototype currently supports mono or stereo files. Export a stereo WAV or MP3 and upload again.");
      return;
    }
    setStatus("Analyzing original file...");
    setProgress("analyze", 32, "Analysis running");
    const { analysis, waveformPeaks } = await analyzeBufferLocally(decoded, {
      signal: localJob.controller.signal,
      onProgress({ progress, message }) {
        setProgress("analyze", progress, message);
        setStatus(message);
      },
    });
    ensureLocalJobActive(localJob);
    const warnings = buildWarnings(file, decoded, analysis);
    const readiness = getReadiness(warnings, analysis);

    state.originalBuffer = decoded;
    state.analysis = analysis;
    state.originalWaveformPeaks = waveformPeaks;
    state.originalUrl = URL.createObjectURL(file);

    els.originalPlayer.src = state.originalUrl;
    els.originalPlayer.load();
    els.trackTitle.textContent = file.name.replace(/\.[^/.]+$/, "") || file.name;
    els.trackDetails.textContent =
      `${decoded.numberOfChannels} channel${decoded.numberOfChannels === 1 ? "" : "s"} · ${decoded.sampleRate.toLocaleString()} Hz · ${formatTime(decoded.duration)}`;
    els.durationTime.textContent = formatTime(decoded.duration);

    renderAnalysis(file, decoded, analysis, warnings, readiness);
    renderMixAssistant(buildMixAssistant({ analysis, warnings, file }));
    updateStats();
    drawWaveform();
    setPlaybackSource("original", false);
    setProgress("prepare", 45, "Ready to master");
    setAppPhase("analyzed");
    setStatus(
      readiness.level === "good" ? COPY.status.readyToMaster : COPY.status.analysisDone
    );

    els.masterButton.disabled = !hasAudibleSignal(analysis);
    els.playButton.disabled = false;
    els.seekSlider.disabled = false;
    els.resetButton.disabled = false;
    els.emptyWave.classList.add("hidden");
  } catch (error) {
    if (error instanceof LocalJobCancelled) {
      setStatus("Local analysis cancelled.");
      setProgress("analyze", 0, "Cancelled");
      return;
    }
    console.error(error);
    renderDecodeError(file, "We could not decode this audio file. Try exporting it as WAV or MP3 and upload again.");
  } finally {
    finishLocalJob(localJob);
  }
}

async function runMastering() {
  if (!state.originalBuffer && !state.apiProbe) return;

  if (isApiMode()) {
    return runMasteringViaApi();
  }

  pausePlayback();
  clearStatusBanner();
  disableExports();
  els.masterButton.disabled = true;
  els.masterButton.textContent = "Mastering...";
  const localJob = beginLocalJob("mastering");

  try {
    setStatus("Preparing master...");
    setProgress("prepare", 55, "Preparing master");
    await nextFrame();
    ensureLocalJobActive(localJob);

    const controls = readControls();
    setStatus(`Applying ${PRESETS[state.selectedPreset].label} preset...`);
    setProgress("apply", 68, "Mastering rendering");
    await nextFrame();
    ensureLocalJobActive(localJob);

    state.limiterReductionDb = 0;
    const mastered = await masterBuffer(state.originalBuffer, controls);
    ensureLocalJobActive(localJob);
    state.masteredBuffer = mastered;
    setStatus("Analyzing mastered audio...");
    const masteredResult = await analyzeBufferLocally(mastered, {
      signal: localJob.controller.signal,
      onProgress({ progress, message }) {
        setProgress("preview", Math.max(78, progress), message);
        setStatus(message);
      },
    });
    ensureLocalJobActive(localJob);
    state.masteredAnalysis = masteredResult.analysis;
    state.masteredWaveformPeaks = masteredResult.waveformPeaks;
    state.masterReport = buildMasterReport({
      originalAnalysis: state.analysis,
      masteredAnalysis: state.masteredAnalysis,
      presetKey: state.selectedPreset,
      controls,
      limiterReductionDb: state.limiterReductionDb,
    });

    setStatus("Creating preview...");
    setProgress("preview", 84, "Creating preview");
    await createPreviewUrl(mastered, {
      signal: localJob.controller.signal,
      onProgress({ progress, message }) {
        setProgress("preview", progress, message);
        setStatus(message);
      },
    });
    ensureLocalJobActive(localJob);

    setStatus("Preparing downloads...");
    setProgress("download", 92, "Export encoding");
    await prepareDownloads(mastered, {
      signal: localJob.controller.signal,
      onProgress({ progress, message }) {
        setProgress("download", progress, message);
        setStatus(message);
      },
    });
    ensureLocalJobActive(localJob);

    els.masteredTab.disabled = false;
    els.compareTab.disabled = false;
    els.volumeMatchToggle.disabled = false;
    updateStats();
    renderMasterReport(state.masterReport);
    setPlaybackSource("mastered", false);
    setProgress("done", 100, "Master ready");
    setAppPhase("mastered");
    setStatusBanner(COPY.status.masterReady, "success");
    setStatus(COPY.status.masterReady);
  } catch (error) {
    if (error instanceof LocalJobCancelled) {
      setStatus("Local mastering cancelled.");
      setProgress("prepare", 0, "Cancelled");
      return;
    }
    console.error(error);
    setAppPhase("error");
    setStatusBanner(COPY.errors.masterFailed, "error");
    setStatus(COPY.errors.masterFailed);
    setProgress("prepare", 0, "Mastering failed");
  } finally {
    finishLocalJob(localJob);
    els.masterButton.disabled = !state.originalBuffer || !hasAudibleSignal(state.analysis);
    els.masterButton.textContent = "Master file";
  }
}

function resetMasterOnly() {
  if (state.masteredPreviewUrl) URL.revokeObjectURL(state.masteredPreviewUrl);
  if (state.wavUrl) URL.revokeObjectURL(state.wavUrl);
  if (state.wav24Url) URL.revokeObjectURL(state.wav24Url);
  if (state.wav16Url) URL.revokeObjectURL(state.wav16Url);
  if (state.mp3Url) URL.revokeObjectURL(state.mp3Url);
  state.masteredBuffer = null;
  state.masteredAnalysis = null;
  state.apiProbe = null;
  state.apiSessionId = null;
  state.originalWaveformPeaks = null;
  state.masteredWaveformPeaks = null;
  state.masterJobId = null;
  state.limiterReductionDb = 0;
  state.masterReport = null;
  state.masteredPreviewUrl = null;
  state.wavUrl = null;
  state.wav24Url = null;
  state.wav16Url = null;
  state.mp3Url = null;
  els.masteredPlayer.removeAttribute("src");
  els.masteredTab.disabled = true;
  els.compareTab.disabled = true;
  els.volumeMatchToggle.checked = false;
  els.volumeMatchToggle.disabled = true;
  disableDownload(els.wavDownloadLink, "Download WAV 32-bit float");
  disableDownload(els.wav24DownloadLink, "Download WAV 24-bit PCM");
  disableDownload(els.wav16DownloadLink, "Download WAV 16-bit dithered");
  disableDownload(els.mp3DownloadLink, "Download MP3 320");
  els.exportText.textContent = COPY.export.pending;
  setExportState("is-pending");
  els.encoderStatus.textContent = isApiMode() ? COPY.encoder.server : COPY.encoder.local;
  updatePreviewModeHelp();
  updateExportRecommendation();
  renderMasterReport(null);
}

function resetSession(clearInput = true) {
  cancelLocalJob(false);
  pausePlayback();
  clearStatusBanner();
  cleanupUrls();
  state.originalBuffer = null;
  state.masteredBuffer = null;
  state.activeSource = "original";
  state.file = null;
  state.fileName = "";
  state.fileExtension = "";
  state.bitDepth = null;
  state.analysis = null;
  state.masteredAnalysis = null;
  state.lastReadiness = null;
  state.mixAssistant = null;
  state.masterReport = null;

  if (clearInput) els.fileInput.value = "";
  els.originalPlayer.removeAttribute("src");
  els.masteredPlayer.removeAttribute("src");
  els.trackTitle.textContent = "No track loaded";
  els.trackDetails.textContent = "Original and mastered waveforms will appear here.";
  resetAnalysisPanel();
  renderMixAssistant(null);
  clearChildren(els.analysisGrid);
  setMasteringControlsLocked(true);
  clearChildren(els.warningList);
  updateDropzoneState(false);
  setAppPhase("empty");
  els.masterButton.disabled = true;
  els.playButton.disabled = true;
  els.seekSlider.disabled = true;
  els.resetButton.disabled = true;
  els.emptyWave.classList.remove("hidden");
  els.currentTime.textContent = "0:00";
  els.durationTime.textContent = "0:00";
  els.playhead.classList.remove("visible");
  els.originalRms.textContent = "--";
  els.masterRms.textContent = "--";
  els.originalPeak.textContent = "--";
  els.masterPeak.textContent = "--";
  els.levelSummary.textContent = "Upload a file to see level estimates.";
  els.peakMeter.style.width = "0%";
  els.peakLabel.textContent = "--";
  resetMasterOnly();
  setSourceTabs("original");
  drawEmptyCanvas();
  setProgress("analyze", 0, "Ready");
  setStatus(isApiMode() ? COPY.status.serverIdle : COPY.status.idle);
}

els.fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) loadFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("dragging");
  });
});

els.dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) loadFile(file);
});

els.masterButton.addEventListener("click", runMastering);
if (els.cancelLocalButton) {
  els.cancelLocalButton.addEventListener("click", () => cancelLocalJob(true));
}
els.resetButton.addEventListener("click", resetSession);
els.playButton.addEventListener("click", togglePlayback);
els.seekSlider.addEventListener("input", seekPlayback);
els.waveformWrap.addEventListener("click", seekWaveform);
els.waveformWrap.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    nudgeWaveformSeek(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    nudgeWaveformSeek(1);
  }
});
els.originalTab.addEventListener("click", () => setPlaybackSource("original"));
els.masteredTab.addEventListener("click", () => setPlaybackSource("mastered"));
els.compareTab.addEventListener("click", () => setPlaybackSource("compare"));
els.volumeMatchToggle.addEventListener("change", () => {
  applyPreviewVolume();
});
els.intensitySlider.addEventListener("input", updateControlOutputs);
els.presetButtons.forEach((button) => {
  button.addEventListener("click", () => selectPreset(button.dataset.preset));
});

[els.originalPlayer, els.masteredPlayer].forEach((player) => {
  player.addEventListener("ended", pausePlayback);
  player.addEventListener("loadedmetadata", updatePlaybackProgress);
});

window.addEventListener("resize", () => {
  if (state.originalBuffer || state.originalWaveformPeaks) drawWaveform();
});

window.addEventListener("pagehide", () => {
  cancelLocalJob(false);
  cleanupUrls();
  disposeMp3Worker();
  stopServerStatusMonitor();
});

function initApp() {
  applyModeCopy();
  syncPresetButtonCopy();
  resetAnalysisPanel();
  setMasteringControlsLocked(true);
  setAppPhase("empty");
  updateDropzoneState(false);
  setExportState("is-pending");
  if (!isApiMode()) {
    loadLocalEncoderScript();
  }
  setStatus(isApiMode() ? COPY.status.serverIdle : COPY.status.idle);
  selectPreset("streaming", true);
  setProgress("analyze", 0, "Ready");
  drawEmptyCanvas();
  updateWorkflowGuidance();
  if (els.wakeServerButton) {
    els.wakeServerButton.addEventListener("click", () => {
      wakeServer();
    });
  }
  if (els.presetRecommendationSelect) {
    els.presetRecommendationSelect.addEventListener("click", () => {
      const presetKey = els.presetRecommendationSelect.dataset.preset || state.recommendedPresetKey;
      if (presetKey) selectPreset(presetKey);
    });
  }
  startServerStatusMonitor();
}

initApp();
