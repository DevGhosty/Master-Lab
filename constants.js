export const LOSSY_EXTENSIONS = new Set(["mp3", "m4a", "aac", "ogg", "opus", "wma"]);
export const LOSSLESS_EXTENSIONS = new Set(["wav", "aif", "aiff", "flac"]);
export const SUPPORTED_EXTENSIONS = new Set([...LOSSY_EXTENSIONS, ...LOSSLESS_EXTENSIONS]);
export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 15 * 60;
export const MAX_CHANNELS = 2;
export const CLIPPING_THRESHOLD = 0.999;
export const TRUE_PEAK_OVERSAMPLE = 4;
export const LUFS_ABSOLUTE_GATE = -70;
export const LUFS_RELATIVE_GATE_OFFSET = -10;
export const API_FETCH_TIMEOUT_MS = 45000;
export const API_ANALYZE_TIMEOUT_MS = 300000;
export const API_MASTER_START_TIMEOUT_MS = 300000;
export const API_HEALTH_TIMEOUT_MS = 8000;
export const API_HEALTH_WAKE_TIMEOUT_MS = 15000;
export const API_HEALTH_POLL_ONLINE_MS = 60000;
export const API_HEALTH_POLL_OFFLINE_MS = 20000;
export const API_HEALTH_WAKE_ATTEMPTS = 8;
export const API_HEALTH_WAKE_RETRY_MS = 3000;
export const API_LOCAL_DEV_ORIGINS = new Set(["http://localhost:8100", "http://127.0.0.1:8100"]);

export const COPY = {
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
    serverWakeup: "Server may be waking up—tap Wake server above the upload area, then try again.",
    serverUnavailable: "Could not reach the mastering server while analyzing your file. Large files can take several minutes on free hosting—try again or use Wake server above.",
    masterServerUnavailable: "Could not reach the mastering server while rendering your master. Large files can take several minutes on free hosting—try again.",
    serverRetryStep: "Tap Wake server above, wait for the green dot, then upload again.",
    masterFailed: "Mastering failed. Your original file was not changed.",
  },
  serverStatus: {
    checking: "Checking server…",
    online: "Server online",
    offline: "Server sleeping",
    waking: "Waking server…",
    wakeButton: "Wake server",
    wakeHint: "Free hosting sleeps when idle. Waking takes 30–60 seconds.",
    wrongLocalPort: "Local testing must use http://127.0.0.1:8100 so the browser can reach the API.",
    titleChecking: "Checking mastering server",
    titleOnline: "Mastering server is ready",
    titleOffline: "Mastering server is asleep",
    titleWaking: "Waking mastering server",
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

export function getApiBase() {
  const base = (window.MASTER_LAB_API || "").trim().replace(/\/$/, "");
  return base;
}

export function isApiMode() {
  return Boolean(getApiBase());
}
