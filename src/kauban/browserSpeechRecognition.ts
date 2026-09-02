import type { VoskCallbacks, VoskRecognizer } from "./voskRecognition";

/**
 * Wraps the browser's own (cloud-backed) speech recognition — the engine
 * this app used before switching to on-device Vosk for offline support.
 * It needs a live connection, but it's noticeably more accurate and
 * genuinely live (interim results as you speak) than Vosk's small
 * self-hosted model, so adaptiveSpeechRecognizer.ts prefers this one
 * whenever a connection is available and falls back to Vosk otherwise.
 *
 * Exposes the same start/stop/destroy shape as VoskRecognizer (type-only
 * import above — erased at compile time, so this file stays free of
 * vosk-browser's heavy runtime code) so callers don't need to know or
 * care which engine ended up running.
 */

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isBrowserSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

/**
 * Returned as the onError message specifically for a "network" failure —
 * adaptiveSpeechRecognizer.ts checks for this exact string to trigger a
 * transparent fallback to Vosk, since navigator.onLine can say "online"
 * while the connection is actually too broken to reach the recognition
 * service. Not meant to be shown to a user as-is.
 */
export const NETWORK_ERROR_SENTINEL = "browser-speech-recognition-network-error";

export function createBrowserSpeechRecognizer(): VoskRecognizer {
  let recognition: SpeechRecognition | null = null;
  let running = false;
  let manualStop = false;

  function start(callbacks: VoskCallbacks) {
    const Ctor = getCtor();
    if (!Ctor) {
      callbacks.onError("Speech recognition isn't supported in this browser.");
      return;
    }
    running = true;
    manualStop = false;

    recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          const trimmed = text.trim();
          if (trimmed) callbacks.onFinalText(trimmed);
        } else {
          interim += text;
        }
      }
      if (interim.trim()) callbacks.onPartialText(interim.trim());
    };

    recognition.onerror = event => {
      // "no-speech" fires constantly during normal pauses between
      // sentences — not a real error, and "aborted" is just this file's
      // own stop() calling recognition.stop(). Both would otherwise spam
      // onError for completely expected behavior.
      if (event.error === "no-speech" || event.error === "aborted") return;
      running = false;
      if (event.error === "network") {
        callbacks.onError(NETWORK_ERROR_SENTINEL);
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        callbacks.onError("Microphone access was denied — allow it in your browser to use this tool.");
      } else {
        callbacks.onError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Chrome's own recognizer stops itself after a stretch of silence
      // even with continuous=true — restart transparently so a listening
      // session actually behaves continuously from the caller's point of
      // view, unless this was an explicit Stop.
      if (running && !manualStop) {
        try {
          recognition?.start();
        } catch {
          // Already starting/started — a restart race, not a real failure.
        }
      } else {
        callbacks.onListening?.(false);
      }
    };

    try {
      recognition.start();
      callbacks.onListening?.(true);
    } catch (err) {
      running = false;
      callbacks.onError(`Couldn't start speech recognition: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stop(): Promise<void> {
    manualStop = true;
    running = false;
    recognition?.stop();
    recognition = null;
    return Promise.resolve();
  }

  function destroy() {
    void stop();
  }

  return { start, stop, destroy };
}
