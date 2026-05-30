import { state } from "./state.js";
import { hasAudibleSignal } from "./analysis.js";
import { COPY, isApiMode } from "./constants.js";
import { PRESETS, formatPresetGuidance } from "./presets.js";
import { getAdaptiveTarget, getAdaptiveCeiling } from "./mastering.js";
import {
  clearChildren,
  formatBytes,
  formatTime,
  formatDbValue,
  formatDbtp,
  formatLufs,
  getExtension,
  isLossyFile,
} from "./utils.js";

export const els = {
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

export function setStatus(text) {
  els.statusText.textContent = text;
}

export function setAppPhase(phase) {
  if (els.appShell) els.appShell.dataset.phase = phase;
  updateWorkflowGuidance(state.lastReadiness);
}

export function setStatusBanner(message, variant = "error") {
  if (!els.statusBanner) return;
  if (!message) {
    clearStatusBanner();
    return;
  }
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner status-banner--${variant} is-visible`;
}

export function clearStatusBanner() {
  if (!els.statusBanner) return;
  els.statusBanner.textContent = "";
  els.statusBanner.className = "status-banner";
}

export function updateProcessingModeBadge() {
  if (!els.processingModeBadge) return;
  const server = isApiMode();
  els.processingModeBadge.textContent = server ? "Server processing" : "In-browser";
  els.processingModeBadge.classList.toggle("is-server", server);
  els.processingModeBadge.classList.toggle("is-local", !server);
}

export function updateDropzoneState(hasFile, fileName = "") {
  els.dropzone.classList.toggle("is-empty", !hasFile);
  els.dropzone.classList.toggle("has-file", Boolean(hasFile));
  const label = els.dropzone.querySelector(".dropzone-content strong");
  if (label) {
    label.textContent = hasFile && fileName ? fileName : "Drop your mix here";
  }
}

export function setExportState(stateClass) {
  if (!els.exportBox) return;
  els.exportBox.classList.remove("is-pending", "is-ready", "is-busy");
  if (stateClass) els.exportBox.classList.add(stateClass);
}

export function applyModeCopy() {
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

export function syncPresetButtonCopy() {
  els.presetButtons.forEach((button) => {
    const preset = PRESETS[button.dataset.preset];
    if (!preset) return;
    const span = button.querySelector("span");
    if (span) span.textContent = preset.description;
  });
}

export function renderExportFormatGuide() {
  if (!els.exportFormatGuide) return;
  clearChildren(els.exportFormatGuide);
  COPY.export.formats.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.label}</strong> — ${item.text}`;
    els.exportFormatGuide.appendChild(li);
  });
}

export function updateExportFormatVisibility() {
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

export function setAnalysisPlaceholderVisible(visible, copyKey = "empty") {
  if (els.analysisPlaceholder) {
    els.analysisPlaceholder.classList.toggle("hidden", !visible);
  }
  if (els.analysisPlaceholderCopy && visible) {
    els.analysisPlaceholderCopy.textContent = COPY.workflow.analysisPlaceholder[copyKey];
  }
}

export function showAnalysisResults() {
  setAnalysisPlaceholderVisible(false);
  els.analysisCard.classList.remove("hidden");
}

export function resetAnalysisPanel() {
  els.analysisCard.classList.add("hidden");
  els.analysisCard.classList.remove("is-ready");
  setAnalysisPlaceholderVisible(true, "empty");
}

export function setMasteringControlsLocked(locked) {
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

export function updateWorkflowYouAreHere() {
  if (!els.workflowYouAreHereText) return;
  const phase = els.appShell?.dataset.phase || "empty";
  els.workflowYouAreHereText.textContent =
    COPY.workflow.youAreHere[phase] || COPY.workflow.youAreHere.empty;
}

export function updateExportRecommendation() {
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

export function updateWorkflowStepHighlight() {
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

export function updatePreviewModeHelp(source = state.activeSource) {
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

export function updateMasterButtonHint() {
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

export function updateTransportHint() {
  if (!els.transportHint) return;
  const hasAudio = Boolean(state.originalBuffer || state.originalWaveformPeaks || state.originalUrl);
  if (!hasAudio || els.playButton.disabled) {
    els.transportHint.textContent = COPY.controls.playDisabled;
    els.transportHint.hidden = false;
  } else {
    els.transportHint.hidden = true;
  }
}

export function updateReadinessNextStep(readiness) {
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

export function updateWorkflowGuidance(readiness = null) {
  const phase = els.appShell?.dataset.phase || "empty";
  updateWorkflowStepHighlight();
  if (!els.analysisCard.classList.contains("hidden")) {
    setAnalysisPlaceholderVisible(false);
  } else if (phase === "loaded") {
    setAnalysisPlaceholderVisible(true, "loaded");
  } else if (phase === "empty" || phase === "error") {
    setAnalysisPlaceholderVisible(true, "empty");
  }
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
}

export function setProgress(step, percent, label) {
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

export function readControls() {
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

export function updateControlOutputs() {
  els.intensityOutput.textContent = `${els.intensitySlider.value}%`;
}

export function selectPreset(key, applyDefaults = true) {
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

export function renderAnalysis(file, buffer, analysis, warnings, readiness) {
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
  setMasteringControlsLocked(!hasAudibleSignal(analysis));
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

export function renderDecodeError(file, message) {
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
