import { useState } from "react";
import { ModalShell } from "../SeadUiShell";
import { deleteSurveyResponse } from "../../surveyEditorApi";
import type { GatingRosterEntry } from "../../types";

/** "Delete this response?": what happens, an optional reason, then delete. A copy is kept and can be restored. */
export function DeleteResponseDialog({ surveyId, row, onClose, onDeleted }: {
  surveyId: string; row: GatingRosterEntry; onClose: () => void; onDeleted: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setBusy(true);
    setError("");
    const r = await deleteSurveyResponse(surveyId, row.scholarIdNumber, row.activityId ?? null, reason);
    setBusy(false);
    if (r.ok === false) { setError(r.error); return; }
    onDeleted();
  }

  return (
    <ModalShell title="Delete this response?" onClose={onClose}>
      <p className="text-[13.5px] text-[#062444]"><strong>{row.scholarName}</strong> ({row.scholarIdNumber}){row.activityName ? ` · ${row.activityName}` : ""}</p>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#062444]">
        <li>The answers leave the list and the charts. A copy is kept, and you can restore it below the list.</li>
        <li>The scholar will not be asked this survey again.</li>
        <li>Attendance and credit already given stay. {row.status === "in_progress" ? "What is waiting for this survey will be given now." : ""}</li>
      </ul>
      <label className="block text-[12.5px] font-semibold text-slate-500">
        Reason (optional)
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500}
          className="mt-1 w-full rounded-lg border border-[#062444]/15 px-3 py-2 text-sm font-normal text-[#062444] outline-none focus:border-[#0088cc]" />
      </label>
      {error && <p role="alert" className="text-[13px] text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/20 px-4 py-2 text-[13px] font-semibold text-slate-600 hover:bg-[#f7f9fc]">Cancel</button>
        <button type="button" onClick={() => void handleDelete()} disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-60">
          {busy ? "Deleting…" : "Delete response"}
        </button>
      </div>
    </ModalShell>
  );
}
