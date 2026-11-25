import { useState } from "react";
import { Pencil } from "lucide-react";
import { ModalShell } from "./SeadUiShell";
import { DailyRecordHistoryModal } from "./DailyRecordHistoryModal";
import { fetchDailyRecordById, updateDailyRecord, type DailyRecord } from "../scholarCounselingApi";
import { canEditRecord, editChanged, editedLine, EDIT_REASON_LIMIT, EDIT_TEXT_LIMIT, textProblem } from "@/lib/dailyRecordEdit";

const STATUS_BADGE: Record<string, string> = {
  Regular: "bg-green-100 text-green-800", Probationary: "bg-red-100 text-red-700", "On leave": "bg-amber-100 text-amber-800", Reconsidered: "bg-blue-100 text-blue-800", Removed: "bg-slate-200 text-slate-700",
};
const longDay = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—");
const BOX = "w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-[#0088cc]";

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-[14px]">
      <dt className="text-slate-600">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * The record's detail window (Consultation Tool > Daily Records > the eye button): everything about one visit, including what the table no longer shows (status, failed subjects,
 * findings, recommendations, who consulted). "View scholar profile" opens the scholar's profile as before.
 * It opens READ-ONLY. The staff member who WROTE the record also sees an "Edit" button: it makes the Findings and the Staff recommendations editable (plain text, up to 20,000 characters each,
 * with an optional reason). Every saved edit is kept in a history that can only be added to ("View history"). Nobody else can edit: the database refuses, this only hides the button.
 * `onChanged` hands the saved record back so the list row updates without reloading the list.
 */
export function DailyRecordDetailModal({ record, meId, onClose, onViewProfile, profileLoading, onChanged }: {
  record: DailyRecord; meId?: string | null; onClose: () => void; onViewProfile: () => void; profileLoading: boolean; onChanged?: (r: DailyRecord) => void;
}) {
  const mine = canEditRecord(record.consultedById, meId);
  const [editing, setEditing] = useState(false);
  const [findings, setFindings] = useState(record.findings);
  const [recs, setRecs] = useState(record.staffRecommendations);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const dirty = editing && editChanged(record, findings, recs);

  function startEdit() { setFindings(record.findings); setRecs(record.staffRecommendations); setReason(""); setError(""); setConflict(false); setSaved(""); setEditing(true); }
  function leaveEdit() { setEditing(false); setError(""); setConflict(false); }
  function cancelEdit() { if (dirty && !window.confirm("Discard your changes to this record?")) return; leaveEdit(); }
  function close() { if (dirty && !window.confirm("Discard your changes to this record?")) return; onClose(); }

  async function save() {
    const problem = textProblem(findings, recs, reason);
    if (problem) { setError(problem); return; }
    if (!dirty) { leaveEdit(); return; }
    setBusy(true); setError(""); setConflict(false);
    const r = await updateDailyRecord(record.id, findings, recs, reason, record.editCount);
    setBusy(false);
    if (r.ok) {
      onChanged?.({ ...record, findings: findings.trim(), staffRecommendations: recs.trim(), editCount: r.editCount, lastEditedAt: r.lastEditedAt ?? record.lastEditedAt, editedByName: r.editedByName || record.editedByName });
      setEditing(false); setSaved("Saved");
      return;
    }
    if (r.conflict) { setConflict(true); setError("This record was changed in another window after you opened it, so nothing was saved. Your text is still in the boxes."); return; }
    setError(r.missing ? "Editing needs the latest database update (supabase_migration_daily_records_edit.sql). Ask the IT admin to run it." : r.error || "The record could not be saved. Your text is still in the boxes: try again.");
  }

  async function loadLatest() {
    setBusy(true);
    const fresh = await fetchDailyRecordById(record.id);
    setBusy(false);
    if (!fresh) { setError("The latest version could not be loaded. Your text is still in the boxes."); return; }
    onChanged?.(fresh);
    setFindings(fresh.findings); setRecs(fresh.staffRecommendations); setConflict(false); setError("");
  }

  const edited = editedLine(record);
  return (
    <ModalShell title="Daily Record" onClose={close} wide>
      <div>
        <p className="text-[16px] font-bold text-[#062444]">{record.name}</p>
        <p className="text-[13.5px] text-slate-700">{record.scholarIdNumber}</p>
      </div>
      <dl className="space-y-2 rounded-lg bg-[#f7f9fc] px-3 py-3">
        <Line label="Date visited">{longDay(record.dateVisited)}</Line>
        <Line label="Visit type">{record.visitType}</Line>
        <Line label="Status"><span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-bold uppercase tracking-wide ${STATUS_BADGE[record.status] ?? "bg-slate-100 text-slate-800"}`}>{record.status}</span></Line>
        <Line label="Consulted by">{record.consultedByName || "—"}</Line>
      </dl>
      <dl className="space-y-2 rounded-lg bg-[#f7f9fc] px-3 py-3">
        <Line label="Course">{record.course || "—"}</Line>
        <Line label="Year level">{record.yearLevel || "—"}</Line>
        <Line label="School">{record.school || "—"}</Line>
      </dl>

      {editing ? (
        <div className="space-y-3">
          <p className="text-[13px] text-slate-700">Plain text. Type a dash and a space (- ) or a number and a dot (1.) to make a list. Only you can edit this record; every change is kept in the history.</p>
          <dl><Line label="Failed subject(s)">{record.failedSubjects || "—"}</Line></dl>
          <div>
            <label htmlFor="edit-findings" className="mb-1 block text-[13px] font-semibold text-slate-700">Findings</label>
            <textarea id="edit-findings" value={findings} onChange={e => setFindings(e.target.value)} rows={8} maxLength={EDIT_TEXT_LIMIT} className={`${BOX} resize-y`} />
            <p className="mt-0.5 text-right text-[12px] text-slate-600">{findings.length.toLocaleString("en-US")} / {EDIT_TEXT_LIMIT.toLocaleString("en-US")}</p>
          </div>
          <div>
            <label htmlFor="edit-recs" className="mb-1 block text-[13px] font-semibold text-slate-700">Staff recommendations</label>
            <textarea id="edit-recs" value={recs} onChange={e => setRecs(e.target.value)} rows={8} maxLength={EDIT_TEXT_LIMIT} className={`${BOX} resize-y`} />
            <p className="mt-0.5 text-right text-[12px] text-slate-600">{recs.length.toLocaleString("en-US")} / {EDIT_TEXT_LIMIT.toLocaleString("en-US")}</p>
          </div>
          <div>
            <label htmlFor="edit-reason" className="mb-1 block text-[13px] font-semibold text-slate-700">Reason for the edit <span className="font-normal text-slate-600">(optional)</span></label>
            <input id="edit-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={EDIT_REASON_LIMIT} placeholder="e.g. Added what the scholar told me by phone" className={BOX} />
          </div>
          {error && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13.5px] text-red-800">
              {error}
              {conflict && <button type="button" onClick={() => void loadLatest()} disabled={busy} className="ml-2 font-semibold text-[#00709f] hover:underline disabled:opacity-60">Load the latest text</button>}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={cancelEdit} disabled={busy} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="rounded-lg bg-[#062444] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="space-y-2">
            <Line label="Failed subject(s)">{record.failedSubjects || "—"}</Line>
            <Line label="Findings">{record.findings || "—"}</Line>
            <Line label="Staff recommendations">{record.staffRecommendations || "—"}</Line>
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-700">
            <span>
              {saved && <strong className="mr-2 text-green-800" role="status">{saved}</strong>}
              {edited ? <>{edited} · <button type="button" onClick={() => setShowHistory(true)} className="font-semibold text-[#00709f] hover:underline">View history</button></> : (saved ? null : "Not edited since the visit.")}
            </span>
            {mine && <button type="button" onClick={startEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#062444] hover:bg-[#f7f9fc]"><Pencil size={13} aria-hidden="true" /> Edit</button>}
          </div>
          {!mine && <p className="text-[12.5px] text-slate-600">Only the staff member who wrote this record ({record.consultedByName || "—"}) can edit it.</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={close} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Close</button>
            <button type="button" onClick={onViewProfile} disabled={profileLoading} className="rounded-lg bg-[#062444] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">{profileLoading ? "Loading…" : "View scholar profile"}</button>
          </div>
        </>
      )}
      {showHistory && <DailyRecordHistoryModal recordId={record.id} name={record.name} onClose={() => setShowHistory(false)} />}
    </ModalShell>
  );
}
