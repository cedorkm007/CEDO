import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { RecordColumns, RecordModalShell } from "./RecordModalShell";
import { RecordSideSummary } from "./RecordSideSummary";
import { RecordTextArea } from "./RecordTextArea";
import { QuickPhrasesManager, useQuickPhrases } from "./QuickPhrases";
import { useRecordDraft } from "./useRecordDraft";
import { DailyRecordHistoryModal } from "./DailyRecordHistoryModal";
import { fetchDailyRecordById, updateDailyRecord, type DailyRecord } from "../scholarCounselingApi";
import { canEditRecord, editChanged, editedLine, EDIT_REASON_LIMIT, textProblem } from "@/lib/dailyRecordEdit";
import { draftKey, savedAtLabel } from "@/lib/recordPopup";

const STATUS_BADGE: Record<string, string> = {
  Regular: "bg-green-100 text-green-800", Probationary: "bg-red-100 text-red-700", "On leave": "bg-amber-100 text-amber-800", Reconsidered: "bg-blue-100 text-blue-800", Removed: "bg-slate-200 text-slate-700",
};
const longDay = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—");
const FIELD = "w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-[#0088cc]";
const GHOST = "rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60";
const SOLID = "rounded-lg bg-[#062444] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-[14px] text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * The record's window (Consultation Tool > Daily Records > the eye button): everything about one visit, with the scholar's details and previous visits beside it (see RecordSideSummary).
 * It opens READ-ONLY. The staff member who WROTE the record also sees an "Edit" button: it makes the Findings and the Staff recommendations editable (plain text, up to 20,000 characters each, with an
 * optional reason, and a "Insert…" menu of quick phrases). Every saved edit is kept in a history that can only be added to ("View history"). Nobody else can edit: the database refuses, this only hides the button.
 * What is typed and not yet saved is kept as a DRAFT (this tab at once, the database after a few seconds) and offered back after a refresh. Ctrl+S (Cmd+S) saves; closing with unsaved changes asks first.
 * `onChanged` hands the saved record back so the list row updates without reloading the list.
 */
export function DailyRecordDetailModal({ record, meId, onClose, onViewProfile, profileLoading, onChanged, initialEditing = false, onEditingChange }: {
  record: DailyRecord; meId?: string | null; onClose: () => void; onViewProfile: () => void; profileLoading: boolean; onChanged?: (r: DailyRecord) => void;
  /** Opened from an address that says "edit" (a refresh while editing): it starts in edit mode, but only for the writer. */
  initialEditing?: boolean; onEditingChange?: (editing: boolean) => void;
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
  const [showPhrases, setShowPhrases] = useState(false);
  const { phrases, reload } = useQuickPhrases(mine);
  const dirty = editing && editChanged(record, findings, recs);

  const draft = useRecordDraft({
    draftName: mine ? draftKey.edit(record.id) : null,
    values: { findings, recs, reason },
    baseline: { findings: record.findings, recs: record.staffRecommendations, reason: "" },
    base: record.editCount,
  });

  function startEdit() { setFindings(record.findings); setRecs(record.staffRecommendations); setReason(""); setError(""); setConflict(false); setSaved(""); setEditing(true); }
  function leaveEdit() { setEditing(false); setError(""); setConflict(false); }
  function applyDraft() {
    const p = draft.restore();
    if (!p) return;
    setFindings(String(p.values.findings ?? "")); setRecs(String(p.values.recs ?? "")); setReason(String(p.values.reason ?? ""));
    setError(""); setConflict(false); setSaved(""); setEditing(true);
  }
  function discardChanges() { void draft.clear(); setFindings(record.findings); setRecs(record.staffRecommendations); setReason(""); leaveEdit(); }
  function cancelEdit() { if (dirty && !window.confirm("Discard changes?\n\nYour writing in this record will be thrown away.")) return; discardChanges(); }
  function close() { if (dirty && !window.confirm("Discard changes?\n\nYour writing in this record will be thrown away.")) return; if (dirty) void draft.clear(); onClose(); }

  async function save() {
    if (!editing || busy) return;
    const problem = textProblem(findings, recs, reason);
    if (problem) { setError(problem); return; }
    if (!dirty) { leaveEdit(); return; }
    setBusy(true); setError(""); setConflict(false);
    const r = await updateDailyRecord(record.id, findings, recs, reason, record.editCount);
    setBusy(false);
    if (r.ok) {
      void draft.clear();
      onChanged?.({ ...record, findings: findings.trim(), staffRecommendations: recs.trim(), editCount: r.editCount, lastEditedAt: r.lastEditedAt ?? record.lastEditedAt, editedByName: r.editedByName || record.editedByName });
      setEditing(false); setSaved("Saved");
      return;
    }
    if (r.conflict) { setConflict(true); setError("This record was changed in another window after you opened it, so nothing was saved. Your text is still in the boxes."); return; }
    setError(r.missing ? "Editing needs the latest database update (supabase_migration_daily_records_edit.sql). Ask the IT admin to run it." : r.error || "The record could not be saved. Your text is still in the boxes (and kept as a draft): try again.");
  }
  // the address says "edit": start editing once we know this is the writer (anybody else stays read-only and the address is cleaned)
  const startedFromAddress = useRef(false);
  useEffect(() => {
    if (!initialEditing || startedFromAddress.current || !meId) return;
    startedFromAddress.current = true;
    if (mine) startEdit(); else onEditingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditing, meId, mine]);
  // tell the address when editing starts or ends
  const lastEditing = useRef(editing);
  useEffect(() => {
    if (lastEditing.current === editing) return;
    lastEditing.current = editing;
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);
  // Ctrl+S (Cmd+S on a Mac) saves while editing
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  async function loadLatest() {
    setBusy(true);
    const fresh = await fetchDailyRecordById(record.id);
    setBusy(false);
    if (!fresh) { setError("The latest version could not be loaded. Your text is still in the boxes."); return; }
    onChanged?.(fresh);
    setFindings(fresh.findings); setRecs(fresh.staffRecommendations); setConflict(false); setError("");
  }

  const edited = editedLine(record);
  const p = draft.pending;
  const staleDraft = !!p && p.base !== null && p.base !== record.editCount;

  const footer = editing ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[13px] text-slate-700" role="status">{draft.status || "Ctrl+S saves"}</p>
      <div className="flex gap-2">
        <button type="button" onClick={cancelEdit} disabled={busy} className={GHOST}>Cancel</button>
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={SOLID}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[13px] text-slate-700">
        {saved && <strong className="mr-2 text-green-800" role="status">{saved}</strong>}
        {edited ? <>{edited} · <button type="button" onClick={() => setShowHistory(true)} className="font-semibold text-[#00709f] hover:underline">View history</button></> : (saved ? null : "Not edited since the visit.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={close} className={GHOST}>Close</button>
        <button type="button" onClick={onViewProfile} disabled={profileLoading} className={GHOST}>{profileLoading ? "Loading…" : "View scholar profile"}</button>
        {mine && <button type="button" onClick={startEdit} className={`${SOLID} inline-flex items-center gap-1.5`}><Pencil size={13} aria-hidden="true" /> Edit</button>}
      </div>
    </div>
  );

  return (
    <RecordModalShell title={`Daily Record · ${record.name}`} subtitle={`${record.scholarIdNumber} · ${longDay(record.dateVisited)}`} onClose={close} footer={footer} closeOnEscape={!showHistory && !showPhrases}>
      <RecordColumns summaryLabel="Scholar and previous visits" summary={<RecordSideSummary scholarIdNumber={record.scholarIdNumber} excludeRecordId={record.id} />}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-[#f7f9fc] px-4 py-3 xl:grid-cols-4">
          <Fact label="Date visited">{longDay(record.dateVisited)}</Fact>
          <Fact label="Visit type">{record.visitType}</Fact>
          <Fact label="Status at the visit"><span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-bold uppercase tracking-wide ${STATUS_BADGE[record.status] ?? "bg-slate-100 text-slate-800"}`}>{record.status}</span></Fact>
          <Fact label="Consulted by">{record.consultedByName || "—"}</Fact>
          <Fact label="Failed subject(s)">{record.failedSubjects || "—"}</Fact>
        </dl>

        {p && mine && (
          <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-950">
            <p><strong>You have an unsaved draft from {savedAtLabel(p.savedAt) || "earlier"}.</strong>{staleDraft ? " This record was saved again after the draft was started: restoring it replaces the newer text in the boxes." : ""}</p>
            <details className="mt-1"><summary className="cursor-pointer text-[13px] font-semibold text-[#00709f]">Read the draft</summary>
              <p className="mt-1 whitespace-pre-wrap break-words"><strong>Findings:</strong> {String(p.values.findings ?? "") || "—"}</p>
              <p className="mt-1 whitespace-pre-wrap break-words"><strong>Staff recommendations:</strong> {String(p.values.recs ?? "") || "—"}</p>
            </details>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={applyDraft} className={SOLID}>{editing ? "Restore the draft" : "Continue editing the draft"}</button>
              <button type="button" onClick={() => { if (window.confirm("Throw this draft away?")) void draft.clear(); }} className={GHOST}>Discard the draft</button>
            </div>
          </div>
        )}

        {editing ? (
          <div className="space-y-4">
            <p className="text-[13px] text-slate-700">Plain text. Type a dash and a space (- ) or a number and a dot (1.) to make a list. Only you can edit this record; every change is kept in the history.</p>
            <RecordTextArea id="edit-findings" label="Findings" value={findings} onChange={setFindings} phrases={phrases} onEditPhrases={() => setShowPhrases(true)} />
            <RecordTextArea id="edit-recs" label="Staff recommendations" value={recs} onChange={setRecs} phrases={phrases} onEditPhrases={() => setShowPhrases(true)} />
            <div>
              <label htmlFor="edit-reason" className="mb-1 block text-[13.5px] font-bold text-slate-800">Reason for the edit <span className="font-normal text-slate-600">(optional)</span></label>
              <input id="edit-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={EDIT_REASON_LIMIT} placeholder="e.g. Added what the scholar told me by phone" className={FIELD} />
            </div>
            {error && (
              <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13.5px] text-red-800">
                {error}
                {conflict && <button type="button" onClick={() => void loadLatest()} disabled={busy} className="ml-2 font-semibold text-[#00709f] hover:underline disabled:opacity-60">Load the latest text</button>}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-[13.5px] font-bold text-slate-800">Findings</p>
              <p className="min-h-[4rem] whitespace-pre-wrap break-words rounded-lg border border-[#e6ecf5] px-3 py-2 text-[14.5px] leading-relaxed text-slate-900">{record.findings || "—"}</p>
            </div>
            <div>
              <p className="mb-1 text-[13.5px] font-bold text-slate-800">Staff recommendations</p>
              <p className="min-h-[4rem] whitespace-pre-wrap break-words rounded-lg border border-[#e6ecf5] px-3 py-2 text-[14.5px] leading-relaxed text-slate-900">{record.staffRecommendations || "—"}</p>
            </div>
            {!mine && <p className="text-[12.5px] text-slate-600">Only the staff member who wrote this record ({record.consultedByName || "—"}) can edit it.</p>}
          </div>
        )}
      </RecordColumns>
      {showHistory && <DailyRecordHistoryModal recordId={record.id} name={record.name} onClose={() => setShowHistory(false)} />}
      {showPhrases && phrases && <QuickPhrasesManager phrases={phrases} onChanged={() => void reload()} onClose={() => setShowPhrases(false)} />}
    </RecordModalShell>
  );
}
