import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.8.0/dist/transformers.min.js";

const TARGET_SAMPLE_RATE = 16000;
const MAX_DURATION_SECONDS = 90;
const DEFAULT_STATUS = "Models load on first run.";
const defaultWaveformMessage = "Waveform preview appears after selecting an audio file.";
const defaultLiveTranscript = "Transcript snippets appear here as you speak.";
const LIVE_ANALYSIS_INTERVAL_SECONDS = 3;
const LIVE_ANALYSIS_WINDOW_SECONDS = 8;
const LIVE_ANALYSIS_OVERLAP_SECONDS = 1;

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
const recordStartButton = document.querySelector('[data-record-start]');
const recordStopButton = document.querySelector('[data-record-stop]');
const recordStatusEl = document.querySelector('[data-record-status]');
const recordAnalyzeButton = document.querySelector('[data-record-analyze]');
const liveCard = document.querySelector('[data-live-card]');
const liveStatusEl = document.querySelector('[data-live-status]');
const liveSentimentEl = document.querySelector('[data-live-sentiment]');
const liveTranscriptEl = document.querySelector('[data-live-transcript]');
const liveMeterNeedle = document.querySelector('[data-live-meter-needle]');

const state = {
  audioBuffer: null,
  audioFile: null,
  pipelinesPromise: null,
  audioContext: null,
  audioSourceLabel: null,
  audioSourceType: null,
  isRecording: false,
  recordingChunks: [],
  recordingStream: null,
  recordingProcessor: null,
  recordingAnalyser: null,
  recordingAnimationFrame: null,
  recordingSource: null,
  recordingOutput: null,
  recordingSampleRate: null,
  recordingSampleCount: 0,
  liveAnalysis: null,
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

function clearWaveform(message, options = {}) {
  const keepContainer = Boolean(options.keepContainer);
  if (waveformCanvas) {
    const context = waveformCanvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
  }
  if (waveformContainer) {
    waveformContainer.hidden = !keepContainer;
  }
  if (waveformMeta) {
    waveformMeta.textContent = keepContainer && message ? message : "";
  }
  if (waveformEmpty) {
    waveformEmpty.hidden = keepContainer;
    if (!keepContainer) {
      waveformEmpty.textContent = message || defaultWaveformMessage;
    }
  }
}

function setLiveStatus(message, tone) {
  if (!liveStatusEl) {
    return;
  }
  liveStatusEl.textContent = message;
  liveStatusEl.dataset.state = tone || "idle";
}

function resetLiveCard() {
  if (liveCard) {
    liveCard.hidden = true;
  }
  setLiveStatus("Waiting for audio…");
  if (liveSentimentEl) {
    liveSentimentEl.textContent = "—";
    liveSentimentEl.dataset.tone = "unknown";
  }
  if (liveTranscriptEl) {
    liveTranscriptEl.textContent = defaultLiveTranscript;
  }
  if (liveMeterNeedle) {
    liveMeterNeedle.style.left = "50%";
    liveMeterNeedle.dataset.tone = "neutral";
  }
}

function showLiveCard() {
  if (liveCard && liveCard.hidden) {
    liveCard.hidden = false;
  }
}

function updateLiveMeter(value, tone) {
  if (!liveMeterNeedle) {
    return;
  }
  const clamped = Math.max(-1, Math.min(1, value));
  const percent = (clamped + 1) * 50;
  liveMeterNeedle.style.left = `${percent}%`;
  liveMeterNeedle.dataset.tone = tone || "neutral";
}

function updateLiveStreamUI(payload) {
  showLiveCard();
  const sentiment = payload.sentiment || null;
  const tone = toneFromLabel(sentiment ? sentiment.label : null);
  const score = sentiment && typeof sentiment.score === "number" ? sentiment.score : null;

  if (liveSentimentEl) {
    const label = sentiment && sentiment.label ? sentiment.label.toUpperCase() : "UNKNOWN";
    liveSentimentEl.textContent = score != null ? `${label} ${score.toFixed(2)}` : label;
    liveSentimentEl.dataset.tone = tone;
  }

  if (liveTranscriptEl) {
    liveTranscriptEl.textContent = payload.transcript || defaultLiveTranscript;
  }

  const gaugeValue = (() => {
    if (!sentiment || score == null) {
      return 0;
    }
    if (tone === "positive") {
      return score;
    }
    if (tone === "negative") {
      return -score;
    }
    return 0;
  })();
  updateLiveMeter(gaugeValue, tone);

  const now = new Date();
  setLiveStatus(`Updated ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`, "active");
}

function diffTranscript(previous, next) {
  if (!previous) {
    return next;
  }
  if (!next) {
    return "";
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length).trim();
  }
  return next;
}

function extractSamplesFromChunks(startSample, endSample) {
  const chunks = state.recordingChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return null;
  }
  const span = Math.max(0, endSample - startSample);
  if (span === 0) {
    return null;
  }
  const output = new Float32Array(span);
  let writeIndex = 0;
  let position = 0;
  for (const chunk of chunks) {
    const nextPosition = position + chunk.length;
    if (nextPosition <= startSample) {
      position = nextPosition;
      continue;
    }
    const chunkStart = Math.max(0, startSample - position);
    const chunkEnd = Math.min(chunk.length, endSample - position);
    if (chunkStart < chunkEnd) {
      const slice = chunk.subarray(chunkStart, chunkEnd);
      output.set(slice, writeIndex);
      writeIndex += slice.length;
    }
    if (writeIndex >= span) {
      break;
    }
    position = nextPosition;
  }
  if (writeIndex === 0) {
    return null;
  }
  return writeIndex === span ? output : output.subarray(0, writeIndex);
}

async function runLiveAnalysis(startSample, endSample) {
  const live = state.liveAnalysis;
  if (!live || !live.active) {
    return false;
  }
  const samples = extractSamplesFromChunks(startSample, endSample);
  if (!samples || samples.length === 0) {
    return false;
  }

  const sampleRate = live.sampleRate || state.recordingSampleRate || TARGET_SAMPLE_RATE;
  const resampled = resample(samples, sampleRate, TARGET_SAMPLE_RATE);
  const { speech } = await ensurePipelines();
  const transcription = await speech({
    array: resampled,
    sampling_rate: TARGET_SAMPLE_RATE,
  }, {
    chunk_length_s: 15,
    stride_length_s: 3,
  });

  const rawText = typeof transcription.text === "string" ? transcription.text.trim() : "";
  if (!rawText) {
    return false;
  }

  const normalizedText = rawText.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return false;
  }

  const liveState = state.liveAnalysis;
  if (!liveState || !liveState.active) {
    return false;
  }

  const addition = diffTranscript(liveState.lastTranscript || "", normalizedText);
  if (addition) {
    liveState.transcriptBuffer.push(addition);
    if (liveState.transcriptBuffer.length > 8) {
      liveState.transcriptBuffer = liveState.transcriptBuffer.slice(-8);
    }
  }
  liveState.lastTranscript = normalizedText;

  const displayTranscript = liveState.transcriptBuffer.join(" ").replace(/\s+/g, " ").trim() || normalizedText;
  const sentimentInput = addition || normalizedText;
  const sentiment = await scoreSentiment(sentimentInput);
  updateLiveStreamUI({ transcript: displayTranscript, sentiment });
  return true;
}

function queueLiveAnalysis() {
  const live = state.liveAnalysis;
  if (!live || !live.active) {
    return;
  }

  const availableSamples = state.recordingSampleCount - live.lastProcessedSamples;
  if (availableSamples < live.sampleRate * LIVE_ANALYSIS_INTERVAL_SECONDS) {
    return;
  }

  if (live.pendingPromise) {
    return;
  }

  const endSample = state.recordingSampleCount;
  const windowSamples = Math.floor(live.sampleRate * LIVE_ANALYSIS_WINDOW_SECONDS);
  const startSample = Math.max(0, endSample - windowSamples);
  const capturedEndSample = endSample;

  live.pendingPromise = runLiveAnalysis(startSample, endSample)
    .catch((error) => {
      console.error("Live analysis failed", error);
      setLiveStatus("Live analysis paused. See console for details.", "error");
    })
    .finally(() => {
      const liveState = state.liveAnalysis;
      if (!liveState) {
        return;
      }
      liveState.pendingPromise = null;
      const overlapSamples = Math.floor(liveState.sampleRate * LIVE_ANALYSIS_OVERLAP_SECONDS);
      liveState.lastProcessedSamples = Math.max(0, capturedEndSample - overlapSamples);
    });
}

function setRecordingStatus(message, tone) {
  if (!recordStatusEl) {
    return;
  }
  recordStatusEl.textContent = message;
  recordStatusEl.dataset.state = tone || "idle";
}

function cancelRecordingAnimation() {
  if (state.recordingAnimationFrame) {
    cancelAnimationFrame(state.recordingAnimationFrame);
    state.recordingAnimationFrame = null;
  }
}

function teardownRecordingNodes() {
  cancelRecordingAnimation();
  if (state.recordingProcessor) {
    state.recordingProcessor.disconnect();
    state.recordingProcessor.onaudioprocess = null;
    state.recordingProcessor = null;
  }
  if (state.recordingAnalyser) {
    state.recordingAnalyser.disconnect();
    state.recordingAnalyser = null;
  }
  if (state.recordingOutput) {
    state.recordingOutput.disconnect();
    state.recordingOutput = null;
  }
  if (state.recordingSource) {
    try {
      state.recordingSource.disconnect();
    } catch (error) {
      console.warn("Recording source disconnect failed", error);
    }
    state.recordingSource = null;
  }
  if (state.recordingStream) {
    state.recordingStream.getTracks().forEach((track) => track.stop());
    state.recordingStream = null;
  }
}

function createAudioBufferFromChunks(chunks, context) {
  if (!Array.isArray(chunks) || chunks.length === 0 || !context) {
    return null;
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!Number.isFinite(totalLength) || totalLength === 0) {
    return null;
  }
  const buffer = context.createBuffer(1, totalLength, context.sampleRate);
  const channelData = buffer.getChannelData(0);
  let offset = 0;
  for (const chunk of chunks) {
    channelData.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

function drawLiveWaveform() {
  if (!waveformCanvas || !state.recordingAnalyser) {
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

  const analyser = state.recordingAnalyser;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  context.save();
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.lineWidth = 1.2;
  context.strokeStyle = "rgba(37, 99, 235, 0.9)";
  context.beginPath();

  for (let i = 0; i < bufferLength; i += 1) {
    const x = (i / bufferLength) * width;
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
  context.restore();

  state.recordingAnimationFrame = requestAnimationFrame(drawLiveWaveform);
}

async function startRecording() {
  if (state.isRecording) {
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Microphone capture is not supported in this browser.", "error");
    setRecordingStatus("Microphone capture is not supported in this browser.", "error");
    return;
  }

  const context = getAudioContext();
  if (!context) {
    setStatus("Web Audio API not available in this browser.", "error");
    setRecordingStatus("Web Audio API not available in this browser.", "error");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    if (context.state === "suspended") {
      await context.resume();
    }

    state.recordingStream = stream;
    state.recordingChunks = [];
    state.recordingSampleRate = context.sampleRate;
    state.recordingSampleCount = 0;
    state.liveAnalysis = {
      active: true,
      pendingPromise: null,
      sampleRate: context.sampleRate,
      lastProcessedSamples: 0,
      lastTranscript: "",
      transcriptBuffer: [],
    };
    const source = context.createMediaStreamSource(stream);
    state.recordingSource = source;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;

    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!state.isRecording) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const chunkCopy = new Float32Array(input);
      state.recordingChunks.push(chunkCopy);
      state.recordingSampleCount += chunkCopy.length;
      queueLiveAnalysis();
    };

    source.connect(analyser);
    analyser.connect(processor);
    const output = context.createGain();
    output.gain.value = 0;
    processor.connect(output);
    output.connect(context.destination);

    state.recordingAnalyser = analyser;
    state.recordingProcessor = processor;
    state.recordingOutput = output;
    state.isRecording = true;
    state.audioBuffer = null;
    state.audioFile = null;
    state.audioSourceLabel = "Live recording";
    state.audioSourceType = "recording";

    if (liveSentimentEl) {
      liveSentimentEl.textContent = "—";
      liveSentimentEl.dataset.tone = "unknown";
    }
    if (liveTranscriptEl) {
      liveTranscriptEl.textContent = defaultLiveTranscript;
    }
    if (liveMeterNeedle) {
      liveMeterNeedle.style.left = "50%";
      liveMeterNeedle.dataset.tone = "neutral";
    }
    showLiveCard();
    setLiveStatus("Listening…", "listening");

    if (recordStartButton) {
      recordStartButton.disabled = true;
    }
    if (recordStopButton) {
      recordStopButton.disabled = false;
    }
    if (recordAnalyzeButton) {
      recordAnalyzeButton.disabled = true;
    }

    clearWaveform("Recording in progress…", { keepContainer: true });

    if (fileInput) {
      fileInput.value = "";
    }

    setStatus("Recording… Speak clearly near your microphone.", "working");
    setRecordingStatus("Recording… speak clearly near your microphone.", "recording");

    cancelRecordingAnimation();
    state.recordingAnimationFrame = requestAnimationFrame(drawLiveWaveform);
  } catch (error) {
    console.error("Recording start failed", error);
    teardownRecordingNodes();
    state.isRecording = false;
    state.recordingChunks = [];
    const message = error instanceof DOMException ? error.message : "Microphone access was denied.";
    setStatus(message, "error");
    setRecordingStatus(message, "error");
    if (recordStartButton) {
      recordStartButton.disabled = false;
    }
    if (recordStopButton) {
      recordStopButton.disabled = true;
    }
  }
}

async function stopRecording(options = {}) {
  const finalize = options.finalize !== false;
  if (!state.isRecording && finalize && !state.recordingStream) {
    return;
  }

  state.isRecording = false;
  if (state.liveAnalysis) {
    state.liveAnalysis.active = false;
  }
  teardownRecordingNodes();

  if (!finalize) {
    state.recordingChunks = [];
    state.recordingSampleCount = 0;
    state.recordingSampleRate = null;
    state.liveAnalysis = null;
    resetLiveCard();
    setRecordingStatus("Recording cancelled.");
    setStatus(DEFAULT_STATUS);
    if (recordStartButton) {
      recordStartButton.disabled = false;
    }
    if (recordStopButton) {
      recordStopButton.disabled = true;
    }
    if (recordAnalyzeButton) {
      recordAnalyzeButton.disabled = true;
    }
    return;
  }

  const context = getAudioContext();
  const chunks = state.recordingChunks;
  state.recordingChunks = [];
  state.recordingSampleCount = 0;
  state.recordingSampleRate = null;

  if (!context || !chunks || chunks.length === 0) {
    setRecordingStatus("No audio captured. Try recording again.", "error");
    setStatus("No audio captured. Try recording again.", "error");
    if (recordStartButton) {
      recordStartButton.disabled = false;
    }
    if (recordStopButton) {
      recordStopButton.disabled = true;
    }
    return;
  }

  const audioBuffer = createAudioBufferFromChunks(chunks, context);
  if (!audioBuffer) {
    setRecordingStatus("Could not assemble recording. Try again.", "error");
    setStatus("Could not assemble recording. Try again.", "error");
    if (recordStartButton) {
      recordStartButton.disabled = false;
    }
    if (recordStopButton) {
      recordStopButton.disabled = true;
    }
    return;
  }

  state.audioBuffer = audioBuffer;
  state.audioFile = null;
  state.audioSourceLabel = "Live recording";
  state.audioSourceType = "recording";

  drawWaveform(audioBuffer);
  if (waveformContainer) {
    waveformContainer.hidden = false;
  }
  if (waveformEmpty) {
    waveformEmpty.hidden = true;
  }
  if (waveformMeta) {
    const duration = audioBuffer.duration;
    const durationLabel = Number.isFinite(duration) ? `${duration.toFixed(2)}s` : "Unknown duration";
    const sampleRateLabel = `${audioBuffer.sampleRate.toLocaleString()} Hz`;
    waveformMeta.textContent = `${durationLabel} · ${sampleRateLabel}`;
  }

  setStatus("Recording complete. Analyze when ready.");
  setRecordingStatus("Recording complete. Analyze when ready.", "ready");
  setLiveStatus("Live stream paused. Recording stopped.", "idle");

  if (recordStartButton) {
    recordStartButton.disabled = false;
  }
  if (recordStopButton) {
    recordStopButton.disabled = true;
  }
  if (recordAnalyzeButton) {
    recordAnalyzeButton.disabled = false;
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
      setStatus("Models ready. Select a file or start streaming.");
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

async function analyzeAudioInput({ file, audioBuffer, sourceLabel }) {
  let buffer = audioBuffer;
  if (!buffer && file) {
    buffer = await decodeFile(file);
  }
  if (!buffer) {
    throw new Error("Select an audio file or record a clip to begin.");
  }

  if (!state.audioBuffer) {
    state.audioBuffer = buffer;
  }

  const duration = buffer.duration;
  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
    throw new Error("Clip is too long. Trim to under ninety seconds.");
  }

  const transcript = await transcribeAudio(buffer);
  const fileName = sourceLabel || (file ? file.name : "Audio clip");

  if (!transcript) {
    return {
      transcript: "",
      sentiment: null,
      error: "Could not detect speech in this clip.",
      fileName,
    };
  }

  const sentiment = await scoreSentiment(transcript);
  return {
    transcript,
    sentiment,
    fileName,
  };
}

async function handleFileChange(event) {
  const files = event.target && event.target.files ? event.target.files : null;
  if (!files || files.length === 0) {
    state.audioBuffer = null;
    state.audioFile = null;
    state.audioSourceLabel = null;
    state.audioSourceType = null;
    state.liveAnalysis = null;
    clearWaveform();
    resetLiveCard();
    setStatus(DEFAULT_STATUS);
    if (recordAnalyzeButton) {
      recordAnalyzeButton.disabled = true;
    }
    return;
  }

  const file = files[0];
  state.audioFile = file;
  state.audioSourceLabel = file.name;
  state.audioSourceType = "file";
  state.liveAnalysis = null;
  if (state.isRecording || state.recordingStream) {
    await stopRecording({ finalize: false });
  }
  resetLiveCard();
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
    setRecordingStatus("Audio file loaded. Ready to analyze.", "ready");
    if (recordAnalyzeButton) {
      recordAnalyzeButton.disabled = true;
    }
  } catch (error) {
    console.error("Waveform decoding failed", error);
    state.audioBuffer = null;
    clearWaveform("Could not decode waveform for this file.");
    setStatus(error instanceof Error ? error.message : "Could not decode file.", "error");
    setRecordingStatus("Could not decode this file. Try another clip.", "error");
    if (recordAnalyzeButton) {
      recordAnalyzeButton.disabled = true;
    }
  }
}

async function performAnalysis(options = {}) {
  const invokedByRecording = Boolean(options.invokedByRecording);
  const file = fileInput && fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : null;
  if (!file && !state.audioBuffer) {
    setStatus("Select an audio file or record a clip to begin.", "error");
    if (!invokedByRecording && fileInput) {
      fileInput.focus();
    }
    return;
  }

  toggleLoading(true);
  if (invokedByRecording && recordAnalyzeButton) {
    recordAnalyzeButton.disabled = true;
  }
  setStatus("Analyzing audio...", "working");

  try {
    const result = await analyzeAudioInput({
      file,
      audioBuffer: state.audioBuffer,
      sourceLabel: state.audioSourceLabel || (file ? file.name : null),
    });
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
    if (invokedByRecording && recordAnalyzeButton) {
      recordAnalyzeButton.disabled = !state.audioBuffer;
    }
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  await performAnalysis();
}

function resetInputs() {
  if (state.isRecording || state.recordingStream) {
    stopRecording({ finalize: false }).catch((error) => {
      console.error("Recording reset failed", error);
    });
  }
  if (fileInput) {
    fileInput.value = "";
  }
  state.audioBuffer = null;
  state.audioFile = null;
  state.audioSourceLabel = null;
  state.audioSourceType = null;
  state.liveAnalysis = null;
  clearWaveform();
  setStatus(DEFAULT_STATUS);
  if (recordAnalyzeButton) {
    recordAnalyzeButton.disabled = true;
  }
  setRecordingStatus("Idle. Microphone access stays local to this tab.");
  resetLiveCard();
}

if (form && fileInput) {
  setStatus(DEFAULT_STATUS);
  form.addEventListener("submit", handleSubmit);
  fileInput.addEventListener("change", handleFileChange);
}

if (waveformClearButton) {
  waveformClearButton.addEventListener("click", resetInputs);
}

if (recordStartButton) {
  recordStartButton.addEventListener("click", () => {
    startRecording().catch((error) => {
      console.error("Start recording handler failed", error);
    });
  });
}

if (recordStopButton) {
  recordStopButton.addEventListener("click", () => {
    stopRecording().catch((error) => {
      console.error("Stop recording handler failed", error);
    });
  });
}

if (recordAnalyzeButton) {
  recordAnalyzeButton.addEventListener("click", (event) => {
    event.preventDefault();
    performAnalysis({ invokedByRecording: true }).catch((error) => {
      console.error("Recording analysis handler failed", error);
    });
  });
}

setRecordingStatus("Idle. Microphone access stays local to this tab.");
clearWaveform();
ensureEmptyState();
resetLiveCard();
