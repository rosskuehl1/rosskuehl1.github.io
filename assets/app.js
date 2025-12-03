"use strict";

(function () {
  const STORAGE_KEY = "audio-sentiment-bot/api-base";
  const DEFAULT_BASE = "http://localhost:6142";

  const form = document.querySelector("[data-form]");
  if (!form) {
    return;
  }

  const fileInput = form.querySelector('[data-input="audio"]');
  const languageSelect = form.querySelector('[data-input="language"]');
  const submitButton = form.querySelector('[data-submit]');
  const statusEl = document.querySelector('[data-status]');
  const resultsEl = document.querySelector('[data-results]');
  const emptyStateEl = document.querySelector('[data-empty-state]');
  const apiBaseInput = form.querySelector('[data-input="api-base"]');
  const saveEndpointButton = form.querySelector('[data-action="save-endpoint"]');
  const resetEndpointButton = form.querySelector('[data-action="reset-endpoint"]');
  const endpointDisplay = form.querySelector('[data-endpoint-display]');
  const waveformCanvas = document.querySelector('[data-waveform]');
  const waveformContainer = document.querySelector('[data-waveform-container]');
  const waveformEmpty = document.querySelector('[data-waveform-empty]');
  const waveformMeta = document.querySelector('[data-waveform-meta]');
  const waveformClearButton = document.querySelector('[data-waveform-clear]');

  if (!fileInput) {
    return;
  }

  const defaultWaveformMessage = "Waveform preview appears after selecting an audio file.";
  let audioContext = null;

  const getAudioContext = () => {
    if (audioContext) {
      return audioContext;
    }
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }
    audioContext = new AudioContextConstructor();
    return audioContext;
  };

  const clearWaveform = (message) => {
    if (!waveformCanvas) {
      return;
    }
    const context = waveformCanvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
    if (waveformContainer) {
      waveformContainer.hidden = true;
    }
    if (waveformMeta) {
      waveformMeta.textContent = "";
    }
    if (waveformEmpty) {
      waveformEmpty.hidden = false;
      waveformEmpty.textContent = message || defaultWaveformMessage;
    }
  };

  const decodeBuffer = (context, arrayBuffer) => {
    if (!context) {
      return Promise.reject(new Error("Web Audio API not available."));
    }
    const bufferCopy = arrayBuffer.slice(0);
    if (context.decodeAudioData.length === 1) {
      return context.decodeAudioData(bufferCopy);
    }
    return new Promise((resolve, reject) => {
      context.decodeAudioData(bufferCopy, resolve, reject);
    });
  };

  const drawWaveform = (audioBuffer) => {
    if (!waveformCanvas) {
      return;
    }

    const parentWidth = waveformCanvas.parentElement ? waveformCanvas.parentElement.clientWidth : 0;
    const width = waveformCanvas.clientWidth || parentWidth || 640;
    const height = waveformCanvas.clientHeight || 160;
    const ratio = window.devicePixelRatio || 1;

    waveformCanvas.width = width * ratio;
    waveformCanvas.height = height * ratio;

    const context = waveformCanvas.getContext("2d");
    if (!context) {
      return;
    }

    context.save();
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    const channelData = audioBuffer.getChannelData(0);
    const samples = width;
    const blockSize = Math.max(1, Math.floor(channelData.length / samples));
    const midY = height / 2;

    context.lineWidth = 1.2;
    context.strokeStyle = "rgba(37, 99, 235, 0.9)";
    context.beginPath();
    context.moveTo(0, midY);

    for (let i = 0; i < samples; i += 1) {
      let min = 1.0;
      let max = -1.0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j += 1) {
        const datum = channelData[start + j];
        if (datum === undefined) {
          break;
        }
        if (datum < min) {
          min = datum;
        }
        if (datum > max) {
          max = datum;
        }
      }
      context.lineTo(i, midY + max * midY);
      context.lineTo(i, midY + min * midY);
    }

    context.lineTo(samples, midY);
    context.stroke();
    context.restore();
  };

  const renderWaveform = async (file) => {
    if (!waveformCanvas || !file) {
      return;
    }

    const context = getAudioContext();
    if (!context) {
      clearWaveform("Waveform preview not supported in this browser.");
      return;
    }

    try {
      if (context.state === "suspended") {
        await context.resume();
      }

      const buffer = await file.arrayBuffer();

      if (waveformContainer) {
        waveformContainer.hidden = false;
      }
      if (waveformEmpty) {
        waveformEmpty.hidden = true;
      }

      const audioBuffer = await decodeBuffer(context, buffer);

      drawWaveform(audioBuffer);
      if (waveformMeta) {
        const duration = audioBuffer.duration;
        const durationLabel = Number.isFinite(duration)
          ? `${duration.toFixed(2)}s`
          : "Unknown duration";
        const sampleRate = audioBuffer.sampleRate
          ? `${audioBuffer.sampleRate.toLocaleString()} Hz`
          : "Unknown sample rate";
        const sizeKb = file.size ? `${(file.size / 1024).toFixed(1)} KB` : "";
        const metaParts = [durationLabel, sampleRate, sizeKb].filter(Boolean);
        waveformMeta.textContent = metaParts.join(" · ");
      }
    } catch (error) {
      console.error("Waveform preview failed", error);
      clearWaveform("Could not render waveform preview for this file.");
    }
  };

  clearWaveform();
  const readStorage = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch (_err) {
      return null;
    }
  };

  const writeStorage = (key, value) => {
    try {
      if (value == null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (_err) {
      /* localStorage might be unavailable (private mode) */
    }
  };

  const sanitizeBase = (rawValue) => {
    const trimmed = (rawValue || "").trim();
    if (!trimmed) {
      return DEFAULT_BASE;
    }
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch (err) {
      throw new Error("Enter a valid API base URL, including http(s)://");
    }
    const normalized = parsed.origin + parsed.pathname.replace(/\/$/, "");
    return normalized || DEFAULT_BASE;
  };

  let apiBase = DEFAULT_BASE;
  try {
    const stored = readStorage(STORAGE_KEY);
    apiBase = sanitizeBase(stored);
  } catch (err) {
    apiBase = DEFAULT_BASE;
  }

  const apiEndpoint = () => {
    const candidate = apiBase.endsWith("/") ? apiBase : apiBase + "/";
    try {
      return new URL("analyze", candidate).toString();
    } catch (_err) {
      return candidate + "analyze";
    }
  };

  const updateEndpointDisplay = () => {
    const message = "Current API endpoint: " + apiEndpoint();
    if (endpointDisplay) {
      endpointDisplay.textContent = message;
    }
    if (apiBaseInput) {
      apiBaseInput.value = apiBase;
    }
  };

  const setStatus = (message, state) => {
    const tone = state || "ready";
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.dataset.state = tone;
    }
  };

  const toggleLoading = (isLoading) => {
    if (submitButton) {
      submitButton.disabled = Boolean(isLoading);
    }
    form.classList.toggle("is-uploading", Boolean(isLoading));
  };

  const ensureEmptyState = () => {
    if (!emptyStateEl) {
      return;
    }
    const hasResults = resultsEl && resultsEl.childElementCount > 0;
    emptyStateEl.hidden = Boolean(hasResults);
  };

  const formatScore = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "--";
    }
    return value.toFixed(2);
  };

  const toneFromLabel = (label) => {
    switch (label) {
      case "POSITIVE":
        return "positive";
      case "NEGATIVE":
        return "negative";
      case "NEUTRAL":
        return "neutral";
      default:
        return "unknown";
    }
  };

  const buildResultCard = (payload) => {
    const sentiment = payload && payload.sentiment ? payload.sentiment : null;
    const label = sentiment && sentiment.label ? sentiment.label : "UNKNOWN";
    const score = sentiment && sentiment.score != null ? sentiment.score : null;
    const transcript = payload && typeof payload.transcript === "string" ? payload.transcript : "";
    const language = payload && payload.language ? payload.language : "en-US";
    const note = payload && payload.error ? payload.error : "";
    const fileName = payload && payload.fileName ? payload.fileName : "Audio clip";
    const tone = toneFromLabel(label);

    const article = document.createElement("article");
    article.className = "result-card";
    article.dataset.tone = tone;
    article.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "result-card__header";

    const title = document.createElement("h3");
    title.className = "result-card__title";
    title.textContent = label === "UNKNOWN" ? "No sentiment detected" : label;
    header.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.dataset.tone = tone;
    badge.textContent = label === "UNKNOWN" ? "--" : label + " | " + formatScore(score);
    header.appendChild(badge);

    article.appendChild(header);

    const meta = document.createElement("p");
    meta.className = "result-card__meta";
    const now = new Date();
    const formattedTime = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    meta.textContent = fileName + " | " + language + " | " + formattedTime;
    article.appendChild(meta);

    const transcriptBlock = document.createElement("p");
    transcriptBlock.className = "result-card__transcript";
    transcriptBlock.textContent = transcript ? transcript : "No speech detected.";
    article.appendChild(transcriptBlock);

    if (note && tone === "unknown") {
      const noteBlock = document.createElement("p");
      noteBlock.className = "result-card__note";
      noteBlock.textContent = note;
      article.appendChild(noteBlock);
    }

    requestAnimationFrame(() => {
      try {
        article.focus();
      } catch (_focusError) {
        /* ignore focus failures */
      }
      article.addEventListener(
        "blur",
        () => {
          article.removeAttribute("tabindex");
        },
        { once: true }
      );
    });

    return article;
  };

  const resetFileInput = () => {
    const preservedLanguage = languageSelect ? languageSelect.value : "en-US";
    form.reset();
    if (languageSelect) {
      languageSelect.value = preservedLanguage;
    }
  };

  const handleError = (err) => {
    if (err instanceof Error) {
      setStatus(err.message, "error");
      return;
    }
    setStatus("Request failed.", "error");
  };

  const persistEndpoint = (value) => {
    apiBase = value;
    if (value === DEFAULT_BASE) {
      writeStorage(STORAGE_KEY, null);
    } else {
      writeStorage(STORAGE_KEY, value);
    }
    updateEndpointDisplay();
  };

  fileInput.addEventListener("change", (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      clearWaveform();
      return;
    }
    const selectedFile = files[0];
    renderWaveform(selectedFile);
  });

  if (waveformClearButton) {
    waveformClearButton.addEventListener("click", () => {
      clearWaveform();
      if (fileInput) {
        fileInput.value = "";
      }
    });
  }

  if (saveEndpointButton) {
    saveEndpointButton.addEventListener("click", () => {
      try {
        const nextBase = sanitizeBase(apiBaseInput ? apiBaseInput.value : "");
        persistEndpoint(nextBase);
        setStatus("Saved API endpoint.", "ready");
      } catch (err) {
        handleError(err);
      }
    });
  }

  if (resetEndpointButton) {
    resetEndpointButton.addEventListener("click", () => {
      persistEndpoint(DEFAULT_BASE);
      setStatus("Reset to default endpoint.", "ready");
    });
  }

  if (apiBaseInput) {
    apiBaseInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (saveEndpointButton) {
          saveEndpointButton.click();
        }
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!fileInput.files || fileInput.files.length === 0) {
      setStatus("Select an audio file to begin.", "error");
      fileInput.focus();
      return;
    }

    const audioFile = fileInput.files[0];
    const language = (languageSelect && languageSelect.value) || "en-US";

    const formData = new FormData();
    formData.append("audio", audioFile);
    formData.append("language", language);

    setStatus("Analyzing audio...", "working");
    toggleLoading(true);

    const endpoint = apiEndpoint();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch (_jsonError) {
        throw new Error("Unexpected server response.");
      }

      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : "Request failed.");
      }

      payload.fileName = audioFile.name;

      if (resultsEl) {
        const resultCard = buildResultCard(payload);
        resultsEl.prepend(resultCard);
      }
      ensureEmptyState();

      if (payload.error && !payload.sentiment) {
        setStatus(payload.error, "warn");
      } else {
        setStatus("Analysis complete.", "ready");
      }
    } catch (err) {
      if (err instanceof TypeError) {
        handleError(new Error("Could not reach API endpoint. Check CORS and network settings."));
      } else {
        handleError(err);
      }
    } finally {
      toggleLoading(false);
      resetFileInput();
    }
  });

  updateEndpointDisplay();
  ensureEmptyState();
})();
