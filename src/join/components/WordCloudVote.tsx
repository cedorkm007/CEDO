import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { submitResponse } from "../joinApi";

export function WordCloudVote({ sessionId, settings, votingLocked }: {
  sessionId: string; settings: Record<string, unknown>; votingLocked: boolean;
}) {
  const question = (settings.question as string) || "";
  const maxWords = (settings.maxWordsPerPerson as number) || 1;
  const maxChars = (settings.maxCharsPerWord as number) || 40;
  const [words, setWords] = useState<string[]>(Array(maxWords).fill(""));
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit() {
    const cleaned = words.map(w => w.trim()).filter(Boolean);
    if (cleaned.length === 0) { setError("Enter at least one word."); return; }
    setStatus("submitting");
    setError("");
    const res = await submitResponse(sessionId, { words: cleaned });
    if (!res.ok) { setStatus("error"); setError(res.error); return; }
    setStatus("submitted");
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <h2 className="text-xl font-bold text-[#062444] text-center mb-1 break-words">{question}</h2>
      <p className="text-[12px] text-slate-400 text-center mb-5">
        Up to {maxWords} word{maxWords > 1 ? "s" : ""}, {maxChars} characters each
      </p>
      <div className="space-y-2 mb-4">
        {Array.from({ length: maxWords }).map((_, i) => (
          <input
            key={i} value={words[i]} maxLength={maxChars} disabled={votingLocked}
            onChange={e => setWords(w => w.map((x, j) => j === i ? e.target.value : x))}
            placeholder={`Word ${i + 1}`}
            className="w-full border border-[#e6ecf5] rounded-lg px-3.5 py-2.5 text-[14px] outline-none focus:border-[#0088cc] disabled:bg-[#f7f9fc]"
          />
        ))}
      </div>
      <button
        onClick={handleSubmit} disabled={votingLocked || status === "submitting"}
        className="w-full bg-[#062444] text-white text-[13.5px] font-semibold rounded-lg py-2.5 disabled:opacity-50"
      >
        {status === "submitting" ? "Submitting…" : "Submit"}
      </button>
      {status === "submitted" && (
        <p className="flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-green-600 mt-3">
          <CheckCircle2 size={14} /> Submitted — you can change it anytime before the presenter moves on
        </p>
      )}
      {error && <p className="text-[12.5px] text-red-600 text-center mt-3">{error}</p>}
      {votingLocked && <p className="text-[12.5px] text-amber-600 text-center mt-3">Voting is currently locked by the presenter.</p>}
    </div>
  );
}
