import { createModel, type Model, type KaldiRecognizer } from "vosk-browser";

// Bumped from v1 when the model itself changed (small -> lgraph, see
// download-vosk-model.mjs) — a device that already cached the old model
// under the old key would otherwise keep serving it forever from Cache
// Storage instead of ever fetching the new one.
const MODEL_CACHE_NAME = "kauban-vosk-model-v2";

/**
 * On-device offline speech recognition via Vosk, replacing the earlier
 * Whisper-based engine (see docs/kauban/PROGRESS.md) — Whisper has no
 * incremental output at all, only "transcribe this finished chunk of
 * audio", so the best it could offer was text appearing in bursts
 * whenever a pause was detected. Vosk is built for real streaming
 * recognition: it reports a continuously-updating partial guess *while*
 * someone is still talking, then a final result once they pause — the
 * same "watch it appear as you speak" feel as the browser's own
 * (cloud-only) speech recognition. The tradeoff is accuracy: even with
 * the larger "lgraph" model (download-vosk-model.mjs), Vosk is still
 * noticeably less accurate per word than Whisper's — the lgraph model
 * over the original small one was specifically to close that gap for
 * longer, natural sentences, which the small model's tiny language
 * model handled poorly (dropped/garbled words past a few words in).
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

/**
 * Fetches the model archive through Cache Storage, managed directly here
 * rather than left to kauban-sw.js's own fetch interception — same
 * reasoning as offlineCaches.ts on the video side: vosk-browser's
 * createModel() does its own fetch() from inside its internal Web
 * Worker, which this page code can't intercept or verify, so getting a
 * genuinely offline-capable model means never depending on the service
 * worker to have been active at the right moment.
 *
 * Passing createModel() a blob: URL instead of the network path is the
 * key part: a blob URL is served from this tab's own memory, not over
 * the network at all, so vosk-browser's internal fetch succeeds offline
 * unconditionally, with nothing for a service worker to get right or
 * wrong. The blob URL is intentionally never revoked — the model is a
 * long-lived singleton for the app's whole session.
 */
async function ensureModelCached(): Promise<Response> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const cached = await cache.match(MODEL_URL);
  if (cached) return cached;
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await cache.put(MODEL_URL, response.clone());
  // Best-effort: reduces (doesn't guarantee) the chance the browser
  // evicts this under storage pressure before it's needed again offline.
  try {
    await navigator.storage?.persist?.();
  } catch { /* not fatal */ }
  return response;
}

async function getModelUrl(): Promise<string> {
  const response = await ensureModelCached();
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Downloads the model into Cache Storage without going through
 * createModel()'s WASM parsing/init (that's deferred to actual first use
 * in getModel() below) — used by the "Download for Offline" flow
 * (OfflineDownloadModal.tsx) to prefetch the model up front, alongside
 * the sign videos, rather than waiting for someone to press the mic for
 * the first time while already offline.
 */
export async function prefetchVoskModel(): Promise<void> {
  await ensureModelCached();
}

const MODEL_LOAD_TIMEOUT_MS = 30000;

function getModel(): Promise<Model> {
  if (!modelPromise) {
    // vosk-browser's own createModel() has no timeout of its own — worse,
    // reading its source shows a real bug: it resolves on a successful
    // "load" event, but if that event never fires at all (its internal
    // Worker's own fetch of the model URL fails in a way that doesn't
    // report back, or just never returns), the returned promise hangs
    // forever with no error, ever. On screen that reads as "nothing
    // happened" — exactly what got reported. This race turns a silent,
    // permanent hang into a real, visible error after a wait that's
    // generous for a large offline model load but not infinite.
    modelPromise = Promise.race([
      getModelUrl().then(url => createModel(url)),
      new Promise<Model>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out loading the speech model.")), MODEL_LOAD_TIMEOUT_MS)
      ),
    ]);
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
      // Otherwise a failed first attempt (e.g. no connection yet) would
      // wedge every future attempt for the rest of the session on the
      // same cached rejected promise, even after connectivity returns.
      modelPromise = null;
      callbacks.onModelLoading?.(false);
      const message = err instanceof Error ? err.message : String(err);
      callbacks.onError(
        /fetch|network|failed to load/i.test(message)
          ? "This needs an internet connection the first time, to download the offline speech model (~130MB). After that, it works offline."
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
    // vosk-browser has a documented bug (github.com/ccoreilly/vosk-browser
    // issue #69): if the recognizer already auto-finalized a segment
    // because of trailing silence, a later retrieveFinalResult() call
    // (stop() below calls it, to flush speech that hasn't paused yet)
    // fires a *second* "result" event repeating that same text — reported
    // here as the whole sentence appearing twice after pressing Stop.
    // Since two genuinely distinct utterances finalizing back-to-back
    // with byte-identical text is effectively never legitimate, dropping
    // an exact repeat of the immediately preceding final is a safe guard
    // against the duplicate without needing a library fix.
    let lastFinalText = "";
    recognizer.on("result", message => {
      if (message.event !== "result" || !message.result.text) return;
      if (message.result.text === lastFinalText) return;
      lastFinalText = message.result.text;
      callbacks.onFinalText(message.result.text);
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
