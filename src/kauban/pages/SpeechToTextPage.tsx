import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Trash2, Copy, AlertCircle, Check } from "lucide-react";
import { createWhisperRecognizer, isWhisperRecognitionSupported, type WhisperRecognizer } from "../whisperRecognition";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/**
 * Speak, see it appear as text in real time — pure client-side, no
 * cloud dependency once the offline speech model is cached (see
 * whisperRecognition.ts). Unlike the browser's built-in speech
 * recognition, this works fully offline after its one-time model
 * download.
 *
 * There's no live word-by-word captioning here the way a continuous
 * recognizer would give: Whisper has no incremental output, so text
 * appears in short chunks whenever a pause is detected, not word by word.
 */
export function SpeechToTextPage() {
  const [listening, setListening] = useState(false);
  const [modelLoading, setModelLoading] = useState<number | null>(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const recognizerRef = useRef<WhisperRecognizer | null>(null);
  const supported = isWhisperRecognitionSupported();

  useEffect(() => () => { recognizerRef.current?.destroy(); }, []);

  function handleStart() {
    if (!supported || listening) return;
    setError("");

    if (!recognizerRef.current) recognizerRef.current = createWhisperRecognizer();

    recognizerRef.current.start({
      onFinalText: text => setTranscript(t => (t ? `${t} ${text}` : text)),
      onModelLoading: fraction => setModelLoading(fraction),
      onModelReady: () => setModelLoading(null),
      onListening: setListening,
      onError: message => {
        setError(message);
        setListening(false);
        setModelLoading(null);
      },
    });
  }

  function handleStop() {
    recognizerRef.current?.stop();
    setListening(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — ignore */ }
  }

  return (
    <div className="rounded-[20px] bg-[#F7FAFC] p-4 shadow-xl sm:p-10">
      <KaubanPageHeader title="Speech to Text" subtitle="See spoken words as text in real time." />

        {!supported && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>Speech recognition isn't supported in this browser.</p>
          </div>
        )}

        {modelLoading !== null && (
          <div className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <p className="mb-1.5">Downloading offline speech model (one-time, ~40MB)…</p>
            <div className="h-2 overflow-hidden rounded-full bg-amber-100">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.round(modelLoading * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="min-h-[180px] rounded-3xl border-2 border-[#3182CE]/15 bg-white p-5 text-lg text-[#2D3748] shadow-sm">
          {transcript || <span className="text-[#CBD5E0]">{listening ? "Listening… speak, then pause." : "Press the microphone to start."}</span>}
        </div>

        {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={listening ? handleStop : handleStart}
            disabled={!supported}
            className={`flex h-[72px] w-[72px] items-center justify-center rounded-full shadow-lg transition-transform duration-150 active:scale-90 disabled:opacity-40 ${listening ? "bg-red-500 text-white" : "bg-[#3182CE] text-white"}`}
            aria-label={listening ? "Stop listening" : "Start listening"}
          >
            {listening ? <MicOff size={28} /> : <Mic size={28} />}
          </button>
          <button
            onClick={handleCopy}
            disabled={!transcript}
            className="flex min-h-12 items-center gap-1.5 rounded-full bg-[#EBF8FF] px-4 py-2.5 text-sm font-semibold text-[#2B6CB0] transition active:scale-95 disabled:opacity-40"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => setTranscript("")}
            disabled={!transcript}
            className="flex min-h-12 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-[#A0AEC0] transition active:scale-95 hover:text-[#718096] disabled:opacity-40"
          >
            <Trash2 size={15} /> Clear
          </button>
        </div>
    </div>
  );
}
