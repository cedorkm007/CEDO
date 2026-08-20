import { PartyPopper, X } from "lucide-react";
import type { FormMaterial } from "../../formsApi";

/**
 * Shown right after a scholar action (quiz passed, attendance redeemed) newly
 * unlocks one or more form materials — see compareUnlockStatus() in
 * formsApi.ts for how "newly" is determined. Deliberately generic: it takes
 * whatever materials to announce and a callback for its one action, so
 * Milestone B (Quest) and C (Attendance) can both reuse it unchanged for
 * their own trigger points instead of building their own pop-up.
 */
export function NewlyUnlockedModal({
  materials, onGoToForms, onClose,
}: {
  materials: FormMaterial[];
  onGoToForms: () => void;
  onClose: () => void;
}) {
  if (materials.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="relative bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 pt-6 pb-8 text-center">
          <button onClick={onClose} className="absolute top-3 right-3 text-white/60 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3BC00]/15 text-[#F3BC00]">
            <PartyPopper size={24} />
          </div>
          <h3 className="text-white font-bold text-[16px]">
            {materials.length === 1 ? "You unlocked a new form!" : `You unlocked ${materials.length} new forms!`}
          </h3>
        </div>

        <div className="p-5 space-y-3">
          <ul className="space-y-1.5">
            {materials.map(m => (
              <li key={m.id} className="text-[13.5px] font-semibold text-[#062444] bg-[#f8fafd] rounded-lg px-3 py-2">
                {m.title}
              </li>
            ))}
          </ul>
          <button
            onClick={() => { onGoToForms(); onClose(); }}
            className="w-full bg-[#062444] text-[#F3BC00] rounded-lg py-2.5 font-bold text-[13.5px]"
          >
            View in Forms
          </button>
          <button onClick={onClose} className="w-full text-[12.5px] font-semibold text-slate-400">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
