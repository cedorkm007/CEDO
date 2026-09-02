import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Trash2, Copy, AlertCircle, Check, Cloud, CloudOff } from "lucide-react";
import { createAdaptiveSpeechRecognizer, isSpeechRecognitionAvailable, type AdaptiveSpeechRecognizer, type SpeechEngine } from "../adaptiveSpeechRecognizer";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/**
 * Speak, see it appear as text in real time. Uses the browser's own
 * (cloud-backed) speech recognition when online — more accurate, and
 * this is the same engine the app used before offline support existed —
 * falling back to the on-device Vosk engine when offline, or if the
 * cloud engine can't actually reach the network despite appearing
 * online (see adaptiveSpeechRecognizer.ts). Unlike Whisper (an earlier
 * version of this page's offline engine), Vosk updates continuously as
 * you talk rather than only after you pause.
 */
export function SpeechToTextPage() {
  const [listening, setListening] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [engine, setEngine] = useState<SpeechEngine | null>(null);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const recognizerRef = useRef<AdaptiveSpeechRecognizer | null>(null);
  const supported = isSpeechRecognitionAvailable();

  useEffect(() => () => { recognizerRef.current?.destroy(); }, []);

  function handleStart() {
    if (!supported || listening) return;
    setError("");
    setInterimText("");
    setEngine(null);

    if (!recognizerRef.current) recognizerRef.current = createAdaptiveSpeechRecognizer();

    recognizerRef.current.start({
      onPartialText: setInterimText,
      onFinalText: text => {
        setInterimText("");
        setTranscript(t => (t ? `${t} ${text}` : text));
      },
      onModelLoading: setModelLoading,
      onListening: setListening,
      onEngine: setEngine,
      onError: message => {
        setError(message);
        setListening(false);
        setModelLoading(false);
      },
    });
  }

  function handleStop() {
    recognizerRef.current?.stop();
    setListening(false);
    setInterimText("");
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

        {modelLoading && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>Downloading offline speech model (one-time, ~130MB — Wi-Fi recommended)…</p>
          </div>
        )}

        {listening && engine && (
          <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-[#A0AEC0]">
            {engine === "cloud"
              ? <><Cloud size={13} /> Using accurate online recognition</>
              : <><CloudOff size={13} /> Using offline speech recognition</>}
          </p>
        )}

        <div className="min-h-[180px] rounded-3xl border-2 border-[#3182CE]/15 bg-white p-5 text-lg text-[#2D3748] shadow-sm">
          {transcript || interimText || <span className="text-[#CBD5E0]">{listening ? "Listening…" : "Press the microphone to start."}</span>}
          {transcript && interimText && <span className="text-[#A0AEC0]"> {interimText}</span>}
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
