# GitHub Pages – Audio Sentiment Bot Frontend

## Purpose
- Hosts the production version of the zero-backend Audio Sentiment Bot UI on GitHub Pages (`https://rosskuehl1.github.io`).
- Mirrors `audio_sentiment_bot/docs/` exactly; treat that folder as the source of truth and keep the repos in sync.
- Prioritize the plug-and-play guitar workflow: visitors should be able to connect an instrument, play immediately, and see helpful visuals and sentiment cues.

## Key Files
- `index.html` – Static markup powering the entire experience (recording controls, instrument selector, live insight chips, trend sparkline, CI badge).
- `assets/app.js` – Browser-only logic: Whisper transcription, DistilBERT sentiment, waveform rendering, instrument-mode tuning, live analysis queue, CI status fetch.
- `assets/styles.css` – Design tokens and layout primitives shared with the main repo. Update colors/components here when rebranding the analyzer.

## Workflow & Deployment
1. Make changes in `audio_sentiment_bot/docs/` first.
2. Copy `docs/index.html` → `index.html` and `docs/assets/*` → `assets/` in this repo.
3. Keep IDs, `data-*` attributes, and selectors consistent; Playwright smoke tests rely on them.
4. Preview locally with `npx serve .` (or any static server) to verify recording, live sentiment, waveform, and sparkline behaviors.
5. Commit to `main`; GitHub Pages redeploys automatically.

## Live Analysis Notes
- All processing stays in the browser via `@xenova/transformers`. Do not add backend calls.
- Instrument mode disables AGC/noise suppression; voice mode re-enables them. Preserve this toggling when editing `startRecording`.
- Keep `LIVE_ANALYSIS_*` constants and `queueLiveAnalysis` logic aligned with the main repo to avoid drift in latency.

## CI/CD
- This repo should remain deployable at all times. Any change that breaks the static bundle blocks production.
- When updating selectors or layout, confirm Playwright smoke tests in the main repo still pass (they exercise the shared UI).

## Waveform & Trend UI
- `drawWaveform`, `drawLiveWaveform`, `computeEnergyPercent`, and `addTrendPoint` must stay consistent with the source repo to avoid visual differences between preview and production.
- Always clear the waveform and trend buffers when resetting inputs or stopping a recording to prevent stale visuals.
