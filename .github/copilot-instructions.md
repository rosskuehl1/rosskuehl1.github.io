# GitHub Pages – Audio Sentiment Bot Frontend

## Purpose
- Hosts the static web UI for the Audio Sentiment Bot on GitHub Pages.
- Mirrors the layout and behaviour of `audio_sentiment_bot/templates/index.html` and `static/app.js` but runs without Flask.
- Keep this repo in parity with the backend project; the Audio Sentiment Bot experience is the top priority for every change.

## Key Files
- `index.html` – Static markup; includes language dropdown, API endpoint controls, and history panel.
- `assets/app.js` – Handles uploads, waveform rendering via Web Audio API, endpoint persistence via `localStorage`, and history rendering. Posts to `<api-base>/analyze`.
- `assets/styles.css` – Shared visual system with the Flask app; keep selectors consistent before copying updates downstream.

## API Endpoint Handling
- Default base: `http://localhost:6142` (matches local Flask dev server).
- Users can override via the **API endpoint** input; value saved under `audio-sentiment-bot/api-base` in `localStorage`.
- JS normalises the base and expands requests with `new URL("/analyze", apiBase)`; ensure new routes stick to the `/analyze` path unless you update both repos.
- When running on GitHub Pages, the backend must send CORS headers that include the Pages domain.
- Flask reads `AUDIO_SENTIMENT_BOT_CORS_ORIGIN`; remind backend owners to set it to the published Pages URL.

## Update Workflow
1. Apply UI changes in `audio_sentiment_bot` first.
2. Copy the updated markup and assets into this repo, keeping the endpoint controls intact.
3. Adjust any Flask-specific templating (`{{ url_for(...) }}`) to use static paths.
4. Test locally with `python -m http.server`, verify waveform preview renders, and confirm uploads reach your backend.
5. Commit to `main`; Pages will redeploy automatically.

## Waveform Preview
- The canvas preview uses `AudioContext` + `decodeAudioData`; keep helper functions (`renderWaveform`, `drawWaveform`, `clearWaveform`) synchronized with the backend repo.
- Never upload decoded PCM data—the preview and metadata remain local to the browser.
- Provide graceful fallbacks: call `clearWaveform` with explanatory copy when the Web Audio API is unavailable.

## Common Pitfalls
- Forgetting to normalise API base URLs leads to double slashes; rely on `sanitizeBase` before storing.
- Removing endpoint controls breaks hosted usage—only trim them if the backend origin is truly fixed.
- Private browsing may block `localStorage`; the page still operates but reverts to the default endpoint every load.
