import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Trash2, Copy, AlertCircle, Check } from "lucide-react";
import { createSpeechRecognition, isSpeechRecognitionSupported, type KaubanSpeechRecognition } from "../speechRecognition";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/** Speak, see it appear as text in real time — pure client-side, no backend. */
export function SpeechToTextPage() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const recognitionRef = useRef<KaubanSpeechRecognition | null>(null);
  const listeningRef = useRef(false);
  const supported = isSpeechRecognitionSupported();

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  function handleStart() {
    if (!supported || listening) return;
    setError("");

    const recognition = createSpeechRecognition();
    if (!recognition) { setError("Speech recognition isn't available in this browser."); return; }

    recognition.onresult = event => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalChunk += text;
        else interim += text;
      }
      if (finalChunk) setTranscript(t => (t ? `${t} ${finalChunk.trim()}` : finalChunk.trim()));
      setInterimText(interim);
    };

    recognition.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was denied — allow it in your browser to use this tool.");
        listeningRef.current = false;
        setListening(false);
      } else if (event.error !== "no-speech") {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => { if (listeningRef.current) recognition.start(); };

    recognitionRef.current = recognition;
    listeningRef.current = true;
    setListening(true);
    recognition.start();
  }

  function handleStop() {
    listeningRef.current = false;
    setListening(false);
    setInterimText("");
    recognitionRef.current?.stop();
    recognitionRef.current = null;
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
            <p>Speech recognition isn't supported in this browser. Try Chrome or Edge instead.</p>
          </div>
        )}

        <div className="min-h-[180px] rounded-3xl border-2 border-[#3182CE]/15 bg-white p-5 text-lg text-[#2D3748] shadow-sm">
          {transcript || <span className="text-[#CBD5E0]">{listening ? "Listening…" : "Press the microphone to start."}</span>}
          {interimText && <span className="text-[#A0AEC0]"> {interimText}</span>}
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
