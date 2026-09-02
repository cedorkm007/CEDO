/**
 * On-device offline speech recognition via Whisper (whisperWorker.ts),
 * replacing the browser's built-in SpeechRecognition (speechRecognition.ts)
 * for both Speech to Text and Speech to Sign Language. The built-in API
 * isn't actually on-device — Chrome streams the audio to Google's cloud
 * service for transcription, with no offline mode at all — so it can
 * never work without a connection no matter what this app does.
 *
 * The interaction model is necessarily different from the old
 * continuous/interim-results API: Whisper has no incremental "word as you
 * say it" output. Instead, this captures the mic continuously, uses a
 * simple energy-based voice-activity detector to notice when a person
 * pauses, and sends each pause-delimited utterance to the model —
 * "a chunk of text appears every time you pause" rather than live
 * word-by-word captions. onListening() below reports whether audio is
 * actively being captured, not whether a chunk is mid-transcription.
 *
 * The mic itself, the audio graph, and the model (once downloaded and
 * cached — see whisperWorker.ts) all work fully offline. Only the very
 * first use, on a device with no cached model yet, needs a connection.
 */

const SAMPLE_RATE = 16000;
// ScriptProcessorNode over the modern AudioWorklet: it's deprecated but
// still broadly supported (including current Android Chrome), and needs
// no separate module file to load — a meaningful simplification here,
// since the actual heavy lifting (inference) already happens off-thread
// in the worker, so a main-thread callback doing cheap buffer copies is
// in no danger of audio glitches.
const BUFFER_SIZE = 4096;
const SILENCE_RMS_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 700;
const MAX_CHUNK_DURATION_MS = 15000;
const MIN_CHUNK_DURATION_MS = 300;

export interface WhisperCallbacks {
  onFinalText: (text: string) => void;
  /** Fires only while the model is actually downloading — never fires at all if it was already cached. */
  onModelLoading?: (fraction: number) => void;
  onModelReady?: () => void;
  onListening?: (listening: boolean) => void;
  onError: (message: string) => void;
}

export interface WhisperRecognizer {
  start(callbacks: WhisperCallbacks): void;
  stop(): void;
  /** Releases the worker and mic entirely — call on unmount, not on every stop(). */
  destroy(): void;
}

export function isWhisperRecognitionSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
}

// Whisper expects mono 16kHz PCM. Forcing `new AudioContext({sampleRate:
// 16000})` and trusting the browser to resample the mic capture down to
// that rate looked reasonable, but was never actually verified against
// real speech (an earlier check only fed a synthetic buffer straight into
// the worker, bypassing this entirely) — and requesting a non-native rate
// for a *capture* context is a known source of inconsistent behavior
// across Android Chrome/WebView versions. If it silently doesn't
// resample, the model receives distorted audio, which looks exactly like
// garbled transcription. Fixed by letting the context run at whatever its
// real native rate is and resampling explicitly, in code we can verify,
// rather than trusting that to happen implicitly.
function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === SAMPLE_RATE) return input;
  const ratio = inputSampleRate / SAMPLE_RATE;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
    const frac = srcIndex - srcIndexFloor;
    output[i] = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
  }
  return output;
}

export function createWhisperRecognizer(): WhisperRecognizer {
  let worker: Worker | null = null;
  let modelReady = false;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let running = false;
  let nextChunkId = 0;

  let chunkBuffers: Float32Array[] = [];
  let chunkSampleCount = 0;
  let hasSpeech = false;
  let silenceMs = 0;

  function getWorker(): Worker {
    if (!worker) {
      worker = new Worker(new URL("./whisperWorker.ts", import.meta.url), { type: "module" });
    }
    return worker;
  }

  function resetChunk() {
    chunkBuffers = [];
    chunkSampleCount = 0;
    hasSpeech = false;
    silenceMs = 0;
  }

  function finalizeChunk() {
    const nativeRate = audioContext?.sampleRate ?? SAMPLE_RATE;
    const durationMs = (chunkSampleCount / nativeRate) * 1000;
    if (!hasSpeech || durationMs < MIN_CHUNK_DURATION_MS) {
      resetChunk();
      return;
    }
    const raw = new Float32Array(chunkSampleCount);
    let offset = 0;
    for (const buf of chunkBuffers) {
      raw.set(buf, offset);
      offset += buf.length;
    }
    resetChunk();

    const audio = resampleTo16k(raw, nativeRate);
    const id = nextChunkId++;
    getWorker().postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  }

  function start(callbacks: WhisperCallbacks) {
    if (running) return;
    running = true;
    resetChunk();

    const w = getWorker();
    w.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; fraction?: number; message?: string; id?: number; text?: string };
      switch (data.type) {
        case "model-progress":
          callbacks.onModelLoading?.(data.fraction ?? 0);
          break;
        case "model-ready":
          modelReady = true;
          callbacks.onModelReady?.();
          break;
        case "model-error":
          running = false;
          callbacks.onError(
            data.message?.includes("fetch") || data.message?.includes("network")
              ? "This needs an internet connection the first time, to download the offline speech model (~300MB). After that, it works offline."
              : `Couldn't load the speech model: ${data.message}`
          );
          break;
        case "transcription":
          if (data.text) callbacks.onFinalText(data.text);
          break;
        case "transcription-error":
          callbacks.onError(`Speech recognition error: ${data.message}`);
          break;
      }
    };

    if (!modelReady) w.postMessage({ type: "load" });

    (async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        running = false;
        callbacks.onError("Microphone access was denied — allow it in your browser to use this tool.");
        return;
      }
      if (!running) {
        mediaStream.getTracks().forEach(t => t.stop());
        return;
      }

      // Deliberately not forcing `{ sampleRate: SAMPLE_RATE }` here — see
      // the comment on resampleTo16k above. Whatever native rate this
      // resolves to (typically 48000 on Android), the VAD math below
      // tracks it explicitly rather than assuming it's 16kHz.
      audioContext = new AudioContext();
      const nativeRate = audioContext.sampleRate;
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      processor.onaudioprocess = event => {
        const input = event.inputBuffer.getChannelData(0);
        let sumSquares = 0;
        for (let i = 0; i < input.length; i++) sumSquares += input[i] * input[i];
        const rms = Math.sqrt(sumSquares / input.length);

        chunkBuffers.push(input.slice());
        chunkSampleCount += input.length;

        const chunkDurationMs = (chunkSampleCount / nativeRate) * 1000;
        if (rms > SILENCE_RMS_THRESHOLD) {
          hasSpeech = true;
          silenceMs = 0;
        } else {
          silenceMs += (input.length / nativeRate) * 1000;
        }

        if ((hasSpeech && silenceMs >= SILENCE_DURATION_MS) || chunkDurationMs >= MAX_CHUNK_DURATION_MS) {
          finalizeChunk();
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      callbacks.onListening?.(true);
    })();
  }

  function teardownAudio() {
    processor?.disconnect();
    processor = null;
    audioContext?.close();
    audioContext = null;
    mediaStream?.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }

  function stop() {
    if (!running) return;
    running = false;
    teardownAudio();
    resetChunk();
  }

  function destroy() {
    stop();
    worker?.terminate();
    worker = null;
    modelReady = false;
  }

  return { start, stop, destroy };
}
