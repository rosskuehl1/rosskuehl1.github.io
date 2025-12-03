import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0/dist/transformers.min.js";

const TARGET_SAMPLE_RATE = 16000;
const MAX_DURATION_SECONDS = 90;
const DEFAULT_STATUS = "Models load on first run.";
const defaultWaveformMessage = "Waveform preview appears after selecting an audio file.";

const form = document.querySelector("[data-form]");
const fileInput = form ? form.querySelector('[data-input="audio"]') : null;
const submitButton = form ? form.querySelector('[data-submit]') : null;
const statusEl = document.querySelector('[data-status]');
const resultsEl = document.querySelector('[data-results]');
const emptyStateEl = document.querySelector('[data-empty-state]');
const waveformCanvas = document.querySelector('[data-waveform]');
const waveformContainer = document.querySelector('[data-waveform-container]');
const waveformEmpty = document.querySelector('[data-waveform-empty]');
const waveformMeta = document.querySelector('[data-waveform-meta]');
const waveformClearButton = document.querySelector('[data-waveform-clear]');

const state = {
  audioBuffer: null,
  audioFile: null,
  pipelinesPromise: null,
  audioContext: null,
};

env.allowRemoteModels = true;
env.useBrowserCache = true;
if (navigator.hardwareConcurrency && navigator.hardwareConcurrency > 4) {
  env.backends.onnx.wasm.numThreads = Math.min(4, Math.ceil(navigator.hardwareConcurrency / 2));
}

function setStatus(message, tone) {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.dataset.state = tone || "ready";
}

function toggleLoading(isLoading) {
  if (submitButton) {
    submitButton.disabled = Boolean(isLoading);
  }
  if (form) {
    form.classList.toggle("is-uploading", Boolean(isLoading));
  }
}

function ensureEmptyState() {
  if (!emptyStateEl) {
    return;
  }
  const hasResults = resultsEl && resultsEl.childElementCount > 0;
  emptyStateEl.hidden = Boolean(hasResults);
}

function getAudioContext() {
  if (state.audioContext) {
    return state.audioContext;
  }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }
  state.audioContext = new AudioContextConstructor();
  return state.audioContext;
}

function clearWaveform(message) {
  if (waveformCanvas) {
    const context = waveformCanvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
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
}

function drawWaveform(audioBuffer) {
  if (!waveformCanvas || !audioBuffer) {
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
}

async function decodeFile(file) {
  const context = getAudioContext();
  if (!context) {
    throw new Error("Web Audio API not available in this browser.");
  }

  if (context.state === "suspended") {
    await context.resume();
  }

  const arrayBuffer = await file.arrayBuffer();

  if (context.decodeAudioData.length === 1) {
    return context.decodeAudioData(arrayBuffer.slice(0));
  }

  return new Promise((resolve, reject) => {
    context.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
  });
}

function mixToMono(buffer) {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const length = buffer.length;
  const output = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      output[i] += channelData[i];
    }
  }
  for (let i = 0; i < length; i += 1) {
    output[i] /= buffer.numberOfChannels;
  }
  return output;
}

function resample(array, originalRate, targetRate) {
  if (originalRate === targetRate) {
    return new Float32Array(array);
  }

  const ratio = originalRate / targetRate;
  const newLength = Math.round(array.length / ratio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffset = (offsetResult + 1) * ratio;
    const start = Math.floor(offsetBuffer);
    const end = Math.min(Math.floor(nextOffset), array.length);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += 1) {
      sum += array[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? sum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffset;
  }

  return result;
}

function toneFromLabel(label) {
  const normalized = (label || "").toUpperCase();
  if (normalized.includes("POSITIVE") || normalized === "LABEL_1") {
    return "positive";
  }
  if (normalized.includes("NEGATIVE") || normalized === "LABEL_0") {
    return "negative";
  }
  if (normalized.includes("NEUTRAL")) {
    return "neutral";
  }
  return "unknown";
}

function buildResultCard(payload) {
  const sentiment = payload.sentiment || null;
  const label = sentiment && sentiment.label ? sentiment.label : "UNKNOWN";
  const tone = toneFromLabel(label);
  const score = sentiment && typeof sentiment.score === "number" ? sentiment.score : null;
  const transcript = typeof payload.transcript === "string" ? payload.transcript : "";
  const note = payload.error || "";
  const fileName = payload.fileName || "Audio clip";

  const article = document.createElement("article");
  article.className = "result-card";
  article.dataset.tone = tone;
  article.tabIndex = -1;

  const header = document.createElement("div");
  header.className = "result-card__header";

  const title = document.createElement("h3");
  title.className = "result-card__title";
  title.textContent = tone === "unknown" ? "No sentiment detected" : tone.toUpperCase();
  header.appendChild(title);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.tone = tone;
  badge.textContent = score != null ? `${label.toUpperCase()} | ${score.toFixed(2)}` : label.toUpperCase();
  header.appendChild(badge);

  article.appendChild(header);

  const meta = document.createElement("p");
  meta.className = "result-card__meta";
  const now = new Date();
  meta.textContent = `${fileName} | ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  article.appendChild(meta);

  const transcriptBlock = document.createElement("p");
  transcriptBlock.className = "result-card__transcript";
  transcriptBlock.textContent = transcript || "No speech detected.";
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
    } catch (err) {
      console.warn("Result focus failed", err);
    }
    article.addEventListener("blur", () => {
      article.removeAttribute("tabindex");
    }, { once: true });
  });

  return article;
}

async function ensurePipelines() {
  if (!state.pipelinesPromise) {
    state.pipelinesPromise = (async () => {
      setStatus("Loading speech model (first run may take a minute)...", "working");
      const speech = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
        quantized: true,
      });
      setStatus("Loading sentiment model...", "working");
      const sentiment = await pipeline("text-classification", "Xenova/distilbert-base-uncased-finetuned-sst-2-english", {
        quantized: true,
      });
      setStatus("Models ready. Select an audio file.");
      return { speech, sentiment };
    })().catch((error) => {
      state.pipelinesPromise = null;
      throw error;
    });
  }
  return state.pipelinesPromise;
}

async function transcribeAudio(audioBuffer) {
  const monoData = mixToMono(audioBuffer);
  const resampled = resample(monoData, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
  const { speech } = await ensurePipelines();
  const result = await speech({
    array: resampled,
    sampling_rate: TARGET_SAMPLE_RATE,
  }, {
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const text = typeof result.text === "string" ? result.text.trim() : "";
  return text;
}

async function scoreSentiment(transcript) {
  if (!transcript) {
    return null;
  }
  const { sentiment } = await ensurePipelines();
  const outputs = await sentiment(transcript, { topk: 1 });
  const best = Array.isArray(outputs) && outputs.length > 0 ? outputs[0] : outputs;
  if (!best || typeof best !== "object") {
    return null;
  }
  const normalizedLabel = (() => {
    const raw = typeof best.label === "string" ? best.label : "";
    if (raw === "LABEL_0") {
      return "NEGATIVE";
    }
    if (raw === "LABEL_1") {
      return "POSITIVE";
    }
    return raw.toUpperCase();
  })();
  const score = typeof best.score === "number" ? best.score : null;
  return score == null ? { label: normalizedLabel } : { label: normalizedLabel, score };
}

async function analyzeFile(file) {
  if (!file) {
    throw new Error("Select an audio file to begin.");
  }

  const audioBuffer = state.audioBuffer || await decodeFile(file);
  const duration = audioBuffer.duration;
  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
    throw new Error("Clip is too long. Trim to under ninety seconds.");
  }

  const transcript = await transcribeAudio(audioBuffer);
  if (!transcript) {
    return {
      transcript: "",
      sentiment: null,
      error: "Could not detect speech in this clip.",
      fileName: file.name,
    };
  }

  const sentiment = await scoreSentiment(transcript);
  return {
    transcript,
    sentiment,
    fileName: file.name,
  };
}

async function handleFileChange(event) {
  const files = event.target && event.target.files ? event.target.files : null;
  if (!files || files.length === 0) {
    state.audioBuffer = null;
    state.audioFile = null;
    clearWaveform();
    setStatus(DEFAULT_STATUS);
    return;
  }

  const file = files[0];
  state.audioFile = file;
  setStatus("Decoding audio...", "working");

  try {
    const decoded = await decodeFile(file);
    state.audioBuffer = decoded;
    if (waveformContainer) {
      waveformContainer.hidden = false;
    }
    if (waveformEmpty) {
      waveformEmpty.hidden = true;
    }
    drawWaveform(decoded);
    if (waveformMeta) {
      const duration = decoded.duration;
      const durationLabel = Number.isFinite(duration) ? `${duration.toFixed(2)}s` : "Unknown duration";
      const sampleRate = decoded.sampleRate ? `${decoded.sampleRate.toLocaleString()} Hz` : "Unknown sample rate";
      const sizeKb = file.size ? `${(file.size / 1024).toFixed(1)} KB` : "";
      const metaParts = [durationLabel, sampleRate, sizeKb].filter(Boolean);
      waveformMeta.textContent = metaParts.join(" · ");
    }
    setStatus("Ready. Click Analyze audio to continue.");
  } catch (error) {
    console.error("Waveform decoding failed", error);
    state.audioBuffer = null;
    clearWaveform("Could not decode waveform for this file.");
    setStatus(error instanceof Error ? error.message : "Could not decode file.", "error");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    setStatus("Select an audio file to begin.", "error");
    if (fileInput) {
      fileInput.focus();
    }
    return;
  }

  const audioFile = fileInput.files[0];
  toggleLoading(true);
  setStatus("Analyzing audio...", "working");

  try {
    const result = await analyzeFile(audioFile);
    if (resultsEl) {
      const card = buildResultCard(result);
      resultsEl.prepend(card);
    }
    ensureEmptyState();

    if (result.error && !result.sentiment) {
      setStatus(result.error, "warn");
    } else {
      setStatus("Analysis complete.");
    }
  } catch (error) {
    console.error("Analysis failed", error);
    const message = error instanceof Error ? error.message : "Analysis failed.";
    setStatus(message, "error");
  } finally {
    toggleLoading(false);
  }
}

function resetInputs() {
  if (fileInput) {
    fileInput.value = "";
  }
  state.audioBuffer = null;
  state.audioFile = null;
  clearWaveform();
  setStatus(DEFAULT_STATUS);
}

if (form && fileInput) {
  setStatus(DEFAULT_STATUS);
  form.addEventListener("submit", handleSubmit);
  fileInput.addEventListener("change", handleFileChange);
}

if (waveformClearButton) {
  waveformClearButton.addEventListener("click", resetInputs);
}

clearWaveform();
ensureEmptyState();
