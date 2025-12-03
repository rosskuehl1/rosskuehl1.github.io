# Audio Sentiment Bot – GitHub Pages

This repository serves the production build of Audio Sentiment Bot. The app now runs completely client-side: audio decoding, waveform rendering, Whisper transcription, and DistilBERT sentiment analysis all execute in the browser through `@xenova/transformers`. No backend is required and audio never leaves the device.

## Quick start

```bash
cd rosskuehl1.github.io
npx serve .
```

Visit the printed URL in Chromium or Firefox, drop a short audio clip (≤ ~90 seconds), and wait for the one-time model download to finish. Subsequent runs are fast thanks to browser caching.

## Repository layout

```
index.html          Static page served by GitHub Pages
assets/
  ├─ app.js         Web Audio decoding, Whisper transcription, sentiment scoring
  └─ styles.css     Responsive UI styling
```

## Deployment

Commit and push to `main`; GitHub Pages is configured to deploy automatically. The only external dependency is the jsDelivr CDN that serves the Transformers.js bundle and model weights.

To update from the core project, copy the contents of `audio_sentiment_bot/docs/` into this repository and redeploy.

## Browser requirements

- WebAssembly SIMD + multi-threading support (Chromium 115+, Firefox 116+, Safari 17.4+).
- Models download ~80 MB on the first run; a stable connection is helpful.
- Private browsing modes may disable IndexedDB caching, which increases load times across sessions.

## Troubleshooting

- **Model fails to load**: Check the browser console for network errors; some corporate networks block jsDelivr.
- **Clip rejected**: Files longer than ~90 seconds are rejected to keep inference responsive.
- **Silence detected**: Ensure the recording has audible speech; background music alone will not transcribe well.
