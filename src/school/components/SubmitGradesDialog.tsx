import { useState } from "react";
import { Lock } from "lucide-react";
import { SchoolDialog } from "./SchoolDialog";
import { focusRing } from "./portalParts";
import { submitPeriod } from "../submissionApi";

/** Confirms submitting a period. After submitting, the grades are locked — said plainly here, before the school commits. */
export function SubmitGradesDialog({ periodId, periodTitle, scholarCount, onClose, onSubmitted }: {
  periodId: string; periodTitle: string; scholarCount: number; onClose: () => void; onSubmitted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    const result = await submitPeriod(periodId);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onSubmitted();
    onClose();
  }

  return (
    <SchoolDialog title="Submit grades?" onClose={onClose}>
      <p className="text-[15px] text-[#062444] mb-3">
        You are about to submit the grades of <strong>{scholarCount} scholar{scholarCount === 1 ? "" : "s"}</strong> for <strong>{periodTitle}</strong>.
      </p>
      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-3.5 py-3 mb-4">
        <Lock size={17} className="text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[14.5px] text-amber-950">
          <strong>After you submit, these grades are locked.</strong> To change a grade later you will need to send a correction request with a reason,
          and CEDO must approve it. To add or remove a subject, CEDO has to reopen your submission.
        </p>
      </div>
      {error && <p role="alert" className="text-[14.5px] text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={`px-4 py-2.5 rounded-lg border border-[#062444]/40 text-[14.5px] font-semibold text-[#062444] ${focusRing}`}>Not yet</button>
        <button type="button" onClick={() => void confirm()} disabled={busy}
          className={`bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14.5px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>
          {busy ? "Submitting…" : "Submit grades"}
        </button>
      </div>
    </SchoolDialog>
  );
}
