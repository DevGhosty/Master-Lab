# Master Lab

Master Lab is a free, browser-based audio mastering tool. Upload a track, review an automatic source check, pick a mastering goal, preview the result against the original, and download masters in common formats. No account and no paywall.

## Where to use it

- **Live app:** [https://devghosty.github.io/Master-Lab/](https://devghosty.github.io/Master-Lab/)
- **Source code:** [https://github.com/DevGhosty/Master-Lab](https://github.com/DevGhosty/Master-Lab)

## What it does

1. **Upload** — WAV, AIFF, FLAC, MP3, M4A, AAC, or OGG (whatever your browser can decode).
2. **Original audio check** — File metadata, integrated loudness (LUFS), true peak, crest factor, silence, clipping hints, stereo correlation, and readiness warnings before you commit to a master.
3. **Master** — Choose a preset (Balanced, Loud, Warm, Bright, Bass Boost, or Streaming Ready) and optional fine-tuning (intensity, warmth, air, trim leading silence).
4. **Compare** — Waveform view and A/B playback: original, mastered, or overlay; optional volume-matched preview.
5. **Export** — WAV 32-bit float, WAV 24-bit PCM, WAV 16-bit dithered, and MP3 320 kbps.

All processing is designed to stay on your machine when the app runs in **local mode**. When a server API URL is configured for the hosted build, analyze and master run on that server instead; audio is processed in temporary storage and not kept after the job finishes.

## Technical overview

| Area | Implementation |
|------|----------------|
| UI | Static HTML, CSS, vanilla JavaScript (no framework) |
| Decode & playback | Web Audio API (`AudioContext`, `decodeAudioData`) |
| Analysis | In-browser BS.1770-style integrated LUFS (K-weighting, gating), oversampled true-peak estimate, band balance, DC offset, silence and clipping heuristics |
| Mastering (local) | `OfflineAudioContext` chain: high-pass, shelves/peaking EQ, light waveshaper saturation, bus compression, loudness-aware gain, lookahead peak limiter, ceiling normalize |
| Mastering (server) | Optional Node API with FFmpeg/ffprobe; preset-mapped filter graphs (not bit-identical to the browser chain) |
| MP3 (local) | Bundled [lamejs](https://github.com/zhuker/lamejs) 1.2.1 (`vendor/lame.min.js`), encode in a Web Worker when supported |
| Exports (local) | WAV encoders in JS; MP3 via lamejs |
| Privacy model | Local mode: no upload. Server mode: ephemeral files only |
| Hosting | GitHub Pages for the UI; optional Docker API (`server/`) for faster analyze/master on long files |

## Limits

- Mono or stereo only  
- Max file size: 150 MB  
- Max length: 15 minutes  
- LUFS and true peak are useful estimates, not certified broadcast meters  

## Repository layout

- `index.html`, `styles.css`, `app.js` — application UI and logic  
- `vendor/lame.min.js` — MP3 encoder (local mode)  
- `mp3-worker.js` — background MP3 encoding  
- `config.js` — optional API base URL for server-backed mode on the hosted site  
- `server/` — ephemeral FFmpeg API (companion to the static app)  
