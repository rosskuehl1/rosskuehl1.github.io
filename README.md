# Audio Sentiment Bot – GitHub Pages Frontend

This repository hosts the static frontend for the Audio Sentiment Bot on GitHub Pages. The page reuses the production UI from the core project, including the live waveform preview, and sends audio files to a configurable backend API (defaulting to `http://localhost:6142`).

## Quick Start

1. Serve the backend locally:
   ```bash
   cd ../audio_sentiment_bot
   python app.py
   ```
2. Open the published GitHub Pages site (or `index.html` directly) and upload an audio clip.
3. Update the **API endpoint** field on the page if your backend is running on a different host or protocol.
4. Confirm the waveform preview renders for the clip before uploading.

## Repository Layout

```
index.html          Main page served by GitHub Pages
assets/
  ├─ app.js         Upload + history logic, configurable API base
  └─ styles.css     Mobile-first layout shared with the Flask app
```

## Customising the API Endpoint

- The endpoint selector stores its value in `localStorage` (`audio-sentiment-bot/api-base`).
- Click **Save** after editing the field, or **Reset** to return to the local default.
- The page always posts to `<api-base>/analyze`; ensure your backend exposes that route and supports CORS when served from GitHub Pages.
- Set the backend environment variable `AUDIO_SENTIMENT_BOT_CORS_ORIGIN` to your Pages URL (for example `https://rosskuehl1.github.io`) so the Flask API allows cross-origin uploads.
- Waveform previews stay local—only the raw file you submit is uploaded to the API.

## Updating from the Core Project

1. Pull the latest changes in `audio_sentiment_bot`.
2. Copy or port modifications from `templates/index.html`, `static/app.js`, or `static/styles.css` into this repository.
3. Adjust the static markup to keep hard-coded assets and the endpoint controls in sync.
4. Commit and push to `main`; GitHub Pages will redeploy automatically.

## Local Preview

Any static server works. For a quick test:

```bash
cd rosskuehl1.github.io
python -m http.server 4000
```

Then visit `http://localhost:4000` and verify the site can reach your backend API.

## Troubleshooting

- **CORS errors**: Ensure the Flask app sets `Access-Control-Allow-Origin` or run a proxy that resides on the same origin.
- **Uploads failing instantly**: Confirm the backend is reachable and that the API endpoint field points to a valid URL (including `https://`).
- **History cards empty**: Some browsers block `localStorage` in private mode, which also prevents the endpoint from persisting. The UI still works, but the endpoint resets to the default on each load.
