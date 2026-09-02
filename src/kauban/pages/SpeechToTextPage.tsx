import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Trash2, Copy, AlertCircle, Check } from "lucide-react";
import { isVoskRecognitionSupported } from "../voskSupport";
import type { VoskRecognizer } from "../voskRecognition";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/**
 * Speak, see it appear as text in real time — pure client-side, no
 * cloud dependency once the offline speech model is cached (see
 * voskRecognition.ts). Unlike the browser's built-in speech recognition,
 * this works fully offline after its one-time model download, and
 * unlike the earlier Whisper-based version of this page, it updates
 * continuously as you talk rather than only after you pause.
 */
export function SpeechToTextPage() {
  const [listening, setListening] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const recognizerRef = useRef<VoskRecognizer | null>(null);
  const supported = isVoskRecognitionSupported();

  useEffect(() => () => { recognizerRef.current?.destroy(); }, []);

  async function handleStart() {
    if (!supported || listening) return;
    setError("");
    setInterimText("");

    if (!recognizerRef.current) {
      // Dynamic import, not a top-level one: vosk-browser is a large
      // dependency, and statically importing it (even indirectly, for a
      // one-line capability check) pulled it into the *main* app bundle
      // instead of a lazily-loaded chunk — confirmed via a full
      // production build, where it ballooned the entry chunk from
      // ~2.3MB to ~8.1MB. This way it's only ever fetched by someone who
      // actually opens a speech feature.
      const { createVoskRecognizer } = await import("../voskRecognition");
      recognizerRef.current = createVoskRecognizer();
    }

    recognizerRef.current.start({
      onPartialText: setInterimText,
      onFinalText: text => {
        setInterimText("");
        setTranscript(t => (t ? `${t} ${text}` : text));
      },
      onModelLoading: setModelLoading,
      onListening: setListening,
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
            <p>Downloading offline speech model (one-time, ~40MB — Wi-Fi recommended)…</p>
          </div>
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
