import { useState } from "react";
import { Volume2, Square, Trash2, AlertCircle } from "lucide-react";
import { isSpeechSynthesisSupported } from "../speechSynthesis";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

/** Type something, have it spoken aloud — pure client-side, no backend. */
export function TextToSpeechPage({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const supported = isSpeechSynthesisSupported();

  function handleSpeak() {
    if (!text.trim() || !supported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function handleStop() {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  return (
    <div className="min-h-screen bg-[#FAF9FC] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <KaubanPageHeader title="Text to Speech" subtitle="Type something and have it spoken aloud." onBack={onBack} />

        {!supported && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>Text-to-speech isn't supported in this browser.</p>
          </div>
        )}

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type here…"
          rows={6}
          className="w-full resize-none rounded-2xl border-2 border-[#4F46E5]/15 bg-white p-4 text-lg text-[#1E1B3A] shadow-sm outline-none focus:border-[#4F46E5]"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleSpeak}
            disabled={!supported || !text.trim()}
            className="flex items-center gap-2 rounded-lg bg-[#4F46E5] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            <Volume2 size={17} /> {speaking ? "Speaking…" : "Speak"}
          </button>
          <button
            onClick={handleStop}
            disabled={!speaking}
            className="flex items-center gap-2 rounded-lg border border-[#4F46E5]/20 bg-white px-5 py-3 text-sm font-bold text-[#4F46E5] disabled:opacity-40"
          >
            <Square size={15} /> Stop
          </button>
          <button
            onClick={() => setText("")}
            disabled={!text}
            className="flex items-center gap-2 rounded-lg border border-transparent px-5 py-3 text-sm font-semibold text-slate-400 hover:text-slate-600 disabled:opacity-40"
          >
            <Trash2 size={15} /> Clear
          </button>
        </div>
      </div>
    </div>
  );
}
