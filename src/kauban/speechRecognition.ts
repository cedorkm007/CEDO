/**
 * Thin wrapper over the browser's Web Speech API recognition side (as
 * opposed to speechSynthesis.ts, the synthesis side). TypeScript's DOM
 * lib doesn't reliably ship types for this API across versions, so this
 * declares only the small slice actually used here rather than pulling
 * in a third-party types package for one file.
 */

interface KaubanSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string; confidence: number };
}

interface KaubanSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<KaubanSpeechRecognitionResult>;
}

interface KaubanSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

export interface KaubanSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: KaubanSpeechRecognitionEvent) => void) | null;
  onerror: ((event: KaubanSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => KaubanSpeechRecognition;

function getConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== "undefined" && getConstructor() !== null;
}

export function createSpeechRecognition(lang = "en-US"): KaubanSpeechRecognition | null {
  const Ctor = getConstructor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = lang;
  return recognition;
}
