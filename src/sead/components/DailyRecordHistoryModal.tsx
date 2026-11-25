import { useEffect, useState } from "react";
import { ModalShell } from "./SeadUiShell";
import { fetchRecordHistory, type RecordEdit } from "../scholarCounselingApi";
import { formatEditTime } from "@/lib/dailyRecordEdit";

function Change({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return null;
  return (
    <div className="mt-2">
      <p className="text-[13px] font-bold text-[#062444]">{label}</p>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[12px] font-bold uppercase tracking-wide text-red-800">Before</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] text-slate-900">{before || "(empty)"}</p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <p className="text-[12px] font-bold uppercase tracking-wide text-green-800">After</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] text-slate-900">{after || "(empty)"}</p>
        </div>
      </div>
    </div>
  );
}

/** Every edit made to ONE record after the visit, newest first: who, when, the reason, and what the Findings and the Staff recommendations said before and after. It can only be read: nobody can change or delete a line. */
export function DailyRecordHistoryModal({ recordId, name, onClose }: { recordId: string; name: string; onClose: () => void }) {
  const [edits, setEdits] = useState<RecordEdit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void fetchRecordHistory(recordId).then(r => {
      if (!live) return;
      if (r.ok) setEdits(r.edits); else { setError(r.missing ? "The edit history needs the latest database update (supabase_migration_daily_records_edit.sql). Ask the IT admin to run it." : r.error); setEdits([]); }
    });
    return () => { live = false; };
  }, [recordId]);

  return (
    <ModalShell title={`Edit history · ${name}`} onClose={onClose} wide>
      <p className="text-[13px] text-slate-700">Every change made to the Findings and the Staff recommendations after the visit. This list can only grow: no line can be changed or deleted.</p>
      {error && <p role="alert" className="text-[13.5px] text-red-700">{error}</p>}
      {edits === null ? <p className="py-6 text-center text-slate-600">Loading…</p> : edits.length === 0 && !error ? (
        <p className="py-6 text-center text-slate-600">This record has not been edited.</p>
      ) : (
        <ol className="space-y-3">
          {edits.map(e => (
            <li key={e.editNo} className="rounded-lg border border-[#e6ecf5] px-3 py-3">
              <p className="text-[13.5px] font-semibold text-[#062444]">Edit {e.editNo} · {formatEditTime(e.editedAt)} · {e.editedByName || "Staff"}</p>
              {e.reason && <p className="mt-0.5 text-[13px] text-slate-800">Reason: {e.reason}</p>}
              <Change label="Findings" before={e.oldFindings} after={e.newFindings} />
              <Change label="Staff recommendations" before={e.oldStaffRecommendations} after={e.newStaffRecommendations} />
            </li>
          ))}
        </ol>
      )}
      <div className="flex justify-end pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Close</button>
      </div>
    </ModalShell>
  );
}
