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
    const durationMs = (chunkSampleCount / SAMPLE_RATE) * 1000;
    if (!hasSpeech || durationMs < MIN_CHUNK_DURATION_MS) {
      resetChunk();
      return;
    }
    const audio = new Float32Array(chunkSampleCount);
    let offset = 0;
    for (const buf of chunkBuffers) {
      audio.set(buf, offset);
      offset += buf.length;
    }
    resetChunk();

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
              ? "This needs an internet connection the first time, to download the offline speech model (~40MB). After that, it works offline."
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

      audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
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

        const chunkDurationMs = (chunkSampleCount / SAMPLE_RATE) * 1000;
        if (rms > SILENCE_RMS_THRESHOLD) {
          hasSpeech = true;
          silenceMs = 0;
        } else {
          silenceMs += (input.length / SAMPLE_RATE) * 1000;
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
