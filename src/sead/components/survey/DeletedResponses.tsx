import { useEffect, useState } from "react";
import { fetchDeletedResponses, restoreSurveyResponse, type DeletedResponse } from "../../surveyEditorApi";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });

/** Responses deleted from this survey, each with a Restore button. Hidden when there are none. */
export function DeletedResponses({ surveyId, version, onRestored }: { surveyId: string; version: number; onRestored: () => void }) {
  const [rows, setRows] = useState<DeletedResponse[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchDeletedResponses(surveyId).then(r => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [surveyId, version]);

  async function restore(row: DeletedResponse) {
    setBusy(row.id);
    setNote("");
    const r = await restoreSurveyResponse(row.id);
    setBusy(null);
    if (r.ok === false) { setNote(r.error); return; }
    setNote(r.lost > 0 ? `Restored, but ${r.lost} answer(s) could not come back because their question or choice was removed since.` : "Restored.");
    onRestored();
  }

  if (rows.length === 0 && !note) return null;
  return (
    <div className="mt-3 border-t border-[#f0f3f8] pt-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="text-[12px] font-bold uppercase text-slate-600 hover:underline">
        {open ? "Hide" : "Show"} deleted responses ({rows.length})
      </button>
      {note && <p role="status" className="mt-1 text-[12.5px] text-[#062444]">{note}</p>}
      {open && (
        <ul className="mt-2 space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f8fafd] px-3 py-2 text-[12.5px] text-[#062444]">
              <span className="min-w-0">
                <span className="block font-semibold">{r.scholarName} ({r.scholarIdNumber}) · {r.activityName}</span>
                <span className="block text-slate-600">{r.answerCount} answer{r.answerCount === 1 ? "" : "s"} · deleted {when(r.deletedAt)} by {r.deletedBy}{r.reason ? ` · ${r.reason}` : ""}</span>
              </span>
              <button type="button" onClick={() => void restore(r)} disabled={busy === r.id} className="shrink-0 rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 font-semibold hover:bg-[#f7f9fc] disabled:opacity-60">
                {busy === r.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
