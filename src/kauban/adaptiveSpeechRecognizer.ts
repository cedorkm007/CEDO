import type { VoskCallbacks, VoskRecognizer } from "./voskRecognition";
import { createBrowserSpeechRecognizer, isBrowserSpeechRecognitionSupported, NETWORK_ERROR_SENTINEL } from "./browserSpeechRecognition";
import { isVoskRecognitionSupported } from "./voskSupport";

/**
 * Picks the best speech engine each time listening starts: the browser's
 * own cloud-backed recognizer when a connection is available (far more
 * accurate, and genuinely live — the same engine this app used before
 * switching to Vosk for offline support), falling back to the on-device
 * Vosk engine (voskRecognition.ts) when offline, or transparently
 * mid-session if the cloud engine reports a network failure that
 * navigator.onLine didn't catch (a known unreliable signal — it reflects
 * link-layer connectivity, not whether the connection actually works).
 *
 * Exposes the same start/stop/destroy shape as VoskRecognizer, so
 * SpeechToTextPage.tsx / SpeechToSignLanguagePage.tsx don't need to know
 * which engine ended up running — except via the optional onEngine
 * callback below, for UI that wants to show which one is active.
 *
 * Statically importable: unlike voskRecognition.ts, this file has no
 * static dependency on vosk-browser (only a type-only import, erased at
 * compile time) — the actual Vosk module is only ever dynamically
 * imported inside startVosk(), when the offline path is actually needed.
 */

export type SpeechEngine = "cloud" | "vosk";

export interface AdaptiveSpeechCallbacks extends VoskCallbacks {
  /** Fires once start() has picked an engine — before it's necessarily ready/listening. */
  onEngine?: (engine: SpeechEngine) => void;
}

export interface AdaptiveSpeechRecognizer {
  start(callbacks: AdaptiveSpeechCallbacks): void;
  stop(): Promise<void>;
  destroy(): void;
}

export function isSpeechRecognitionAvailable(): boolean {
  return isBrowserSpeechRecognitionSupported() || isVoskRecognitionSupported();
}

export function createAdaptiveSpeechRecognizer(): AdaptiveSpeechRecognizer {
  let active: VoskRecognizer | null = null;

  function startVosk(callbacks: AdaptiveSpeechCallbacks) {
    callbacks.onEngine?.("vosk");
    import("./voskRecognition").then(({ createVoskRecognizer }) => {
      active = createVoskRecognizer();
      active.start(callbacks);
    });
  }

  function start(callbacks: AdaptiveSpeechCallbacks) {
    const canUseCloud = navigator.onLine && isBrowserSpeechRecognitionSupported();
    if (!canUseCloud) {
      startVosk(callbacks);
      return;
    }

    callbacks.onEngine?.("cloud");
    active = createBrowserSpeechRecognizer();
    active.start({
      ...callbacks,
      onError: message => {
        if (message === NETWORK_ERROR_SENTINEL) {
          // navigator.onLine said we had a connection, but the cloud
          // engine couldn't actually reach the recognition service —
          // fall back instead of leaving someone stuck mid-sentence with
          // a dead microphone button.
          active = null;
          startVosk(callbacks);
        } else {
          callbacks.onError(message);
        }
      },
    });
  }

  function stop(): Promise<void> {
    return active?.stop() ?? Promise.resolve();
  }

  function destroy() {
    active?.destroy();
    active = null;
  }

  return { start, stop, destroy };
}
