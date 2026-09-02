import { createModel, type Model, type KaldiRecognizer } from "vosk-browser";

/**
 * On-device offline speech recognition via Vosk, replacing the earlier
 * Whisper-based engine (see docs/kauban/PROGRESS.md) — Whisper has no
 * incremental output at all, only "transcribe this finished chunk of
 * audio", so the best it could offer was text appearing in bursts
 * whenever a pause was detected. Vosk is built for real streaming
 * recognition: it reports a continuously-updating partial guess *while*
 * someone is still talking, then a final result once they pause — the
 * same "watch it appear as you speak" feel as the browser's own
 * (cloud-only) speech recognition. The tradeoff is accuracy: Vosk's small
 * model is noticeably less accurate per word than Whisper's.
 *
 * The model (public/kauban-vosk-model/, downloaded by
 * scripts/download-vosk-model.mjs) is a module-level singleton shared by
 * every recognizer instance — loading it is expensive, so it's kept warm
 * across page visits within the same session rather than reloaded per
 * page. `vosk-browser` manages its own internal Web Worker; there's no
 * separate worker file to write here, unlike the Whisper setup.
 *
 * Import this module only via a dynamic import() inside an event handler,
 * never as a top-level import — see voskSupport.ts for why.
 */

const MODEL_URL = "/kauban-vosk-model/model.tar.gz";
const BUFFER_SIZE = 4096;
const SAMPLE_RATE = 16000;

// Vosk's Kaldi model was trained on and expects exactly 16kHz audio.
// acceptWaveformFloat(buffer, sampleRate) looked like it might do that
// conversion itself given the sampleRate argument, but checking the
// actual library source shows it only rescales amplitude from [-1,1] to
// Kaldi's int16 range — it does not resample. Passing 48kHz audio (the
// typical native mic rate on Android) straight through, even correctly
// labeled with its real rate, produced exactly what got reported:
// present but wrong/garbled text — a mismatched sample rate is heard by
// the model as completely different frequency content, not silence or
// an error. This is the same class of bug already found and fixed once
// for the earlier Whisper-based engine, and the fix is the same:
// resample explicitly in code that's actually verified, rather than
// trust an assumption about what a library does internally.
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

export interface VoskCallbacks {
  onPartialText: (text: string) => void;
  onFinalText: (text: string) => void;
  /** Fires only while the model is actually loading — never fires at all once it's warm from an earlier page visit. */
  onModelLoading?: (loading: boolean) => void;
  onListening?: (listening: boolean) => void;
  onError: (message: string) => void;
}

export interface VoskRecognizer {
  start(callbacks: VoskCallbacks): void;
  /**
   * Resolves once any speech still pending at the moment of the call has
   * been flushed through onFinalText — callers that accumulate the full
   * utterance across the session (rather than acting on each chunk as it
   * arrives) should await this before reading that accumulator, or the
   * last few words spoken right before pressing Stop go missing.
   */
  stop(): Promise<void>;
  /** Tears down this recognizer's mic + audio graph. Safe to call on unmount — the shared model itself stays loaded for next time. */
  destroy(): void;
}

let modelPromise: Promise<Model> | null = null;

function getModel(): Promise<Model> {
  if (!modelPromise) {
    modelPromise = createModel(MODEL_URL);
  }
  return modelPromise;
}

export function createVoskRecognizer(): VoskRecognizer {
  let recognizer: KaldiRecognizer | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let running = false;

  async function start(callbacks: VoskCallbacks) {
    if (running) return;
    running = true;

    let model: Model;
    try {
      const alreadyLoading = modelPromise !== null;
      if (!alreadyLoading) callbacks.onModelLoading?.(true);
      model = await getModel();
      if (!alreadyLoading) callbacks.onModelLoading?.(false);
    } catch (err) {
      running = false;
      callbacks.onModelLoading?.(false);
      const message = err instanceof Error ? err.message : String(err);
      callbacks.onError(
        /fetch|network|failed to load/i.test(message)
          ? "This needs an internet connection the first time, to download the offline speech model (~40MB). After that, it works offline."
          : `Couldn't load the speech model: ${message}`
      );
      return;
    }
    if (!running) return;

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

    audioContext = new AudioContext();
    await audioContext.resume();
    const nativeRate = audioContext.sampleRate;

    // Always 16000 here — see resampleTo16k above. Every chunk fed to
    // this recognizer is resampled to that rate before being sent.
    recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
    recognizer.on("result", message => {
      if (message.event === "result" && message.result.text) callbacks.onFinalText(message.result.text);
    });
    recognizer.on("partialresult", message => {
      if (message.event === "partialresult") callbacks.onPartialText(message.result.partial);
    });
    recognizer.on("error", message => {
      if (message.event === "error") callbacks.onError(`Speech recognition error: ${message.error}`);
    });

    const source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = event => {
      if (!recognizer) return;
      try {
        const resampled = resampleTo16k(event.inputBuffer.getChannelData(0), nativeRate);
        recognizer.acceptWaveformFloat(resampled, SAMPLE_RATE);
      } catch (err) {
        // A single bad buffer shouldn't end the whole session — log and
        // keep listening rather than surfacing an error per audio frame.
        console.error("Vosk acceptWaveformFloat failed", err);
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    callbacks.onListening?.(true);
  }

  function teardownAudio() {
    processor?.disconnect();
    processor = null;
    audioContext?.close();
    audioContext = null;
    mediaStream?.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }

  function stop(): Promise<void> {
    if (!running) return Promise.resolve();
    running = false;
    return new Promise(resolve => {
      // Flush whatever's still buffered (e.g. the last word or two,
      // spoken right before Stop was pressed, that hasn't reached a
      // natural pause yet) rather than discarding it. vosk-browser's
      // retrieveFinalResult() is fire-and-forget — the flushed text
      // arrives asynchronously through the same "result" event the
      // caller already listens to via onFinalText, so this just waits a
      // beat for it before tearing the audio graph down.
      try {
        recognizer?.retrieveFinalResult();
      } catch (err) {
        console.error("Vosk retrieveFinalResult failed", err);
      }
      setTimeout(() => {
        teardownAudio();
        recognizer?.remove();
        recognizer = null;
        resolve();
      }, 300);
    });
  }

  function destroy() {
    void stop();
  }

  return { start, stop, destroy };
}
