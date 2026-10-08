import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, type QuestionType } from "../surveyTypes";
import { TYPE_ICONS } from "./typeIcons";

/** "Add question" button with the nine question types in a pop-up menu (opens upward: it sits in the bottom bar). */
export function AddQuestionMenu({ onPick, primary }: { onPick: (type: QuestionType) => void; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function esc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        className={`flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3.5 py-2.5 ${primary ? "bg-[#062444] text-white hover:bg-[#0a3a6b]" : "border border-[#e6ecf5] text-[#062444] hover:bg-[#f7f9fc]"}`}
      >
        <Plus size={15} /> Add question
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 mb-2 z-30 w-56 rounded-xl border border-[#e6ecf5] bg-white shadow-lg py-1.5 text-[12.5px]">
          {QUESTION_TYPES.map(t => {
            const Icon = TYPE_ICONS[t];
            return (
              <button
                key={t} role="menuitem" type="button"
                onClick={() => { setOpen(false); onPick(t); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]"
              >
                <Icon size={14} className="text-slate-500" /> {QUESTION_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
