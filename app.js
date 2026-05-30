const PRESETS = {
  balanced: {
    label: "Balanced",
    whenToUse: "Most mixes that need a clear, natural lift without sounding pushed.",
    description: "A clean, natural master with moderate loudness.",
    targetLoudness: -14.5,
    ceilingDb: -1,
    intensity: 0.38,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
  },
  loud: {
    label: "Loud",
    whenToUse: "Club, rap, or EDM tracks where you want more level and punch.",
    description: "A louder master with more limiting.",
    targetLoudness: -12.5,
    ceilingDb: -1.2,
    intensity: 0.62,
    warmth: 0.48,
    air: 0.52,
    bass: 0,
  },
  warm: {
    label: "Warm",
    whenToUse: "Harsh or bright mixes, acoustic songs, or vocals that feel too edgy.",
    description: "A smoother sound with less harshness.",
    targetLoudness: -14.8,
    ceilingDb: -1,
    intensity: 0.36,
    warmth: 0.68,
    air: 0.38,
    bass: 0.15,
  },
  bright: {
    label: "Bright",
    whenToUse: "Dull or muddy mixes that need more clarity, air, and presence.",
    description: "Adds clarity and presence.",
    targetLoudness: -14.5,
    ceilingDb: -1,
    intensity: 0.4,
    warmth: 0.45,
    air: 0.68,
    bass: -0.05,
  },
  bass: {
    label: "Bass Boost",
    whenToUse: "Thin mixes, hip-hop, or electronic tracks that need more low-end weight.",
    description: "Adds more low-end weight.",
    targetLoudness: -14.3,
    ceilingDb: -1.2,
    intensity: 0.42,
    warmth: 0.6,
    air: 0.46,
    bass: 0.36,
  },
  streaming: {
    label: "Streaming Ready",
    whenToUse: "Default for Spotify, Apple Music, and YouTube—balanced loudness with safe peaks.",
    description: "Targets a clean streaming-friendly loudness.",
    targetLoudness: -14,
    ceilingDb: -1,
    intensity: 0.42,
    warmth: 0.5,
    air: 0.5,
    bass: 0,
  },
};

const LOSSY_EXTENSIONS = new Set(["mp3", "m4a", "aac", "ogg", "opus", "wma"]);
const LOSSLESS_EXTENSIONS = new Set(["wav", "aif", "aiff", "flac"]);
const SUPPORTED_EXTENSIONS = new Set([...LOSSY_EXTENSIONS, ...LOSSLESS_EXTENSIONS]);
const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;
const MAX_DURATION_SECONDS = 15 * 60;
const MAX_CHANNELS = 2;
const CLIPPING_THRESHOLD = 0.999;
const TRUE_PEAK_OVERSAMPLE = 4;
const LUFS_ABSOLUTE_GATE = -70;
const LUFS_RELATIVE_GATE_OFFSET = -10;
const API_FETCH_TIMEOUT_MS = 45000;

const COPY = {
  privacy: {
    local: "Audio stays in your browser. Nothing is uploaded.",
    server:
      "Audio is sent to the mastering server for analysis and rendering, then deleted. Original playback stays in your browser.",
  },
  limits: "Mono or stereo · 150 MB max · 15 min max",
  encoder: {
    local: "MP3 320 is encoded locally in your browser.",
    localWorker: "MP3 320 encoded locally on a background thread.",
    server: "MP3 320 encoded on server (ephemeral processing).",
  },
  emptyWave: {
    local: "Everything runs in your browser—upload a track to preview and master.",
    server: "Server analysis and mastering—upload a track to get started.",
  },
  status: {
    idle: "Upload audio to run an original audio check.",
    serverIdle: "Upload audio for server-side analysis (processed and deleted immediately).",
    analysisDone: "Original audio check complete. Choose a preset and master when ready.",
    analysisDoneServer: "Original audio check complete. Choose a preset and master when ready.",
    readyToMaster: "Ready to master",
    masterReady: "Your master is ready. Download it for free.",
    masterReadyServer: "Your master is ready. Processed on server and deleted after download.",
  },
  errors: {
    serverUnreachable: "Could not reach the mastering server. Try again in a moment.",
    serverWakeup: "Server may be waking up—retry in 30 seconds.",
    masterFailed: "Mastering failed. Your original file was not changed.",
  },
  export: {
    pending: "Run a master to prepare free downloads.",
    busy: "Preparing free downloads...",
    ready: "✓ Your master is ready. Download below.",
    recommendLossy: "Recommended: WAV 24-bit for your DAW, or MP3 320 for quick sharing.",
    recommendLossless: "Recommended: WAV 24-bit PCM for most releases; 32-bit float if your DAW needs headroom.",
    formats: [
      { label: "WAV 32-bit float", text: "Maximum headroom—best for further editing in a DAW." },
      { label: "WAV 24-bit PCM", text: "Best default for release masters and most streaming uploads." },
      { label: "WAV 16-bit dithered", text: "Smaller file; use when a platform or CD workflow needs 16-bit." },
      { label: "MP3 320", text: "Easy sharing and demos—not for final archival quality." },
    ],
    formatHint: "Format guide appears after you master your track.",
  },
  workflow: {
    steps: ["Upload", "Check", "Goal", "Export"],
    emptyDropzone: "Start by uploading your mix—we will check levels and warn you about issues before mastering.",
    emptyWaveNext: "What happens next: we analyze your file, you pick a mastering goal, then download your master.",
    emptyWaveNextServer: "What happens next: your file is checked on the server, you choose a goal, then download formats here.",
    youAreHere: {
      empty: "Step 1 — Upload your mix",
      loaded: "Step 2 — Checking your audio",
      analyzed: "Step 3 — Choose a goal and master",
      mastered: "Step 4 — Preview and download",
      error: "Fix the issue and re-upload",
    },
    analysisPlaceholder: {
      empty:
        "Runs automatically after upload—we check loudness, peaks, and common issues before you master.",
      loaded: "Checking your file now. Results will appear here in a moment.",
    },
    nextByPhase: {
      empty: "Step 1: drop or choose an audio file above.",
      loaded: "Step 2: hang tight while we analyze your original audio.",
      analyzed: "Step 3: choose a mastering goal and click Master file when you are ready.",
      mastered: "Step 4: preview your master and pick a download format below.",
      error: "Fix the issue above or upload a different file, then try again.",
    },
  },
  readiness: {
    goodNext: "Next: pick a mastering goal (step 3), adjust fine tune if you like, then click Master file.",
    minorNext: (count) =>
      `${count} note${count === 1 ? "" : "s"} below—you can still master. Review them, then choose a goal and click Master file.`,
    majorSilent: "Upload a file with audible audio before mastering.",
    majorClipping: "Reduce clipping in your mix or re-export with more headroom, then upload again for best results.",
    majorGeneric: "Address the major issue below, or try a cleaner WAV/FLAC export before mastering.",
  },
  warnings: {
    lossy: {
      title: "Compressed source (MP3, AAC, etc.)",
      text: "Mastering can only work with the quality already in the file. Fine detail lost in compression cannot be restored.",
      try: "Try this: upload WAV, AIFF, or FLAC from your DAW for the cleanest master.",
    },
    silent: {
      title: "No usable audio detected",
      text: "The file decoded but the signal is effectively silent.",
      try: "Try this: export again with audible audio and re-upload.",
    },
    quiet: {
      title: "Very quiet mix",
      text: "Mastering will raise the level, but background noise and hiss may become more obvious.",
      try: "Try this: turn up your mix in the DAW before export, leaving a few dB of peak headroom.",
    },
    loud: {
      title: "Already very loud",
      text: "There is little room to push louder without extra distortion. The master will stay conservative.",
      try: "Try this: use Loud only if you need more level; otherwise Balanced or Streaming Ready is safer.",
    },
    truePeak: {
      title: "True peak near clipping",
      text: "Peaks are close to 0 dBTP. Limiting will leave extra headroom for streaming codecs.",
      try: "Try this: lower your limiter ceiling in the mix by about 1 dB before re-exporting.",
    },
    clipping: {
      title: "Possible clipping in the source",
      text: "Distortion in the upload may sound harsher after limiting. Master Lab cannot remove clipped samples.",
      try: "Try this: re-export with peaks around -6 dBFS and no clip lights on your meters.",
    },
    mono: {
      title: "Mono source",
      text: "The master stays mono—Master Lab does not widen a single-channel file into fake stereo.",
      try: "Try this: fine for vocals, podcasts, and some club tracks; use a stereo mix if you want width.",
    },
    lowSampleRate: {
      title: "Low sample rate",
      text: "Below 44.1 kHz limits high-frequency detail in the master.",
      try: "Try this: export at 44.1 kHz or 48 kHz from your DAW when possible.",
    },
    silence: {
      title: "Long silence at start or end",
      text: "Extra silence can skew loudness readings and lengthen the master.",
      try: "Try this: trim fades in your DAW, or enable Trim leading silence before mastering.",
    },
    phase: {
      title: "Stereo phase concern",
      text: "Some stereo content may cancel when played in mono (phones, clubs, some playlists).",
      try: "Try this: check your mix in mono and reduce wide stereo effects on core elements.",
    },
    overLimited: {
      title: "Likely over-limited source",
      text: "The mix has very little dynamic range already. Heavy limiting will not add much loudness.",
      try: "Try this: choose Balanced or Streaming Ready instead of Loud.",
    },
    none: {
      title: "No issues flagged",
      text: "Levels and dynamics look reasonable for mastering.",
      try: "",
    },
  },
  preview: {
    original: "Original: your upload before mastering. Use this to hear the mix you started with.",
    mastered: "Mastered: the processed version after your chosen goal. Use this to judge the final sound.",
    compare: "Compare: original and master overlaid on the waveform. Switch tabs to A/B by ear.",
    locked: "Mastered and Compare unlock after you click Master file.",
    volumeMatchOff: "Volume matched preview balances loudness so level changes do not fool your ears—available after mastering.",
    volumeMatchOn: "Volume matched preview is on: Original and Mastered play at similar loudness for fair comparison.",
  },
  controls: {
    noFile: "Upload a track in step 1 to enable mastering.",
    analyzing: "Wait for the original audio check to finish.",
    majorIssues: "Mastering is blocked until the major issue above is resolved.",
    ready: "When you are happy with your goal and fine tune, click Master file.",
    playDisabled: "Press play after your file loads and the waveform appears.",
    tabsLocked: "Unavailable until mastering finishes—then compare before and after.",
    goalsLocked: "Available after the original audio check finishes.",
  },
};

function getApiBase() {
  const base = (window.MASTER_LAB_API || "").trim().replace(/\/$/, "");
  return base;
}

function isApiMode() {
  return Boolean(getApiBase());
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isFetchTimeoutError(error) {
  return error?.name === "AbortError";
}

function apiFetchErrorMessage(error) {
  if (isFetchTimeoutError(error)) return COPY.errors.serverWakeup;
  return COPY.errors.serverUnreachable;
}

function getProbeBuffer() {
  if (state.originalBuffer) return state.originalBuffer;
  if (state.apiProbe) {
    return {
      duration: state.apiProbe.duration,
      numberOfChannels: state.apiProbe.channels,
      sampleRate: state.apiProbe.sampleRate,
    };
  }
  return null;
}

const state = {
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

const els = {
  appShell: document.querySelector("#appShell"),
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  statusText: document.querySelector("#statusText"),
  statusBanner: document.querySelector("#statusBanner"),
  processingModeBadge: document.querySelector("#processingModeBadge"),
  uploadPrivacyNote: document.querySelector("#uploadPrivacyNote"),
  uploadLimitsLine: document.querySelector("#uploadLimitsLine"),
  emptyWaveHint: document.querySelector("#emptyWaveHint"),
  exportBox: document.querySelector("#exportBox"),
  exportFooter: document.querySelector("#exportFooter"),
  resetButton: document.querySelector("#resetButton"),
  analysisCard: document.querySelector("#analysisCard"),
  readinessBadge: document.querySelector("#readinessBadge"),
  readinessCopy: document.querySelector("#readinessCopy"),
  analysisGrid: document.querySelector("#analysisGrid"),
  warningList: document.querySelector("#warningList"),
  presetDescription: document.querySelector("#presetDescription"),
  presetButtons: Array.from(document.querySelectorAll(".preset-button")),
  intensitySlider: document.querySelector("#intensitySlider"),
  intensityOutput: document.querySelector("#intensityOutput"),
  warmthSlider: document.querySelector("#warmthSlider"),
  airSlider: document.querySelector("#airSlider"),
  trimSilenceToggle: document.querySelector("#trimSilenceToggle"),
  progressLabel: document.querySelector("#progressLabel"),
  progressPercent: document.querySelector("#progressPercent"),
  progressFill: document.querySelector("#progressFill"),
  progressSteps: Array.from(document.querySelectorAll("#progressSteps li")),
  masterButton: document.querySelector("#masterButton"),
  trackTitle: document.querySelector("#trackTitle"),
  trackDetails: document.querySelector("#trackDetails"),
  originalTab: document.querySelector("#originalTab"),
  masteredTab: document.querySelector("#masteredTab"),
  compareTab: document.querySelector("#compareTab"),
  volumeMatchToggle: document.querySelector("#volumeMatchToggle"),
  waveformWrap: document.querySelector("#waveformWrap"),
  waveCanvas: document.querySelector("#waveCanvas"),
  playhead: document.querySelector("#playhead"),
  emptyWave: document.querySelector("#emptyWave"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  seekSlider: document.querySelector("#seekSlider"),
  currentTime: document.querySelector("#currentTime"),
  durationTime: document.querySelector("#durationTime"),
  originalPlayer: document.querySelector("#originalPlayer"),
  masteredPlayer: document.querySelector("#masteredPlayer"),
  levelSummary: document.querySelector("#levelSummary"),
  originalRms: document.querySelector("#originalRms"),
  masterRms: document.querySelector("#masterRms"),
  originalPeak: document.querySelector("#originalPeak"),
  masterPeak: document.querySelector("#masterPeak"),
  peakMeter: document.querySelector("#peakMeter"),
  peakLabel: document.querySelector("#peakLabel"),
  exportText: document.querySelector("#exportText"),
  wavDownloadLink: document.querySelector("#wavDownloadLink"),
  wav24DownloadLink: document.querySelector("#wav24DownloadLink"),
  wav16DownloadLink: document.querySelector("#wav16DownloadLink"),
  mp3DownloadLink: document.querySelector("#mp3DownloadLink"),
  encoderStatus: document.querySelector("#encoderStatus"),
  workflowSteps: document.querySelector("#workflowSteps"),
  readinessNextStep: document.querySelector("#readinessNextStep"),
  analysisGuidance: document.querySelector("#analysisGuidance"),
  masterButtonHint: document.querySelector("#masterButtonHint"),
  previewModeHelp: document.querySelector("#previewModeHelp"),
  volumeMatchHint: document.querySelector("#volumeMatchHint"),
  emptyWaveNext: document.querySelector("#emptyWaveNext"),
  transportHint: document.querySelector("#transportHint"),
  exportFormatGuide: document.querySelector("#exportFormatGuide"),
  exportFormatHint: document.querySelector("#exportFormatHint"),
  exportRecommendation: document.querySelector("#exportRecommendation"),
  workflowYouAreHereText: document.querySelector("#workflowYouAreHereText"),
  analysisPlaceholder: document.querySelector("#analysisPlaceholder"),
  analysisPlaceholderCopy: document.querySelector("#analysisPlaceholderCopy"),
  masteringControls: document.querySelector("#masteringControls"),
  presetSectionHint: document.querySelector("#presetSectionHint"),
};

function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  return state.audioContext;
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function setAppPhase(phase) {
  if (els.appShell) els.appShell.dataset.phase = phase;
  updateWorkflowGuidance(state.lastReadiness);
}

function setStatusBanner(message, variant = "error") {
  if (!els.statusBanner) return;
  if (!message) {
    clearStatusBanner();
    return;
  }
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner status-banner--${variant} is-visible`;
}

function clearStatusBanner() {
  if (!els.statusBanner) return;
  els.statusBanner.textContent = "";
  els.statusBanner.className = "status-banner";
}

function updateProcessingModeBadge() {
  if (!els.processingModeBadge) return;
  const server = isApiMode();
  els.processingModeBadge.textContent = server ? "Server processing" : "In-browser";
  els.processingModeBadge.classList.toggle("is-server", server);
  els.processingModeBadge.classList.toggle("is-local", !server);
}

function updateDropzoneState(hasFile) {
  els.dropzone.classList.toggle("is-empty", !hasFile);
  els.dropzone.classList.toggle("has-file", Boolean(hasFile));
}

function setExportState(stateClass) {
  if (!els.exportBox) return;
  els.exportBox.classList.remove("is-pending", "is-ready", "is-busy");
  if (stateClass) els.exportBox.classList.add(stateClass);
}

function applyModeCopy() {
  if (els.uploadPrivacyNote) {
    els.uploadPrivacyNote.textContent = isApiMode() ? COPY.privacy.server : COPY.privacy.local;
  }
  if (els.uploadLimitsLine) els.uploadLimitsLine.textContent = COPY.limits;
  if (els.emptyWaveHint) {
    els.emptyWaveHint.textContent = isApiMode() ? COPY.emptyWave.server : COPY.emptyWave.local;
  }
  if (els.emptyWaveNext) {
    els.emptyWaveNext.textContent = isApiMode()
      ? COPY.workflow.emptyWaveNextServer
      : COPY.workflow.emptyWaveNext;
  }
  if (els.exportFooter) {
    els.exportFooter.textContent = `${COPY.limits}. LUFS and true peak are estimates, not broadcast-certified meters.`;
  }
  if (els.encoderStatus) {
    els.encoderStatus.textContent = isApiMode() ? COPY.encoder.server : COPY.encoder.local;
  }
  renderExportFormatGuide();
  updateExportFormatVisibility();
  updateProcessingModeBadge();
}

function formatPresetGuidance(preset) {
  return `Best for: ${preset.whenToUse} ${preset.description}`;
}

function syncPresetButtonCopy() {
  els.presetButtons.forEach((button) => {
    const preset = PRESETS[button.dataset.preset];
    if (!preset) return;
    const span = button.querySelector("span");
    if (span) span.textContent = preset.description;
  });
}

function renderExportFormatGuide() {
  if (!els.exportFormatGuide) return;
  clearChildren(els.exportFormatGuide);
  COPY.export.formats.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.label}</strong> — ${item.text}`;
    els.exportFormatGuide.appendChild(li);
  });
}

function updateExportFormatVisibility() {
  const mastered = els.appShell?.dataset.phase === "mastered";
  if (els.exportFormatGuide) {
    els.exportFormatGuide.hidden = !mastered;
    els.exportFormatGuide.classList.toggle("is-collapsed", !mastered);
  }
  if (els.exportFormatHint) {
    els.exportFormatHint.hidden = mastered;
    els.exportFormatHint.textContent = COPY.export.formatHint;
  }
}

function setAnalysisPlaceholderVisible(visible, copyKey = "empty") {
  if (els.analysisPlaceholder) {
    els.analysisPlaceholder.classList.toggle("hidden", !visible);
  }
  if (els.analysisPlaceholderCopy && visible) {
    els.analysisPlaceholderCopy.textContent = COPY.workflow.analysisPlaceholder[copyKey];
  }
}

function showAnalysisResults() {
  setAnalysisPlaceholderVisible(false);
  els.analysisCard.classList.remove("hidden");
}

function resetAnalysisPanel() {
  els.analysisCard.classList.add("hidden");
  els.analysisCard.classList.remove("is-ready");
  setAnalysisPlaceholderVisible(true, "empty");
}

function setMasteringControlsLocked(locked) {
  if (els.masteringControls) {
    els.masteringControls.classList.toggle("is-locked", locked);
    els.masteringControls.setAttribute("aria-disabled", locked ? "true" : "false");
  }
  if (els.presetSectionHint) {
    els.presetSectionHint.hidden = !locked;
    els.presetSectionHint.textContent = COPY.controls.goalsLocked;
  }
  els.presetButtons.forEach((button) => {
    button.disabled = locked;
  });
  if (els.intensitySlider) els.intensitySlider.disabled = locked;
  if (els.warmthSlider) els.warmthSlider.disabled = locked;
  if (els.airSlider) els.airSlider.disabled = locked;
  if (els.trimSilenceToggle) els.trimSilenceToggle.disabled = locked;
}

function updateWorkflowYouAreHere() {
  if (!els.workflowYouAreHereText) return;
  const phase = els.appShell?.dataset.phase || "empty";
  els.workflowYouAreHereText.textContent =
    COPY.workflow.youAreHere[phase] || COPY.workflow.youAreHere.empty;
}

function updateExportRecommendation() {
  if (!els.exportRecommendation) return;
  const hasMaster = Boolean(state.masteredBuffer || state.masteredPreviewUrl);
  if (!hasMaster) {
    els.exportRecommendation.hidden = true;
    els.exportRecommendation.textContent = "";
    return;
  }
  els.exportRecommendation.hidden = false;
  els.exportRecommendation.textContent = state.file && isLossyFile(state.file)
    ? COPY.export.recommendLossy
    : COPY.export.recommendLossless;
}

function getWorkflowStepForPhase(phase) {
  const map = {
    empty: "upload",
    loaded: "upload",
    analyzed: "goal",
    mastered: "export",
    error: "upload",
  };
  return map[phase] || "upload";
}

function updateWorkflowStepHighlight() {
  if (!els.workflowSteps) return;
  const phase = els.appShell?.dataset.phase || "empty";
  const activeStep = getWorkflowStepForPhase(phase);
  const order = ["upload", "check", "goal", "export"];
  const activeIndex = order.indexOf(activeStep);

  els.workflowSteps.querySelectorAll("li").forEach((item) => {
    const step = item.dataset.workflowStep;
    const index = order.indexOf(step);
    item.classList.remove("is-active", "is-done");
    if (phase === "loaded" && step === "upload") {
      item.classList.add("is-active");
    } else if (phase === "analyzed" && step === "check") {
      item.classList.add("is-active");
    } else if (index < activeIndex || (phase === "mastered" && index < order.length - 1)) {
      if (phase === "mastered" && step === "export") {
        item.classList.add("is-active");
      } else if (index < activeIndex) {
        item.classList.add("is-done");
      }
    } else if (step === activeStep) {
      item.classList.add("is-active");
    }
  });

  if (phase === "analyzed") {
    els.workflowSteps.querySelector('[data-workflow-step="upload"]')?.classList.add("is-done");
    els.workflowSteps.querySelector('[data-workflow-step="check"]')?.classList.add("is-done");
    els.workflowSteps.querySelector('[data-workflow-step="goal"]')?.classList.add("is-active");
  }
  if (phase === "loaded") {
    els.workflowSteps.querySelector('[data-workflow-step="upload"]')?.classList.add("is-active");
  }
  if (phase === "mastered") {
    order.forEach((step) => {
      const item = els.workflowSteps.querySelector(`[data-workflow-step="${step}"]`);
      item?.classList.remove("is-active");
      item?.classList.add("is-done");
    });
    els.workflowSteps.querySelector('[data-workflow-step="export"]')?.classList.add("is-active");
    els.workflowSteps.querySelector('[data-workflow-step="export"]')?.classList.remove("is-done");
  }
}

function updatePreviewModeHelp(source = state.activeSource) {
  if (!els.previewModeHelp) return;
  const hasMastered = Boolean(state.masteredBuffer || state.masteredPreviewUrl);
  if (!hasMastered) {
    els.previewModeHelp.textContent = `${COPY.preview.original} ${COPY.preview.locked}`;
  } else {
    const key = source === "compare" ? "compare" : source === "mastered" ? "mastered" : "original";
    els.previewModeHelp.textContent = COPY.preview[key];
  }

  const tabSuffix = hasMastered ? "" : " (after mastering)";
  els.originalTab.title = COPY.preview.original;
  els.masteredTab.title = hasMastered ? COPY.preview.mastered : `${COPY.preview.mastered}${tabSuffix}`;
  els.compareTab.title = hasMastered ? COPY.preview.compare : `${COPY.preview.compare}${tabSuffix}`;

  if (els.volumeMatchHint) {
    if (!hasMastered || els.volumeMatchToggle.disabled) {
      els.volumeMatchHint.textContent = COPY.preview.volumeMatchOff;
    } else if (els.volumeMatchToggle.checked) {
      els.volumeMatchHint.textContent = COPY.preview.volumeMatchOn;
    } else {
      els.volumeMatchHint.textContent = COPY.preview.volumeMatchOff;
    }
  }
}

function updateMasterButtonHint() {
  if (!els.masterButtonHint) return;
  const phase = els.appShell?.dataset.phase || "empty";
  let hint = COPY.controls.noFile;
  if (phase === "loaded") {
    hint = COPY.controls.analyzing;
  } else if (phase === "analyzed") {
    if (els.masterButton.disabled) {
      hint = COPY.controls.majorIssues;
    } else if (state.lastReadiness?.level === "major") {
      hint = "A major issue was flagged below. You can try mastering, but fixing the source first is recommended.";
    } else {
      hint = COPY.controls.ready;
    }
  } else if (phase === "mastered") {
    hint = "Master complete—use preview tabs or download your files in step 4.";
  } else if (phase === "error") {
    hint = COPY.workflow.nextByPhase.error;
  }
  els.masterButtonHint.textContent = hint;
  els.masterButtonHint.classList.toggle("is-disabled", els.masterButton.disabled);
}

function updateTransportHint() {
  if (!els.transportHint) return;
  const hasAudio = Boolean(state.originalBuffer || state.originalWaveformPeaks || state.originalUrl);
  if (!hasAudio || els.playButton.disabled) {
    els.transportHint.textContent = COPY.controls.playDisabled;
    els.transportHint.hidden = false;
  } else {
    els.transportHint.hidden = true;
  }
}

function updateReadinessNextStep(readiness) {
  if (!els.readinessNextStep) return;
  if (!readiness?.nextStep || els.analysisCard.classList.contains("hidden")) {
    els.readinessNextStep.hidden = true;
    els.readinessNextStep.textContent = "";
    return;
  }
  els.readinessNextStep.hidden = false;
  els.readinessNextStep.textContent = readiness.nextStep;
  els.readinessNextStep.className = `helper-text readiness-next is-${readiness.level}`;
}

function updateWorkflowGuidance(readiness = null) {
  const phase = els.appShell?.dataset.phase || "empty";
  updateWorkflowStepHighlight();
  if (els.emptyWaveNext && !els.emptyWave.classList.contains("hidden")) {
    els.emptyWaveNext.textContent = isApiMode()
      ? COPY.workflow.emptyWaveNextServer
      : COPY.workflow.emptyWaveNext;
  }
  if (readiness) updateReadinessNextStep(readiness);
  else if (phase !== "analyzed" && phase !== "error") updateReadinessNextStep(null);
  updateMasterButtonHint();
  updatePreviewModeHelp();
  updateTransportHint();
  updateExportRecommendation();
  updateExportFormatVisibility();
  updateWorkflowYouAreHere();
  if (phase === "loaded") {
    setAnalysisPlaceholderVisible(true, "loaded");
  } else if (phase === "empty" || phase === "error") {
    if (els.analysisCard.classList.contains("hidden")) {
      setAnalysisPlaceholderVisible(true, "empty");
    }
  }
}

function setProgress(step, percent, label) {
  state.progressStep = step;
  els.progressLabel.textContent = label;
  els.progressPercent.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
  els.progressSteps.forEach((item) => {
    const isActive = item.dataset.step === step;
    item.classList.toggle("active", isActive);
    item.classList.toggle("done", getStepOrder(item.dataset.step) < getStepOrder(step));
  });
}

function getStepOrder(step) {
  return ["analyze", "prepare", "apply", "preview", "download", "done"].indexOf(step);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Not available";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function linearToDb(value) {
  if (value <= 0 || !Number.isFinite(value)) return -Infinity;
  return 20 * Math.log10(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDbValue(value) {
  if (!Number.isFinite(value)) return "-inf dB";
  return `${value.toFixed(1)} dB`;
}

function formatEstimate(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value.toFixed(1)} dB`;
}

function formatLufs(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value.toFixed(1)} LUFS`;
}

function formatDbtp(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${value.toFixed(1)} dBTP`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "Not available";
  return `${Math.round(value * 100)}%`;
}

function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function appendMetric(container, label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  container.appendChild(row);
}

function appendWarning(container, warning) {
  const item = document.createElement("div");
  const title = document.createElement("strong");
  const text = document.createElement("span");
  item.className = `warning-item ${warning.level}`;
  title.textContent = warning.title;
  text.textContent = warning.text;
  item.append(title, text);
  container.appendChild(item);
}

function sanitizeBaseName(name) {
  const base = (name || "mastered").replace(/\.[^/.]+$/, "");
  return base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "mastered";
}

function getExtension(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function isLossyFile(file) {
  const ext = getExtension(file.name);
  return LOSSY_EXTENSIONS.has(ext) || /mpeg|mp4|aac|ogg|opus/i.test(file.type);
}

function makeWaveShaperCurve(amount) {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const drive = Math.max(0.01, amount);

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }

  return curve;
}

function readControls() {
  const preset = PRESETS[state.selectedPreset];
  return {
    presetKey: state.selectedPreset,
    intensity: Number(els.intensitySlider.value) / 100,
    warmth: Number(els.warmthSlider.value) / 100,
    air: Number(els.airSlider.value) / 100,
    bass: preset.bass,
    ceilingDb: getAdaptiveCeiling(preset),
    targetLoudness: getAdaptiveTarget(preset),
    trimSilence: els.trimSilenceToggle.checked,
  };
}

function updateControlOutputs() {
  els.intensityOutput.textContent = `${els.intensitySlider.value}%`;
}

function selectPreset(key, applyDefaults = true) {
  state.selectedPreset = key;
  const preset = PRESETS[key];
  els.presetDescription.textContent = formatPresetGuidance(preset);
  els.presetButtons.forEach((button) => {
    const selected = button.dataset.preset === key;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });

  if (applyDefaults) {
    els.intensitySlider.value = Math.round(preset.intensity * 100).toString();
    els.warmthSlider.value = Math.round(preset.warmth * 100).toString();
    els.airSlider.value = Math.round(preset.air * 100).toString();
    updateControlOutputs();
  }
}

async function loadFile(file) {
  resetSession(false);
  clearStatusBanner();
  updateDropzoneState(true);
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

  try {
    const arrayBuffer = await file.arrayBuffer();
    state.bitDepth = parseBitDepth(arrayBuffer);
    setStatus("Analyzing original file...");
    setProgress("analyze", 30, "Analyzing original file");

    const decoded = await getAudioContext().decodeAudioData(arrayBuffer.slice(0));
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
    const analysis = analyzeAudioBuffer(decoded);
    const warnings = buildWarnings(file, decoded, analysis);
    const readiness = getReadiness(warnings, analysis);

    state.originalBuffer = decoded;
    state.analysis = analysis;
    state.originalUrl = URL.createObjectURL(file);

    els.originalPlayer.src = state.originalUrl;
    els.originalPlayer.load();
    els.trackTitle.textContent = file.name.replace(/\.[^/.]+$/, "") || file.name;
    els.trackDetails.textContent =
      `${decoded.numberOfChannels} channel${decoded.numberOfChannels === 1 ? "" : "s"} · ${decoded.sampleRate.toLocaleString()} Hz · ${formatTime(decoded.duration)}`;
    els.durationTime.textContent = formatTime(decoded.duration);

    renderAnalysis(file, decoded, analysis, warnings, readiness);
    updateStats();
    drawWaveform();
    setPlaybackSource("original", false);
    setProgress("prepare", 45, "Ready to master");
    setAppPhase("analyzed");
    setStatus(
      readiness.level === "good" ? COPY.status.readyToMaster : COPY.status.analysisDone
    );

    els.masterButton.disabled = analysis.peak < 0.00001;
    els.playButton.disabled = false;
    els.seekSlider.disabled = false;
    els.resetButton.disabled = false;
    els.emptyWave.classList.add("hidden");
  } catch (error) {
    console.error(error);
    renderDecodeError(file, "We could not decode this audio file. Try exporting it as WAV or MP3 and upload again.");
  }
}

async function loadFileViaApi(file) {
  if (!file.type.startsWith("audio/") && !SUPPORTED_EXTENSIONS.has(state.fileExtension)) {
    renderDecodeError(file, "This file type is not supported yet.");
    return;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    renderDecodeError(file, `This file is larger than ${formatBytes(MAX_FILE_SIZE_BYTES)}. Try a shorter export or a smaller file.`);
    return;
  }

  setAppPhase("loaded");
  setStatus("Uploading to server for analysis...");
  setProgress("analyze", 12, "Uploading audio");

  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetchWithTimeout(`${getApiBase()}/api/analyze`, { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) {
      renderDecodeError(file, payload.error || "Server analysis failed.");
      return;
    }

    state.apiProbe = payload.probe;
    state.analysis = payload.analysis;
    state.originalWaveformPeaks = payload.waveformPeaks || null;
    state.bitDepth = payload.probe.bitDepth;
    state.originalUrl = URL.createObjectURL(file);

    const probeBuffer = getProbeBuffer();
    const warnings = buildWarnings(file, probeBuffer, state.analysis);
    const readiness = getReadiness(warnings, state.analysis);

    els.originalPlayer.src = state.originalUrl;
    els.originalPlayer.load();
    els.trackTitle.textContent = file.name.replace(/\.[^/.]+$/, "") || file.name;
    els.trackDetails.textContent =
      `${probeBuffer.numberOfChannels} channel${probeBuffer.numberOfChannels === 1 ? "" : "s"} · ${probeBuffer.sampleRate.toLocaleString()} Hz · ${formatTime(probeBuffer.duration)}`;
    els.durationTime.textContent = formatTime(probeBuffer.duration);

    renderAnalysis(file, probeBuffer, state.analysis, warnings, readiness);
    updateStats();
    drawWaveform();
    setPlaybackSource("original", false);
    setProgress("prepare", 45, "Ready to master");
    setAppPhase("analyzed");
    setStatus(
      readiness.level === "good" ? COPY.status.readyToMaster : COPY.status.analysisDoneServer
    );

    els.masterButton.disabled = state.analysis.peak < 0.00001;
    els.playButton.disabled = false;
    els.seekSlider.disabled = false;
    els.resetButton.disabled = false;
    els.emptyWave.classList.add("hidden");
  } catch (error) {
    console.error(error);
    renderDecodeError(file, apiFetchErrorMessage(error));
  }
}

function renderDecodeError(file, message) {
  setAppPhase("error");
  setStatusBanner(message, "error");
  setStatus(message);
  setProgress("analyze", 0, "Audio decoding failed");
  showAnalysisResults();
  els.analysisCard.classList.remove("is-ready");
  els.readinessBadge.textContent = "Major issues detected";
  els.readinessBadge.className = "readiness-badge major";
  els.readinessCopy.textContent = "Mastering cannot continue until a supported audio file is uploaded.";
  clearChildren(els.analysisGrid);
  [
    ["File name", file?.name || "Not available"],
    ["File type", file?.type || getExtension(file?.name || "") || "Not available"],
    ["File size", file ? formatBytes(file.size) : "Not available"],
  ].forEach(([label, value]) => appendMetric(els.analysisGrid, label, value));
  clearChildren(els.warningList);
  appendWarning(els.warningList, {
    level: "major",
    title: "Decode failed",
    text: message,
  });
  els.masterButton.disabled = true;
  setMasteringControlsLocked(true);
  state.lastReadiness = {
    status: "Major issues detected",
    level: "major",
    copy: "Mastering cannot continue until a supported audio file is uploaded.",
    nextStep: COPY.workflow.nextByPhase.error,
  };
  updateReadinessNextStep(state.lastReadiness);
  updateWorkflowGuidance(state.lastReadiness);
}

function renderAnalysis(file, buffer, analysis, warnings, readiness) {
  const typeLabel = file.type || state.fileExtension.toUpperCase() || "Not available";
  const rows = [
    ["File name", file.name],
    ["File type", typeLabel],
    ["File size", formatBytes(file.size)],
    ["Duration", formatTime(buffer.duration)],
    ["Sample rate", `${buffer.sampleRate.toLocaleString()} Hz`],
    ["Channels", `${buffer.numberOfChannels} (${buffer.numberOfChannels === 1 ? "mono" : "stereo"})`],
    ["Bit depth", state.bitDepth ? `${state.bitDepth}-bit` : "Not available"],
    ["Peak level", formatDbValue(analysis.peakDb)],
    ["True peak", formatDbtp(analysis.truePeakDb)],
    ["Integrated loudness", formatLufs(analysis.loudnessDb)],
    ["Crest factor", formatDbValue(analysis.crestDb)],
    ["Stereo correlation", Number.isFinite(analysis.stereoCorrelation) ? analysis.stereoCorrelation.toFixed(2) : "Not available"],
    ["DC offset", formatDbValue(analysis.dcOffsetDb)],
    ["Silence", `${formatTime(analysis.leadingSilenceSeconds)} lead / ${formatTime(analysis.trailingSilenceSeconds)} tail`],
    ["Clipping status", analysis.clippingSamples > 0 ? "Possible clipping detected" : "No clipping detected"],
  ];

  showAnalysisResults();
  els.analysisCard.classList.toggle("is-ready", readiness.level === "good");
  setMasteringControlsLocked(analysis.peak < 0.00001);
  els.readinessBadge.textContent = readiness.status;
  els.readinessBadge.className = `readiness-badge ${readiness.level}`;
  els.readinessCopy.textContent = readiness.copy;
  clearChildren(els.analysisGrid);
  rows.forEach(([label, value]) => appendMetric(els.analysisGrid, label, value));
  clearChildren(els.warningList);
  if (warnings.length) {
    warnings.forEach((warning) => appendWarning(els.warningList, warning));
  } else {
    const copy = COPY.warnings.none;
    appendWarning(els.warningList, {
      level: "good",
      title: copy.title,
      text: copy.text,
    });
  }
  state.lastReadiness = readiness;
  updateReadinessNextStep(readiness);
  updateWorkflowGuidance(readiness);
}

function warningFromCopy(copyKey, level, extraText = "") {
  const copy = COPY.warnings[copyKey];
  const tryLine = copy.try ? ` ${copy.try}` : "";
  return {
    level,
    title: copy.title,
    text: extraText ? `${copy.text} ${extraText}` : `${copy.text}${tryLine}`,
  };
}

function buildWarnings(file, buffer, analysis) {
  const warnings = [];

  if (isLossyFile(file)) {
    warnings.push(warningFromCopy("lossy", "minor"));
  }
  if (analysis.peak < 0.00001 || !Number.isFinite(analysis.rmsDb)) {
    warnings.push(warningFromCopy("silent", "major"));
  }
  if (analysis.loudnessDb < -32) {
    warnings.push(warningFromCopy("quiet", "minor"));
  }
  if (analysis.loudnessDb > -10 || analysis.peakDb > -0.5) {
    warnings.push(warningFromCopy("loud", "minor"));
  }
  if (analysis.truePeakDb > -0.2) {
    warnings.push(warningFromCopy("truePeak", "minor"));
  }
  if (analysis.clippingSamples > 0) {
    warnings.push(warningFromCopy("clipping", analysis.clippingRatio > 0.001 ? "major" : "minor"));
  }
  if (buffer.numberOfChannels === 1) {
    warnings.push(warningFromCopy("mono", "minor"));
  }
  if (buffer.sampleRate < 44100) {
    warnings.push(warningFromCopy("lowSampleRate", "minor"));
  }
  if (analysis.leadingSilenceSeconds > 3 || analysis.trailingSilenceSeconds > 8) {
    warnings.push(warningFromCopy("silence", "minor"));
  }
  if (Number.isFinite(analysis.stereoCorrelation) && analysis.stereoCorrelation < -0.2) {
    warnings.push(warningFromCopy("phase", "minor"));
  }
  if (analysis.crestDb < 6 && analysis.loudnessDb > -12) {
    warnings.push(warningFromCopy("overLimited", "minor"));
  }

  return warnings;
}

function getReadiness(warnings, analysis) {
  const majorWarnings = warnings.filter((w) => w.level === "major");
  if (majorWarnings.length > 0 || analysis.peak < 0.00001) {
    if (analysis.peak < 0.00001) {
      return {
        status: "Major issues detected",
        level: "major",
        copy: "No usable audio was detected. Upload a file with audible signal before mastering.",
        nextStep: COPY.readiness.majorSilent,
      };
    }
    const hasClipping = majorWarnings.some((w) => w.title.includes("clipping"));
    return {
      status: "Major issues detected",
      level: "major",
      copy: "Fix the major issue below for the best result. Mastering stays disabled until the file is usable.",
      nextStep: hasClipping ? COPY.readiness.majorClipping : COPY.readiness.majorGeneric,
    };
  }
  if (warnings.length > 0) {
    return {
      status: "Minor issues detected",
      level: "minor",
      copy: `${warnings.length} note${warnings.length === 1 ? "" : "s"} below—you can still master.`,
      nextStep: COPY.readiness.minorNext(warnings.length),
    };
  }
  return {
    status: "Good to master",
    level: "good",
    copy: "This file looks ready for mastering.",
    nextStep: COPY.readiness.goodNext,
  };
}

function parseBitDepth(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 36) return null;
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && chunkSize >= 16) {
      return view.getUint16(offset + 22, true);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

function readAscii(view, offset, length) {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function trimLeadingSilence(buffer, threshold = 0.0008) {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const lookAhead = Math.floor(sampleRate * 0.02);
  let start = 0;

  scan: for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      if (Math.abs(buffer.getChannelData(c)[i]) > threshold) {
        start = Math.max(0, i - lookAhead);
        break scan;
      }
    }
  }

  if (start === 0) return buffer;
  const context = new OfflineAudioContext(channels, buffer.length - start, sampleRate);
  const trimmed = context.createBuffer(channels, buffer.length - start, sampleRate);
  for (let c = 0; c < channels; c += 1) {
    trimmed.copyToChannel(buffer.getChannelData(c).slice(start), c);
  }
  return trimmed;
}

async function masterBuffer(inputBuffer, controls) {
  const sourceBuffer = controls.trimSilence ? trimLeadingSilence(inputBuffer) : inputBuffer;
  const sourceAnalysis = state.analysis ?? analyzeAudioBuffer(sourceBuffer);
  const dsp = buildMasteringSettings(sourceAnalysis, controls);
  const offline = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  );

  const source = offline.createBufferSource();
  source.buffer = sourceBuffer;

  const highPass = offline.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = dsp.highPassHz;
  highPass.Q.value = 0.7;

  const lowShelf = offline.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 105;
  lowShelf.gain.value = dsp.lowShelfDb;

  const lowMid = offline.createBiquadFilter();
  lowMid.type = "peaking";
  lowMid.frequency.value = 285;
  lowMid.Q.value = 0.82;
  lowMid.gain.value = dsp.mudCutDb;

  const highShelf = offline.createBiquadFilter();
  highShelf.type = "highshelf";
  highShelf.frequency.value = 9000;
  highShelf.gain.value = dsp.airDb;

  const preGain = offline.createGain();
  preGain.gain.value = dbToLinear(dsp.preGainDb);

  const saturator = offline.createWaveShaper();
  saturator.curve = makeWaveShaperCurve(dsp.saturationDrive);
  saturator.oversample = "4x";

  const saturationTrim = offline.createGain();
  saturationTrim.gain.value = dbToLinear(dsp.saturationTrimDb);

  const saturationDry = offline.createGain();
  saturationDry.gain.value = 1 - dsp.saturationWet;

  const saturationWet = offline.createGain();
  saturationWet.gain.value = dsp.saturationWet;

  const compressor = offline.createDynamicsCompressor();
  compressor.threshold.value = dsp.compressorThresholdDb;
  compressor.knee.value = 20;
  compressor.ratio.value = dsp.compressorRatio;
  compressor.attack.value = dsp.attackSeconds;
  compressor.release.value = dsp.releaseSeconds;

  const makeupGain = offline.createGain();
  makeupGain.gain.value = dbToLinear(dsp.makeupGainDb);

  const deHarsh = offline.createBiquadFilter();
  deHarsh.type = "lowpass";
  deHarsh.frequency.value = 19000;
  deHarsh.Q.value = 0.35;

  source
    .connect(highPass)
    .connect(lowShelf)
    .connect(lowMid)
    .connect(highShelf)
    .connect(preGain);
  preGain.connect(saturationDry).connect(compressor);
  preGain.connect(saturator).connect(saturationTrim).connect(saturationWet).connect(compressor);
  compressor.connect(makeupGain).connect(deHarsh).connect(offline.destination);

  source.start(0);
  const rendered = await offline.startRendering();
  return finalizeMaster(rendered, dsp.targetLoudness, dsp.ceilingDb);
}

function getAdaptiveTarget(preset) {
  if (!state.analysis) return preset.targetLoudness;
  if (state.analysis.loudnessDb > -10 || state.analysis.truePeakDb > -0.5) {
    return Math.min(-12, state.analysis.loudnessDb);
  }
  if (state.analysis.crestDb > 15 && state.selectedPreset === "streaming") {
    return -16;
  }
  return preset.targetLoudness;
}

function getAdaptiveCeiling(preset) {
  if (state.analysis && (state.analysis.loudnessDb > -10 || state.analysis.truePeakDb > -0.5)) {
    return -2;
  }
  return preset.ceilingDb;
}

function buildMasteringSettings(analysis, controls) {
  const intensity = controls.intensity;
  const warmth = controls.warmth;
  const air = controls.air;
  const lowCorrection = clamp((-12 - analysis.lowRatioDb) * 0.08, -0.7, 0.7);
  const highCorrection = clamp((-20 - analysis.highRatioDb) * -0.07, -0.7, 0.8);
  const loudnessGap = controls.targetLoudness - analysis.loudnessDb;

  return {
    targetLoudness: controls.targetLoudness,
    ceilingDb: controls.ceilingDb,
    highPassHz: analysis.lowRatioDb > -7 ? 32 : 25,
    lowShelfDb: clamp((warmth - 0.5) * 2 + lowCorrection + controls.bass * 2.1, -1.5, 1.6),
    mudCutDb: -clamp(0.12 + intensity * 0.72 + Math.max(0, analysis.mudRatioDb + 7) * 0.06, 0.1, 1.05),
    airDb: clamp((air - 0.5) * 2.2 + highCorrection, -1, 1.25),
    preGainDb: clamp(loudnessGap * 0.3, -2, 3),
    saturationDrive: 1 + intensity * 0.18,
    saturationTrimDb: -0.05 - intensity * 0.12,
    saturationWet: clamp(intensity * 0.08, 0, 0.08),
    compressorThresholdDb: clamp(analysis.rmsDb + 7 - intensity * 3, -21, -12),
    compressorRatio: 1.28 + intensity * 0.6,
    attackSeconds: 0.026,
    releaseSeconds: 0.15 + clamp((analysis.crestDb - 11) * 0.006, -0.02, 0.05),
    makeupGainDb: clamp(0.55 + intensity * 1.15 + Math.max(0, loudnessGap) * 0.08, 0.15, 2.6),
  };
}

function finalizeMaster(buffer, targetLoudness, ceilingDb) {
  const loudness = estimateLoudnessDb(buffer);
  const truePeakDb = estimateTruePeakDb(buffer);
  const peakRoomDb = ceilingDb - truePeakDb;
  const desiredGainDb = clamp(Math.min(targetLoudness - loudness, peakRoomDb), -4.5, 5);
  const gained = applyGain(buffer, dbToLinear(desiredGainDb));
  const limited = lookaheadLimit(gained, ceilingDb, 5, 110);
  const validated = normalizeToCeiling(limited, ceilingDb);
  const postTruePeakDb = estimateTruePeakDb(validated);
  if (postTruePeakDb > ceilingDb) {
    return applyGain(validated, dbToLinear(ceilingDb - postTruePeakDb));
  }
  return validated;
}

function normalizeToCeiling(buffer, ceilingDb) {
  const peak = dbToLinear(estimateTruePeakDb(buffer));
  const target = dbToLinear(ceilingDb);
  const gain = peak > 0 ? Math.min(target / peak, 1) : 1;
  return applyGain(buffer, gain);
}

function applyGain(buffer, gain) {
  const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const outputBuffer = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const input = buffer.getChannelData(c);
    const output = outputBuffer.getChannelData(c);
    for (let i = 0; i < input.length; i += 1) {
      output[i] = input[i] * gain;
    }
  }
  return outputBuffer;
}

function lookaheadLimit(buffer, ceilingDb, lookaheadMs, releaseMs) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const ceiling = dbToLinear(ceilingDb);
  const lookahead = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
  const release = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  const peaks = new Float32Array(length + lookahead + 2);
  const deque = new Int32Array(length + lookahead + 2);
  const context = new OfflineAudioContext(channels, length, sampleRate);
  const outputBuffer = context.createBuffer(channels, length, sampleRate);

  for (let i = 0; i < length; i += 1) {
    let samplePeak = 0;
    for (let c = 0; c < channels; c += 1) {
      samplePeak = Math.max(samplePeak, Math.abs(buffer.getChannelData(c)[i]));
    }
    peaks[i] = samplePeak;
  }

  let head = 0;
  let tail = 0;
  let gain = 1;
  const pushPeak = (index) => {
    if (index >= peaks.length) return;
    while (head < tail && peaks[deque[tail - 1]] <= peaks[index]) tail -= 1;
    deque[tail] = index;
    tail += 1;
  };

  for (let i = 0; i <= lookahead && i < peaks.length; i += 1) pushPeak(i);
  let minGain = 1;
  for (let i = 0; i < length; i += 1) {
    while (head < tail && deque[head] < i) head += 1;
    const futurePeak = peaks[deque[head]];
    const targetGain = futurePeak > ceiling ? ceiling / futurePeak : 1;
    gain = targetGain < gain ? targetGain : gain + (1 - gain) * release;
    minGain = Math.min(minGain, gain);
    for (let c = 0; c < channels; c += 1) {
      outputBuffer.getChannelData(c)[i] = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i] * gain));
    }
    pushPeak(i + lookahead + 1);
  }
  state.limiterReductionDb = linearToDb(minGain);
  return outputBuffer;
}

function analyzeAudioBuffer(buffer) {
  const mono = mixDown(buffer);
  const maxSamples = 250000;
  const step = Math.max(1, Math.ceil(mono.length / maxSamples));
  const effectiveSampleRate = buffer.sampleRate / step;
  const fullRms = getRms(buffer);
  const peak = getPeak(buffer);
  const lufs = estimateLoudnessDb(buffer);
  const truePeakDb = estimateTruePeakDb(buffer);
  const lowRms = getOnePoleLowpassRms(mono, effectiveSampleRate, step, 160);
  const lowMidRms = getBandpassRms(mono, effectiveSampleRate, step, 180, 520);
  const midRms = getBandpassRms(mono, effectiveSampleRate, step, 520, 2400);
  const presenceRms = getBandpassRms(mono, effectiveSampleRate, step, 2400, 6200);
  const highRms = getOnePoleHighpassRms(mono, effectiveSampleRate, step, 6200);
  const clippingSamples = countClippingSamples(buffer);
  const rmsDb = linearToDb(fullRms);
  const peakDb = linearToDb(peak);
  const silence = detectSilence(buffer);
  const dcOffset = getDcOffset(buffer);

  return {
    rms: fullRms,
    peak,
    rmsDb,
    peakDb,
    truePeakDb,
    loudnessDb: lufs,
    crestDb: peakDb - rmsDb,
    lowRatioDb: linearToDb(lowRms / Math.max(fullRms, 1e-9)),
    mudRatioDb: linearToDb(lowMidRms / Math.max(fullRms, 1e-9)),
    midRatioDb: linearToDb(midRms / Math.max(fullRms, 1e-9)),
    presenceRatioDb: linearToDb(presenceRms / Math.max(fullRms, 1e-9)),
    highRatioDb: linearToDb(highRms / Math.max(fullRms, 1e-9)),
    dcOffset,
    dcOffsetDb: linearToDb(Math.abs(dcOffset)),
    stereoCorrelation: getStereoCorrelation(buffer),
    leadingSilenceSeconds: silence.leading,
    trailingSilenceSeconds: silence.trailing,
    clippingSamples,
    clippingRatio: clippingSamples / Math.max(1, buffer.length * buffer.numberOfChannels),
  };
}

function estimateLoudnessDb(buffer) {
  const sampleRate = buffer.sampleRate;
  const blockSize = Math.max(1, Math.round(sampleRate * 0.4));
  const blockCount = Math.max(1, Math.ceil(buffer.length / blockSize));
  const blockEnergies = new Float64Array(blockCount);

  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    const highpass = createBiquadState(makeHighpassCoefficients(38, 0.5, sampleRate));
    const highShelf = createBiquadState(makeHighShelfCoefficients(1681.974, 4, 0.707, sampleRate));
    const channelWeight = c < 3 ? 1 : 1.41;
    for (let i = 0; i < data.length; i += 1) {
      const weighted = processBiquad(processBiquad(data[i], highpass), highShelf);
      blockEnergies[Math.floor(i / blockSize)] += channelWeight * weighted * weighted;
    }
  }

  const energies = Array.from(blockEnergies, (energy, index) => {
    const frames = Math.min(blockSize, buffer.length - index * blockSize);
    return energy / Math.max(1, frames);
  }).filter((energy) => energy > 0);

  if (!energies.length) return -Infinity;

  const absoluteGate = dbToEnergy(LUFS_ABSOLUTE_GATE);
  const absoluteGated = energies.filter((energy) => energy > absoluteGate);
  if (!absoluteGated.length) return -Infinity;

  const preliminary = energyToLufs(mean(absoluteGated));
  const relativeGate = dbToEnergy(preliminary + LUFS_RELATIVE_GATE_OFFSET);
  const gated = absoluteGated.filter((energy) => energy > Math.max(absoluteGate, relativeGate));
  return gated.length ? energyToLufs(mean(gated)) : preliminary;
}

function estimateTruePeakDb(buffer) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    let previous = data[0] ?? 0;
    peak = Math.max(peak, Math.abs(previous));
    for (let i = 1; i < data.length; i += 1) {
      const current = data[i];
      peak = Math.max(peak, Math.abs(current));
      if (Math.max(Math.abs(previous), Math.abs(current)) > 0.25) {
        for (let j = 1; j < TRUE_PEAK_OVERSAMPLE; j += 1) {
          const t = j / TRUE_PEAK_OVERSAMPLE;
          const interpolated = sincInterpolate(data, i - 1 + t, 8);
          peak = Math.max(peak, Math.abs(interpolated));
        }
      }
      previous = current;
    }
  }
  return linearToDb(peak);
}

function sincInterpolate(samples, position, radius) {
  const center = Math.floor(position);
  let sum = 0;
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = center + offset;
    if (index < 0 || index >= samples.length) continue;
    const x = position - index;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / (radius + 1));
    const weight = sinc * window;
    sum += samples[index] * weight;
    weightSum += weight;
  }
  return weightSum ? sum / weightSum : 0;
}

function makeHighpassCoefficients(frequency, q, sampleRate) {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return normalizeBiquad({ b0, b1, b2, a0, a1, a2 });
}

function makeHighShelfCoefficients(frequency, gainDb, slope, sampleRate) {
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = (sin / 2) * Math.sqrt((a + 1 / a) * (1 / slope - 1) + 2);
  const beta = 2 * Math.sqrt(a) * alpha;
  const b0 = a * ((a + 1) + (a - 1) * cos + beta);
  const b1 = -2 * a * ((a - 1) + (a + 1) * cos);
  const b2 = a * ((a + 1) + (a - 1) * cos - beta);
  const a0 = (a + 1) - (a - 1) * cos + beta;
  const a1 = 2 * ((a - 1) - (a + 1) * cos);
  const a2 = (a + 1) - (a - 1) * cos - beta;
  return normalizeBiquad({ b0, b1, b2, a0, a1, a2 });
}

function normalizeBiquad(coefficients) {
  return {
    b0: coefficients.b0 / coefficients.a0,
    b1: coefficients.b1 / coefficients.a0,
    b2: coefficients.b2 / coefficients.a0,
    a1: coefficients.a1 / coefficients.a0,
    a2: coefficients.a2 / coefficients.a0,
  };
}

function createBiquadState(coefficients) {
  return { ...coefficients, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquad(input, state) {
  const output = state.b0 * input + state.b1 * state.x1 + state.b2 * state.x2 - state.a1 * state.y1 - state.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = output;
  return output;
}

function dbToEnergy(db) {
  return Math.pow(10, (db + 0.691) / 10);
}

function energyToLufs(energy) {
  return -0.691 + 10 * Math.log10(Math.max(energy, 1e-12));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function countClippingSamples(buffer) {
  let clipped = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      if (Math.abs(data[i]) >= CLIPPING_THRESHOLD) clipped += 1;
    }
  }
  return clipped;
}

function getRms(buffer) {
  let total = 0;
  let count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      total += data[i] * data[i];
    }
    count += data.length;
  }
  return Math.sqrt(total / Math.max(1, count));
}

function getPeak(buffer) {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      peak = Math.max(peak, Math.abs(data[i]));
    }
  }
  return peak;
}

function getDcOffset(buffer) {
  let total = 0;
  let count = 0;
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      total += data[i];
    }
    count += data.length;
  }
  return total / Math.max(1, count);
}

function getStereoCorrelation(buffer) {
  if (buffer.numberOfChannels < 2) return null;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const step = Math.max(1, Math.ceil(left.length / 500000));
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  for (let i = 0; i < left.length; i += step) {
    sumLR += left[i] * right[i];
    sumL2 += left[i] * left[i];
    sumR2 += right[i] * right[i];
  }
  const denominator = Math.sqrt(sumL2 * sumR2);
  return denominator > 0 ? clamp(sumLR / denominator, -1, 1) : null;
}

function detectSilence(buffer, threshold = 0.0005) {
  const isSilentFrame = (index) => {
    for (let c = 0; c < buffer.numberOfChannels; c += 1) {
      if (Math.abs(buffer.getChannelData(c)[index]) > threshold) return false;
    }
    return true;
  };

  let leading = 0;
  while (leading < buffer.length && isSilentFrame(leading)) leading += 1;

  let trailing = buffer.length - 1;
  while (trailing > leading && isSilentFrame(trailing)) trailing -= 1;

  return {
    leading: leading / buffer.sampleRate,
    trailing: Math.max(0, buffer.length - 1 - trailing) / buffer.sampleRate,
  };
}

function getOnePoleLowpassRms(samples, sampleRate, step, cutoff) {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    y += alpha * (samples[i] - y);
    sum += y * y;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function getOnePoleHighpassRms(samples, sampleRate, step, cutoff) {
  const alpha = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let low = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    low = (1 - alpha) * samples[i] + alpha * low;
    const high = samples[i] - low;
    sum += high * high;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function getBandpassRms(samples, sampleRate, step, lowCutoff, highCutoff) {
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * lowCutoff) / sampleRate);
  const highAlpha = 1 - Math.exp((-2 * Math.PI * highCutoff) / sampleRate);
  let low = 0;
  let high = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    low += lowAlpha * (samples[i] - low);
    high += highAlpha * (samples[i] - high);
    const band = high - low;
    sum += band * band;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
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

  try {
    setStatus("Preparing master...");
    setProgress("prepare", 55, "Preparing master");
    await nextFrame();

    const controls = readControls();
    setStatus(`Applying ${PRESETS[state.selectedPreset].label} preset...`);
    setProgress("apply", 70, "Applying mastering preset");
    await nextFrame();

    state.limiterReductionDb = 0;
    const mastered = await masterBuffer(state.originalBuffer, controls);
    state.masteredBuffer = mastered;
    state.masteredAnalysis = analyzeAudioBuffer(mastered);

    setStatus("Creating preview...");
    setProgress("preview", 84, "Creating preview");
    await createPreviewUrl(mastered);

    setStatus("Preparing downloads...");
    setProgress("download", 92, "Preparing download");
    await prepareDownloads(mastered);

    els.masteredTab.disabled = false;
    els.compareTab.disabled = false;
    els.volumeMatchToggle.disabled = false;
    updateStats();
    setPlaybackSource("mastered", false);
    setProgress("done", 100, "Master ready");
    setAppPhase("mastered");
    setStatusBanner(COPY.status.masterReady, "success");
    setStatus(COPY.status.masterReady);
  } catch (error) {
    console.error(error);
    setAppPhase("error");
    setStatusBanner(COPY.errors.masterFailed, "error");
    setStatus(COPY.errors.masterFailed);
    setProgress("prepare", 0, "Mastering failed");
  } finally {
    els.masterButton.disabled = false;
    els.masterButton.textContent = "Master file";
  }
}

async function runMasteringViaApi() {
  if (!state.file || !state.apiProbe) return;

  pausePlayback();
  clearStatusBanner();
  disableExports();
  els.masterButton.disabled = true;
  els.masterButton.textContent = "Mastering...";

  try {
    setStatus("Uploading to server for mastering...");
    setProgress("prepare", 55, "Uploading to server");
    await nextFrame();

    const controls = readControls();
    const form = new FormData();
    form.append("file", state.file);
    form.append("preset", state.selectedPreset);
    form.append("intensity", String(controls.intensity));
    form.append("warmth", String(controls.warmth));
    form.append("air", String(controls.air));
    form.append("trimSilence", controls.trimSilence ? "true" : "false");

    const startResponse = await fetchWithTimeout(`${getApiBase()}/api/master/jobs`, {
      method: "POST",
      body: form,
    });
    const startPayload = await startResponse.json();
    if (!startResponse.ok) {
      throw new Error(startPayload.error || "Could not start mastering job");
    }

    state.masterJobId = startPayload.jobId;
    setStatus(`Applying ${PRESETS[state.selectedPreset].label} preset on server...`);
    setProgress("apply", 70, "Applying mastering preset");

    let job = startPayload;
    while (job.status === "queued" || job.status === "processing") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const statusResponse = await fetchWithTimeout(`${getApiBase()}/api/jobs/${state.masterJobId}`);
      job = await statusResponse.json();
      if (!statusResponse.ok) {
        throw new Error(job.error || "Job status failed");
      }
      const stepPercent = Math.min(90, 55 + Math.round((job.progress || 0) * 0.35));
      setProgress(job.progress >= 84 ? "preview" : "apply", stepPercent, job.message || "Processing on server");
      setStatus(job.message || "Mastering on server...");
    }

    if (job.status !== "done") {
      throw new Error(job.error || "Mastering failed on server");
    }

    state.masteredAnalysis = job.meta.masteredAnalysis;
    state.masteredWaveformPeaks = job.meta.waveformPeaks || null;
    state.limiterReductionDb = job.meta.limiterReductionDb || 0;

    setStatus("Downloading mastered files...");
    setProgress("download", 92, "Preparing download");

    const baseName = state.fileName || "mastered";
    const previewBlob = await fetchJobFileBlob(state.masterJobId, "preview");
    if (state.masteredPreviewUrl) URL.revokeObjectURL(state.masteredPreviewUrl);
    state.masteredPreviewUrl = URL.createObjectURL(previewBlob);
    els.masteredPlayer.src = state.masteredPreviewUrl;
    els.masteredPlayer.load();

    const wav32Blob = await fetchJobFileBlob(state.masterJobId, "wav32");
    const wav24Blob = await fetchJobFileBlob(state.masterJobId, "wav24");
    const wav16Blob = await fetchJobFileBlob(state.masterJobId, "wav16");
    const mp3Blob = await fetchJobFileBlob(state.masterJobId, "mp3");

    if (state.wavUrl) URL.revokeObjectURL(state.wavUrl);
    if (state.wav24Url) URL.revokeObjectURL(state.wav24Url);
    if (state.wav16Url) URL.revokeObjectURL(state.wav16Url);
    if (state.mp3Url) URL.revokeObjectURL(state.mp3Url);

    state.wavUrl = URL.createObjectURL(wav32Blob);
    state.wav24Url = URL.createObjectURL(wav24Blob);
    state.wav16Url = URL.createObjectURL(wav16Blob);
    state.mp3Url = URL.createObjectURL(mp3Blob);

    enableDownload(els.wavDownloadLink, state.wavUrl, `${baseName}-master-32float.wav`, "Download WAV 32-bit float");
    enableDownload(els.wav24DownloadLink, state.wav24Url, `${baseName}-master-24bit.wav`, "Download WAV 24-bit PCM");
    enableDownload(els.wav16DownloadLink, state.wav16Url, `${baseName}-master-16bit-dithered.wav`, "Download WAV 16-bit dithered");
    enableDownload(els.mp3DownloadLink, state.mp3Url, `${baseName}-master-320.mp3`, "Download MP3 320");
    els.encoderStatus.textContent = COPY.encoder.server;
    els.exportText.textContent = COPY.export.ready;
    setExportState("is-ready");
    updateExportRecommendation();

    els.masteredTab.disabled = false;
    els.compareTab.disabled = false;
    els.volumeMatchToggle.disabled = false;
    updateStats();
    setPlaybackSource("mastered", false);
    setProgress("done", 100, "Master ready");
    setAppPhase("mastered");
    setStatusBanner(COPY.status.masterReady, "success");
    setStatus(COPY.status.masterReadyServer);
  } catch (error) {
    console.error(error);
    setAppPhase("error");
    const message = isFetchTimeoutError(error) ? COPY.errors.serverWakeup : COPY.errors.masterFailed;
    setStatusBanner(message, "error");
    setStatus(message);
    setProgress("prepare", 0, "Mastering failed");
  } finally {
    els.masterButton.disabled = false;
    els.masterButton.textContent = "Master file";
  }
}

async function fetchJobFileBlob(jobId, kind) {
  const response = await fetchWithTimeout(`${getApiBase()}/api/jobs/${jobId}/file/${kind}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Could not download ${kind}`);
  }
  return response.blob();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function createPreviewUrl(buffer) {
  if (state.masteredPreviewUrl) URL.revokeObjectURL(state.masteredPreviewUrl);
  const wav = encodeWavFloat32(buffer);
  state.masteredPreviewUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  els.masteredPlayer.src = state.masteredPreviewUrl;
  els.masteredPlayer.load();
}

async function prepareDownloads(buffer) {
  const baseName = state.fileName || "mastered";
  const wavName = `${baseName}-master-32float.wav`;
  const wav24Name = `${baseName}-master-24bit.wav`;
  const wav16Name = `${baseName}-master-16bit-dithered.wav`;
  const mp3Name = `${baseName}-master-320.mp3`;

  if (state.wavUrl) URL.revokeObjectURL(state.wavUrl);
  const wav = encodeWavFloat32(buffer);
  state.wavUrl = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  enableDownload(els.wavDownloadLink, state.wavUrl, wavName, "Download WAV 32-bit float");

  if (state.wav24Url) URL.revokeObjectURL(state.wav24Url);
  const wav24 = encodeWavPcm(buffer, 24, false);
  state.wav24Url = URL.createObjectURL(new Blob([wav24], { type: "audio/wav" }));
  enableDownload(els.wav24DownloadLink, state.wav24Url, wav24Name, "Download WAV 24-bit PCM");

  if (state.wav16Url) URL.revokeObjectURL(state.wav16Url);
  const wav16 = encodeWavPcm(buffer, 16, true);
  state.wav16Url = URL.createObjectURL(new Blob([wav16], { type: "audio/wav" }));
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

function disposeMp3Worker(markFailed = false) {
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

function enableDownload(link, href, download, text) {
  link.href = href;
  link.download = download;
  link.textContent = text;
  link.classList.remove("disabled");
  link.removeAttribute("aria-disabled");
}

function disableDownload(link, text) {
  link.removeAttribute("href");
  link.removeAttribute("download");
  link.textContent = text;
  link.classList.add("disabled");
  link.setAttribute("aria-disabled", "true");
}

function disableExports() {
  disableDownload(els.wavDownloadLink, "Download WAV 32-bit float");
  disableDownload(els.wav24DownloadLink, "Download WAV 24-bit PCM");
  disableDownload(els.wav16DownloadLink, "Download WAV 16-bit dithered");
  disableDownload(els.mp3DownloadLink, "Download MP3 320");
  els.exportText.textContent = COPY.export.busy;
  setExportState("is-busy");
}

function updateStats() {
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

function drawWaveform() {
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
  } else if (state.activeSource === "original" && state.originalWaveformPeaks && !state.originalBuffer) {
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

function mixDown(buffer) {
  const output = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) {
      output[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return output;
}

function activePlayer() {
  return state.activeSource === "mastered" ? els.masteredPlayer : els.originalPlayer;
}

function setPlaybackSource(source, preserveTime = true) {
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

function setSourceTabs(source) {
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

function pausePlayback() {
  els.originalPlayer.pause();
  els.masteredPlayer.pause();
  els.playIcon.textContent = "Play";
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
    state.animationId = null;
  }
}

async function togglePlayback() {
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

function updatePlaybackProgress() {
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

function seekPlayback() {
  const player = activePlayer();
  const duration = getActiveDuration();
  if (duration > 0) {
    player.currentTime = (Number(els.seekSlider.value) / 1000) * duration;
    updatePlaybackProgress();
  }
}

function seekWaveform(event) {
  const duration = getActiveDuration();
  const player = activePlayer();
  if (!duration || !player.src) return;

  const rect = els.waveformWrap.getBoundingClientRect();
  const progress = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  player.currentTime = progress * duration;
  updatePlaybackProgress();
}

function nudgeWaveformSeek(direction) {
  const duration = getActiveDuration();
  const player = activePlayer();
  if (!duration || !player.src) return;
  player.currentTime = clamp(player.currentTime + direction * 5, 0, duration);
  updatePlaybackProgress();
}

function applyPreviewVolume() {
  els.originalPlayer.volume = 1;
  els.masteredPlayer.volume = 1;
  if (!els.volumeMatchToggle.checked || !state.analysis || !state.masteredAnalysis) return;

  const diff = state.analysis.loudnessDb - state.masteredAnalysis.loudnessDb;
  els.masteredPlayer.volume = clamp(dbToLinear(diff), 0.25, 1);
  updatePreviewModeHelp();
}

function encodeWavFloat32(buffer) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 4;
  const blockAlign = channels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 32, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      view.setFloat32(offset, buffer.getChannelData(c)[i], true);
      offset += bytesPerSample;
    }
  }
  return wav;
}

function encodeWavPcm(buffer, bitDepth, dither) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  const maxInt = bitDepth === 24 ? 0x7fffff : 0x7fff;
  const minInt = bitDepth === 24 ? -0x800000 : -0x8000;
  const ditherScale = dither ? 1 / maxInt : 0;
  for (let i = 0; i < buffer.length; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const noise = dither ? (Math.random() - Math.random()) * ditherScale : 0;
      const sample = clamp(buffer.getChannelData(c)[i] + noise, -1, 1);
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

function encodeMp3(buffer, kbps) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const encoder = new lamejs.Mp3Encoder(channels, buffer.sampleRate, kbps);
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

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
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
  state.originalWaveformPeaks = null;
  state.masteredWaveformPeaks = null;
  state.masterJobId = null;
  state.limiterReductionDb = 0;
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
}

function cleanupUrls() {
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

function resetSession(clearInput = true) {
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

  if (clearInput) els.fileInput.value = "";
  els.originalPlayer.removeAttribute("src");
  els.masteredPlayer.removeAttribute("src");
  els.trackTitle.textContent = "No track loaded";
  els.trackDetails.textContent = "Original and mastered waveforms will appear here.";
  resetAnalysisPanel();
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

function drawEmptyCanvas() {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  cleanupUrls();
  disposeMp3Worker();
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
}

function loadLocalEncoderScript() {
  if (window.lamejs?.Mp3Encoder) return;
  const script = document.createElement("script");
  script.src = "vendor/lame.min.js";
  script.defer = true;
  document.head.appendChild(script);
}

initApp();
