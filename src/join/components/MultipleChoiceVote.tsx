import { useState } from "react";
import { Circle, Square, CheckCircle2, CheckSquare } from "lucide-react";
import { submitResponse } from "../joinApi";

export function MultipleChoiceVote({ sessionId, settings, votingLocked }: {
  sessionId: string; settings: Record<string, unknown>; votingLocked: boolean;
}) {
  const question = (settings.question as string) || "";
  const options = (settings.options as string[]) || [];
  const allowMultiple = !!settings.allowMultiple;
  const [selected, setSelected] = useState<number[]>([]);
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [error, setError] = useState("");

  async function toggle(i: number) {
    if (votingLocked || status === "submitting") return;
    const next = allowMultiple
      ? (selected.includes(i) ? selected.filter(x => x !== i) : [...selected, i])
      : [i];
    setSelected(next);
    if (next.length === 0) return; // nothing to submit yet (deselected everything in multi mode)
    setStatus("submitting");
    setError("");
    const res = await submitResponse(sessionId, { selectedIndexes: next });
    if (!res.ok) { setStatus("error"); setError(res.error); return; }
    setStatus("submitted");
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <h2 className="text-xl font-bold text-[#062444] text-center mb-5 break-words">{question}</h2>
      <div className="space-y-2">
        {options.map((option, i) => {
          const isSelected = selected.includes(i);
          const Icon = allowMultiple ? (isSelected ? CheckSquare : Square) : (isSelected ? CheckCircle2 : Circle);
          return (
            <button
              key={i} onClick={() => toggle(i)} disabled={votingLocked}
              className={`w-full flex items-center gap-2.5 border rounded-lg px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                isSelected ? "border-[#0088cc] bg-[#f0f8ff]" : "border-[#e6ecf5] hover:border-[#0088cc]/40"
              }`}
            >
              <Icon size={18} className={isSelected ? "text-[#0088cc]" : "text-slate-300"} />
              <span className="text-[14px] font-medium text-[#062444] break-words">{option}</span>
            </button>
          );
        })}
      </div>
      {status === "submitted" && (
        <p className="flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-green-600 mt-4">
          <CheckCircle2 size={14} /> Response received
        </p>
      )}
      {error && <p className="text-[12.5px] text-red-600 text-center mt-4">{error}</p>}
      {votingLocked && <p className="text-[12.5px] text-amber-600 text-center mt-4">Voting is currently locked by the presenter.</p>}
    </div>
  );
}
