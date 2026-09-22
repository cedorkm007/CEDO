import { X, ClipboardList } from "lucide-react";
import type { ScholarInformationRow } from "../seadApi";
import { ReferralFormPanel, type ReferralFormMode } from "./ReferralFormPanel";

const TITLE_BY_MODE: Record<ReferralFormMode, string> = {
  create: "Referral Form",
  counsel: "Referral Form — Consultation",
  approve: "Referral Form — Approval",
  view: "Referral Form",
};

/** Fixed-overlay chrome around ReferralFormPanel, for the "create" (Scholars Information), "counsel" (Main Dashboard queue), and "view" (already-in-flight referral) entry points. "approve" is embedded directly inside the Notifications modal instead — see App.tsx. */
export function ReferralFormModal({
  mode, scholar, referralId, onClose, onDone,
}: {
  mode: Exclude<ReferralFormMode, "approve">;
  scholar?: ScholarInformationRow;
  referralId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><ClipboardList size={16} className="text-[#F3BC00]" /> {TITLE_BY_MODE[mode]}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6 max-h-[75vh] overflow-y-auto">
          <ReferralFormPanel mode={mode} scholar={scholar} referralId={referralId} onDone={onDone} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
