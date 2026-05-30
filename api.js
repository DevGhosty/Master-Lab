import { state } from "./state.js";
import {
  COPY,
  getApiBase,
  isApiMode,
  API_FETCH_TIMEOUT_MS,
  API_ANALYZE_TIMEOUT_MS,
  API_MASTER_START_TIMEOUT_MS,
  API_HEALTH_TIMEOUT_MS,
  API_HEALTH_WAKE_TIMEOUT_MS,
  API_HEALTH_POLL_ONLINE_MS,
  API_HEALTH_POLL_OFFLINE_MS,
  API_HEALTH_WAKE_ATTEMPTS,
  API_HEALTH_WAKE_RETRY_MS,
  API_LOCAL_DEV_ORIGINS,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from "./constants.js";
import { formatBytes, formatTime, nextFrame } from "./utils.js";
import { PRESETS } from "./presets.js";
import { buildWarnings, getReadiness, normalizeAnalysisMetrics, hasAudibleSignal } from "./analysis.js";
import {
  els,
  renderDecodeError,
  renderAnalysis,
  setStatus,
  setProgress,
  setAppPhase,
  setStatusBanner,
  clearStatusBanner,
  setExportState,
  updateExportRecommendation,
  readControls,
  updateServerStatusUI,
  setServerStatusVisibility,
} from "./dom.js";
import {
  updateStats,
  drawWaveform,
  setPlaybackSource,
  pausePlayback,
} from "./waveform.js";
import { disableExports, enableDownload } from "./export.js";

let serverStatus = "unknown";
let statusPollTimer = null;
let wakeInProgress = false;

// #region agent log
function debugLog(location, message, data = {}, hypothesisId = "") {
  fetch("http://127.0.0.1:7879/ingest/ad2e6eb4-20ca-46db-bc4c-e6cc64f15731", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "3d1c5b" },
    body: JSON.stringify({
      sessionId: "3d1c5b",
      location,
      message,
      data,
      hypothesisId,
      runId: "pre-fix",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export async function fetchWithTimeout(url, options = {}, timeoutMs = API_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isFetchTimeoutError(error) {
  return error?.name === "AbortError";
}

export function apiFetchErrorMessage(error) {
  if (isServerReachabilityError(error)) return COPY.errors.serverUnavailable;
  return COPY.errors.serverUnreachable;
}

function isServerReachabilityError(error) {
  if (isFetchTimeoutError(error)) return true;
  if (!navigator.onLine) return true;
  return error instanceof TypeError;
}

function isTransientServerHttpStatus(status) {
  return status === 408 || status === 502 || status === 503 || status === 504;
}

function markServerOffline() {
  if (wakeInProgress) return;
  setServerStatus("offline");
  scheduleServerStatusPoll();
}

function isLocalDevCorsBlocked() {
  if (typeof window === "undefined") return false;
  const origin = window.location.origin;
  if (!origin.includes("localhost") && !origin.includes("127.0.0.1")) return false;
  return !API_LOCAL_DEV_ORIGINS.has(origin);
}

function localDevStatusDetail() {
  return isLocalDevCorsBlocked() ? COPY.serverStatus.wrongLocalPort : "";
}

export function getServerStatus() {
  return serverStatus;
}

function setServerStatus(status, detail = "") {
  serverStatus = status;
  updateServerStatusUI(status, detail);
}

function scheduleServerStatusPoll() {
  if (statusPollTimer) clearTimeout(statusPollTimer);
  if (!isApiMode() || wakeInProgress) return;
  const delay = serverStatus === "online" ? API_HEALTH_POLL_ONLINE_MS : API_HEALTH_POLL_OFFLINE_MS;
  statusPollTimer = setTimeout(() => {
    refreshServerStatus();
  }, delay);
}

export async function checkServerHealth(options = {}) {
  if (!isApiMode()) return { ok: false, skipped: true };
  const timeoutMs = options.timeoutMs ?? API_HEALTH_TIMEOUT_MS;
  try {
    const response = await fetchWithTimeout(
      `${getApiBase()}/health`,
      { method: "GET", cache: "no-store" },
      timeoutMs,
    );
    if (!response.ok) return { ok: false, error: "http" };
    const payload = await response.json().catch(() => ({}));
    return { ok: payload.ok === true || response.ok };
  } catch (error) {
    // #region agent log
    debugLog("api.js:checkServerHealth:catch", "health check failed", {
      errorName: error?.name,
      errorMessage: error?.message,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      localDevCorsBlocked: isLocalDevCorsBlocked(),
      timeoutMs,
    }, isLocalDevCorsBlocked() ? "F" : "E");
    // #endregion
    return {
      ok: false,
      error: isFetchTimeoutError(error) ? "timeout" : "network",
    };
  }
}

export async function refreshServerStatus() {
  if (!isApiMode() || wakeInProgress) return false;
  setServerStatus("checking");
  const result = await checkServerHealth();
  setServerStatus(result.ok ? "online" : "offline", result.ok ? "" : localDevStatusDetail());
  scheduleServerStatusPoll();
  return result.ok;
}

export async function wakeServer() {
  if (!isApiMode() || wakeInProgress) return false;
  wakeInProgress = true;
  if (statusPollTimer) {
    clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }

  for (let attempt = 1; attempt <= API_HEALTH_WAKE_ATTEMPTS; attempt += 1) {
    setServerStatus("waking", `${COPY.serverStatus.waking} (${attempt}/${API_HEALTH_WAKE_ATTEMPTS})`);
    const result = await checkServerHealth({ timeoutMs: API_HEALTH_WAKE_TIMEOUT_MS });
    // #region agent log
    debugLog("api.js:wakeServer:attempt", "wake attempt finished", {
      attempt,
      ok: result.ok,
      error: result.error || null,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      localDevCorsBlocked: isLocalDevCorsBlocked(),
    }, result.ok ? "E" : isLocalDevCorsBlocked() ? "F" : "E");
    // #endregion
    if (result.ok) {
      wakeInProgress = false;
      setServerStatus("online");
      scheduleServerStatusPoll();
      return true;
    }
    if (attempt < API_HEALTH_WAKE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, API_HEALTH_WAKE_RETRY_MS));
    }
  }

  wakeInProgress = false;
  setServerStatus("offline", localDevStatusDetail());
  scheduleServerStatusPoll();
  return false;
}

export function startServerStatusMonitor() {
  if (!isApiMode()) {
    document.documentElement.classList.remove("api-mode");
    setServerStatusVisibility(false);
    return;
  }
  document.documentElement.classList.add("api-mode");
  setServerStatusVisibility(true);
  refreshServerStatus();
}

export function stopServerStatusMonitor() {
  if (statusPollTimer) {
    clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }
}

export function getProbeBuffer() {
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

export async function loadFileViaApi(file, options = {}) {
  const isRetry = options.isRetry === true;
  if (!file.type.startsWith("audio/") && !SUPPORTED_EXTENSIONS.has(state.fileExtension)) {
    renderDecodeError(file, "This file type is not supported yet.");
    return;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    renderDecodeError(file, `This file is larger than ${formatBytes(MAX_FILE_SIZE_BYTES)}. Try a shorter export or a smaller file.`);
    return;
  }

  if (isApiMode() && serverStatus === "offline" && !isRetry) {
    setAppPhase("loaded");
    setStatus(COPY.serverStatus.waking);
    setProgress("analyze", 6, "Waking server");
    const ready = await wakeServer();
    if (!ready) {
      renderDecodeError(file, COPY.errors.serverUnavailable, "server");
      return;
    }
  }

  setAppPhase("loaded");
  setStatus("Uploading to server for analysis… Large files may take 1–3 minutes.");
  setProgress("analyze", 12, "Uploading audio");

  const analyzeStartedAt = Date.now();
  // #region agent log
  debugLog("api.js:loadFileViaApi:start", "analyze upload started", {
    fileSize: file.size,
    fileName: file.name,
    serverStatus,
    timeoutMs: API_ANALYZE_TIMEOUT_MS,
    isRetry,
  }, "A");
  // #endregion

  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetchWithTimeout(
      `${getApiBase()}/api/analyze`,
      { method: "POST", body: form },
      API_ANALYZE_TIMEOUT_MS,
    );
    const payload = await response.json();

    // #region agent log
    debugLog("api.js:loadFileViaApi:afterPost", "analyze response received", {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - analyzeStartedAt,
    }, response.ok ? "B" : "B");
    // #endregion

    if (!response.ok) {
      if (isTransientServerHttpStatus(response.status) && !isRetry) {
        markServerOffline();
        setStatus(COPY.errors.serverWakeup);
        setProgress("analyze", 8, "Waking server");
        const woke = await wakeServer();
        if (woke) {
          const retried = await loadFileViaApi(file, { isRetry: true });
          if (retried === true) return;
        }
        renderDecodeError(file, COPY.errors.serverUnavailable, "server");
        return;
      }
      renderDecodeError(file, payload.error || "Server analysis failed.");
      return;
    }

    state.apiProbe = payload.probe;
    state.analysis = normalizeAnalysisMetrics(payload.analysis);
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

    els.masterButton.disabled = !hasAudibleSignal(state.analysis);
    els.playButton.disabled = false;
    els.seekSlider.disabled = false;
    els.resetButton.disabled = false;
    els.emptyWave.classList.add("hidden");
    if (isApiMode()) {
      setServerStatus("online");
      scheduleServerStatusPoll();
    }
    return true;
  } catch (error) {
    console.error(error);
    // #region agent log
    debugLog("api.js:loadFileViaApi:catch", "analyze failed", {
      errorName: error?.name,
      errorMessage: error?.message,
      isTimeout: isFetchTimeoutError(error),
      isReachability: isServerReachabilityError(error),
      elapsedMs: Date.now() - analyzeStartedAt,
      serverStatus,
      isRetry,
    }, isFetchTimeoutError(error) ? "A" : "D");
    // #endregion
    const serverError = isServerReachabilityError(error);
    if (serverError) markServerOffline();
    if (serverError && !isRetry) {
      if (serverStatus !== "online") {
        setStatus(COPY.errors.serverWakeup);
        setProgress("analyze", 8, "Waking server");
        await wakeServer();
      } else {
        setStatus("Retrying upload…");
        setProgress("analyze", 10, "Retrying upload");
      }
      const retried = await loadFileViaApi(file, { isRetry: true });
      if (retried === true) return;
    }
    renderDecodeError(file, apiFetchErrorMessage(error), serverError ? "server" : "decode");
    return false;
  }
}

export async function runMasteringViaApi() {
  if (!state.file || !state.apiProbe) return;

  pausePlayback();
  clearStatusBanner();
  disableExports();
  els.masterButton.disabled = true;
  els.masterButton.textContent = "Mastering...";

  // #region agent log
  debugLog("api.js:runMasteringViaApi:start", "mastering started", {
    fileSize: state.file?.size,
    fileName: state.fileName,
    serverStatus,
    timeoutMs: API_FETCH_TIMEOUT_MS,
    durationSec: state.apiProbe?.duration,
  }, "A");
  // #endregion

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

    const masterPostStartedAt = Date.now();
    // #region agent log
    debugLog("api.js:runMasteringViaApi:beforePost", "posting master job", {
      apiBase: getApiBase(),
      preset: state.selectedPreset,
      timeoutMs: API_FETCH_TIMEOUT_MS,
    }, "A");
    // #endregion

    const startResponse = await fetchWithTimeout(`${getApiBase()}/api/master/jobs`, {
      method: "POST",
      body: form,
    }, API_MASTER_START_TIMEOUT_MS);
    const startPayload = await startResponse.json();

    // #region agent log
    debugLog("api.js:runMasteringViaApi:afterPost", "master job post finished", {
      ok: startResponse.ok,
      status: startResponse.status,
      elapsedMs: Date.now() - masterPostStartedAt,
      jobId: startPayload?.jobId || null,
      error: startPayload?.error || null,
    }, startResponse.ok ? "B" : "B");
    // #endregion

    if (!startResponse.ok) {
      throw new Error(startPayload.error || "Could not start mastering job");
    }

    state.masterJobId = startPayload.jobId;
    setStatus(`Applying ${PRESETS[state.selectedPreset].label} preset on server...`);
    setProgress("apply", 70, "Applying mastering preset");

    let job = startPayload;
    let pollCount = 0;
    while (job.status === "queued" || job.status === "processing") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      pollCount += 1;
      const pollStartedAt = Date.now();
      const statusResponse = await fetchWithTimeout(`${getApiBase()}/api/jobs/${state.masterJobId}`);
      job = await statusResponse.json();
      // #region agent log
      if (pollCount <= 3 || !statusResponse.ok || job.status === "failed") {
        debugLog("api.js:runMasteringViaApi:poll", "job poll tick", {
          pollCount,
          ok: statusResponse.ok,
          status: statusResponse.status,
          jobStatus: job?.status,
          progress: job?.progress,
          elapsedMs: Date.now() - pollStartedAt,
        }, "C");
      }
      // #endregion
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
    // #region agent log
    debugLog("api.js:runMasteringViaApi:catch", "mastering failed", {
      errorName: error?.name,
      errorMessage: error?.message,
      isTimeout: isFetchTimeoutError(error),
      isReachability: isServerReachabilityError(error),
      serverStatus,
    }, isFetchTimeoutError(error) ? "A" : "D");
    // #endregion
    setAppPhase("error");
    const message = isFetchTimeoutError(error) || isServerReachabilityError(error)
      ? COPY.errors.masterServerUnavailable
      : COPY.errors.masterFailed;
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
