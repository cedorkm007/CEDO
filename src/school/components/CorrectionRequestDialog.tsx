import { useState } from "react";
import { SchoolDialog } from "./SchoolDialog";
import { fieldClass, focusRing } from "./portalParts";
import { requestCorrection } from "../submissionApi";
import { validateCorrectionRequest } from "../submissionLogic";
import { gradeInputHint } from "../portalLogic";
import type { GradingConfig, LetterGrade } from "../types";

/** Ask CEDO to let one locked grade be corrected: a reason (required) and, optionally, the grade it should become. */
export function CorrectionRequestDialog({ gradeId, subject, currentGrade, config, letters, onClose, onSent }: {
  gradeId: string; subject: string; currentGrade: string; config: GradingConfig | null; letters: LetterGrade[];
  onClose: () => void; onSent: () => void;
}) {
  const [reason, setReason] = useState("");
  const [proposed, setProposed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const problem = validateCorrectionRequest(reason, proposed, config, letters);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const result = await requestCorrection(gradeId, reason, proposed);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onSent();
    onClose();
  }

  return (
    <SchoolDialog title="Request a correction" onClose={onClose}>
      <p className="text-[14.5px] text-slate-800 mb-3">
        <strong className="text-[#062444]">{subject}</strong> — current grade <strong className="text-[#062444]">{currentGrade || "none"}</strong>.
        CEDO will review your request. If it is approved, you can change this one grade once.
      </p>
      <form onSubmit={submit} noValidate>
        <div className="space-y-3.5 mb-4">
          <div>
            <label htmlFor="corr-reason" className="block text-[14px] font-semibold text-[#062444] mb-1">Why does this grade need to change?</label>
            <textarea id="corr-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} className={`${fieldClass} w-full`}
              placeholder="For example: the official grade slip shows a different grade." />
          </div>
          <div>
            <label htmlFor="corr-proposed" className="block text-[14px] font-semibold text-[#062444] mb-1">Correct grade (optional)</label>
            <input id="corr-proposed" value={proposed} onChange={e => setProposed(e.target.value)} aria-describedby="corr-hint" className={`${fieldClass} w-32`} />
            <p id="corr-hint" className="text-[14px] text-slate-700 mt-1">{gradeInputHint(config, letters)}</p>
          </div>
        </div>
        {error && <p role="alert" className="text-[14.5px] text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`px-4 py-2.5 rounded-lg border border-[#062444]/40 text-[14.5px] font-semibold text-[#062444] ${focusRing}`}>Cancel</button>
          <button type="submit" disabled={busy} className={`bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14.5px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </SchoolDialog>
  );
}
