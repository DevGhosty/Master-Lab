# Master Lab

A browser-only audio mastering prototype. It lets users upload an audio file, review an original audio check, choose a mastering goal, render a local master, compare original vs mastered playback, and download the mastered file for free.

## Run

Open `index.html` in a modern browser. No server or install step is required.

For public hosting, this static app can be served from GitHub Pages. The target repo is:

```text
https://github.com/DevGhosty/Master-Lab.git
```

## What it does

- Decodes audio with the browser Web Audio API.
- Shows honest source metadata, readiness, and warnings before mastering.
- Supports Balanced, Loud, Warm, Bright, Bass Boost, and Streaming Ready presets.
- Runs a local offline mastering chain with restrained EQ, light saturation, bus compression, loudness-aware gain staging, and lookahead peak limiting.
- Measures browser-side BS.1770-style integrated LUFS with K-weighting and gating.
- Estimates true peak with oversampled interpolation and validates the final ceiling.
- Shows DC offset, stereo correlation, crest factor, silence, clipping, and broad tonal balance diagnostics.
- Exports WAV 32-bit float locally.
- Exports WAV 24-bit PCM and WAV 16-bit dithered locally.
- Exports MP3 320 kbps when the browser MP3 encoder loads successfully.

## Privacy and limits

- Audio is decoded, analyzed, mastered, previewed, and exported in the browser.
- The app does not upload, store, or retain user audio files.
- Files larger than 150 MB are rejected before decode.
- Files longer than 15 minutes are rejected after decode to protect browser memory.
- This prototype supports mono and stereo audio.

## Notes

The LUFS meter is a browser-side BS.1770-style implementation, not a certified broadcast meter. True peak is oversampled and safer than sample peak, but a dedicated mastering backend with FFmpeg/pyloudnorm would still be the next step for production-grade verification.

MP3 export uses `vendor/lame.min.js` as the local entrypoint. In this workspace it is a small loader because the environment denied writing the full 156 KB encoder bundle into the OneDrive folder; replace it with the real lamejs 1.2.1 bundle for fully offline MP3 export. WAV exports remain fully local.
