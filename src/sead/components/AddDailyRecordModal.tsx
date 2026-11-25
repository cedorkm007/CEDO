import { useEffect, useRef, useState } from "react";
import { createDailyRecord, VISIT_TYPES, type VisitType } from "../scholarCounselingApi";
import { saveConsultationRecord, type AttendedPrefill } from "../appointmentsApi";
import { formatDay } from "@/lib/renewal";
import { fetchScholarInformationByIdNumber } from "../seadApi";
import { SCHOLARSHIP_STATUSES, type ScholarshipStatus } from "../types";
import { ScholarSearchField, type ScholarSearchResult } from "./ScholarSearchField";
import { RecordColumns, RecordModalShell } from "./RecordModalShell";
import { RecordSideSummary } from "./RecordSideSummary";
import { RecordTextArea } from "./RecordTextArea";
import { QuickPhrasesManager, useQuickPhrases } from "./QuickPhrases";
import { useRecordDraft } from "./useRecordDraft";
import { differsFrom, draftKey, savedAtLabel } from "@/lib/recordPopup";

const FIELD = "w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-[#0088cc]";
const LABEL = "mb-1 block text-[13px] font-semibold text-slate-700";
const GHOST = "rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60";

/**
 * The Daily Record form, in the large pop-up (it adjusts to the screen; see RecordModalShell). The scholar's details and previous visits are on the left while the findings and the staff recommendations are written
 * in large boxes on the right, with an "Insert…" menu of quick phrases. Opened from the Appointments calendar after "Attended", it arrives PRE-FILLED (`prefill`): the scholar, the date, the
 * status and the failed / INC subjects are copied from the renewal, and two renewal fields appear — the "INC deadline" (a date after the consultation date,
 * required when an INC has no deadline yet) next to the findings and recommendations, and, for Summer, "Prospectus hard copy received". Those fields work exactly as before.
 * What is typed and not yet saved is kept as a DRAFT for that scholar (or that appointment) and offered back; Ctrl+S (Cmd+S) saves; closing with unsaved writing asks first.
 */
export function AddDailyRecordModal({ onClose, onCreated, prefill }: { onClose: () => void; onCreated: () => void; prefill?: AttendedPrefill }) {
  const today = new Date().toISOString().slice(0, 10);
  const initialStatus = (prefill?.status as ScholarshipStatus) || "Regular";
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ScholarSearchResult | null>(null);
  const [dateVisited, setDateVisited] = useState(prefill?.dateVisited || today);
  const [status, setStatus] = useState<ScholarshipStatus>(initialStatus);
  const [baseStatus, setBaseStatus] = useState<ScholarshipStatus>(initialStatus);      // the status the scholar already has: choosing a scholar sets it, and that alone is not "something typed"
  const [visitType, setVisitType] = useState<VisitType>("Office");
  const [failedSubjects, setFailedSubjects] = useState(prefill?.failedSubjects ?? "");
  const [incDeadline, setIncDeadline] = useState("");
  const [hardCopy, setHardCopy] = useState(false);
  const needsDeadline = !!prefill && prefill.incItems.some(i => !i.deadline);
  const dayAfterVisit = dateVisited ? new Date(new Date(`${dateVisited}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) : "";
  const [findings, setFindings] = useState("");
  const [staffRecommendations, setStaffRecommendations] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPhrases, setShowPhrases] = useState(false);
  const { phrases, reload } = useQuickPhrases();

  const scholarId = prefill?.scholarIdNumber ?? selected?.scholarIdNumber ?? null;
  const values = { dateVisited, status, visitType, failedSubjects, incDeadline, hardCopy, findings, staffRecommendations };
  const baseline = { dateVisited: prefill?.dateVisited || today, status: baseStatus, visitType: "Office", failedSubjects: prefill?.failedSubjects ?? "", incDeadline: "", hardCopy: false, findings: "", staffRecommendations: "" };
  const draft = useRecordDraft({ draftName: prefill ? draftKey.slot(prefill.slotId) : selected ? draftKey.newFor(selected.scholarIdNumber) : null, values, baseline, base: null });
  const dirty = differsFrom(values, baseline);

  async function handleSelectScholar(r: ScholarSearchResult) {
    setSelected(r);
    // Prefill Status from the scholar's current scholarship status — this
    // field is a monitoring snapshot, not an action, so every status
    // (including Removed) is a valid value here, unlike other status
    // dropdowns in the app. Staff can still adjust it.
    const info = await fetchScholarInformationByIdNumber(r.scholarIdNumber);
    if (info) { setStatus(info.status); setBaseStatus(info.status); }
  }

  function applyDraft() {
    const p = draft.restore();
    if (!p) return;
    const v = p.values, str = (x: unknown, d = "") => (typeof x === "string" ? x : d);
    setDateVisited(str(v.dateVisited, dateVisited)); setStatus(str(v.status, status) as ScholarshipStatus); setVisitType(str(v.visitType, visitType) as VisitType);
    setFailedSubjects(str(v.failedSubjects)); setIncDeadline(str(v.incDeadline)); setHardCopy(v.hardCopy === true);
    setFindings(str(v.findings)); setStaffRecommendations(str(v.staffRecommendations));
  }

  function close() {
    if (dirty && !window.confirm("Discard changes?\n\nThe record has not been saved. Your writing will be thrown away.")) return;
    if (dirty) void draft.clear();
    onClose();
  }

  async function submit() {
    if (busy) return;
    setError("");
    if (prefill) {
      if (needsDeadline && (!incDeadline || incDeadline < dayAfterVisit)) { setError("Choose the INC deadline: a date after the consultation date."); return; }
      setBusy(true);
      const r = await saveConsultationRecord({
        slotId: prefill.slotId, scholarIdNumber: prefill.scholarIdNumber, status, dateVisited, visitType, failedSubjects: failedSubjects.trim(), findings: findings.trim(),
        staffRecommendations: staffRecommendations.trim(), incDeadline: needsDeadline ? incDeadline : null, hardCopy: prefill.isSummer ? hardCopy : null,
      });
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      void draft.clear();
      onCreated();
      onClose();
      return;
    }
    const scholarIdNumber = selected?.scholarIdNumber ?? query.trim();
    if (!scholarIdNumber) { setError("Enter or pick a scholar."); return; }
    if (!dateVisited) { setError("Enter the date visited."); return; }
    setBusy(true);
    const result = await createDailyRecord({
      scholarIdNumber, status, dateVisited, visitType,
      failedSubjects: failedSubjects.trim(), findings: findings.trim(), staffRecommendations: staffRecommendations.trim(),
    });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save this record — check the Scholar ID exists. Your writing is kept as a draft."); return; }
    void draft.clear();
    onCreated();
    onClose();
  }
  // Ctrl+S (Cmd+S on a Mac) saves
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void submitRef.current(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const p = draft.pending;
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[13px] text-slate-700" role="status">{draft.status || (scholarId ? "Ctrl+S saves" : "Choose the scholar first: your writing is then kept as a draft")}</p>
      <div className="flex gap-2">
        <button type="button" onClick={close} disabled={busy} className={GHOST}>Cancel</button>
        <button type="submit" form="add-record-form" disabled={busy}
          className="rounded-lg bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-5 py-2 text-[13.5px] font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : "Save Record"}
        </button>
      </div>
    </div>
  );

  return (
    <RecordModalShell title="Add Daily Record" subtitle={prefill ? `${prefill.scholarName} · renewal for ${prefill.termLabel}` : undefined} onClose={close} footer={footer} closeOnEscape={!showPhrases}>
      <RecordColumns summaryLabel="Scholar and previous visits" summary={<RecordSideSummary scholarIdNumber={scholarId} />}>
        <form id="add-record-form" onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-4">
          <div>
            <label className={LABEL}>Scholar</label>
            {prefill ? (
              <p className="rounded-lg border border-[#062444]/15 bg-[#f7f9fc] px-3 py-2 text-sm text-[#062444]"><strong>{prefill.scholarName}</strong> · {prefill.scholarIdNumber} · renewal for {prefill.termLabel}</p>
            ) : (
              <ScholarSearchField query={query} setQuery={v => { setQuery(v); setSelected(null); }} selected={selected}
                onSelect={handleSelectScholar} onClear={() => setSelected(null)} filter={{ includeRemoved: true }} />
            )}
          </div>

          {p && (
            <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-950">
              <p><strong>You have an unsaved draft from {savedAtLabel(p.savedAt) || "earlier"}{prefill ? " for this appointment" : " for this scholar"}.</strong></p>
              <details className="mt-1"><summary className="cursor-pointer text-[13px] font-semibold text-[#00709f]">Read the draft</summary>
                <p className="mt-1 whitespace-pre-wrap break-words"><strong>Findings:</strong> {String(p.values.findings ?? "") || "—"}</p>
                <p className="mt-1 whitespace-pre-wrap break-words"><strong>Staff recommendations:</strong> {String(p.values.staffRecommendations ?? "") || "—"}</p>
              </details>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={applyDraft} className="rounded-lg bg-[#062444] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[#0a3a6e]">Restore the draft</button>
                <button type="button" onClick={() => { if (window.confirm("Throw this draft away?")) void draft.clear(); }} className={GHOST}>Discard the draft</button>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label htmlFor="add-date" className={LABEL}>Date Visited</label>
              <input id="add-date" type="date" value={dateVisited} onChange={e => setDateVisited(e.target.value)} required className={FIELD} />
            </div>
            <div>
              <label htmlFor="add-status" className={LABEL}>Status</label>
              <select id="add-status" value={status} onChange={e => setStatus(e.target.value as ScholarshipStatus)} className={FIELD}>
                {SCHOLARSHIP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="add-visit" className={LABEL}>Visit Type</label>
              <select id="add-visit" value={visitType} onChange={e => setVisitType(e.target.value as VisitType)} className={FIELD}>
                {VISIT_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="add-failed" className={LABEL}>Failed Subject(s)</label>
              <input id="add-failed" value={failedSubjects} onChange={e => setFailedSubjects(e.target.value)} placeholder="e.g. Calculus 2, Physics 1" className={FIELD} />
            </div>
          </div>

          {needsDeadline && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
              <label htmlFor="inc-deadline" className="block text-[13px] font-bold text-amber-950 mb-1.5">INC deadline — required</label>
              <input id="inc-deadline" type="date" min={dayAfterVisit} value={incDeadline} onChange={e => setIncDeadline(e.target.value)} required
                className="w-48 border border-[#062444]/25 rounded-lg px-3 py-2 text-sm outline-none bg-white" />
              <p className="text-[13px] text-amber-950 mt-1.5">
                INC subject{prefill!.incItems.length > 1 ? "s" : ""}: {prefill!.incItems.map(i => i.subject).join(", ")}.
                {incDeadline && incDeadline >= dayAfterVisit
                  ? <> The scholar will be told to complete the INC by <strong>{formatDay(incDeadline)}</strong> ({Math.round((Date.parse(`${incDeadline}T00:00:00Z`) - Date.parse(`${dateVisited}T00:00:00Z`)) / 86400000)} days after the consultation).</>
                  : " Choose a date after the consultation date; it is the last day for the scholar to complete the INC."}
              </p>
            </div>
          )}
          {prefill?.isSummer && (
            <label className="flex items-center gap-2 text-[13.5px] font-semibold text-[#062444]">
              <input type="checkbox" checked={hardCopy} onChange={e => setHardCopy(e.target.checked)} /> Prospectus hard copy received
            </label>
          )}

          <RecordTextArea id="add-findings" label="Findings" value={findings} onChange={setFindings} phrases={phrases} onEditPhrases={() => setShowPhrases(true)} />
          <RecordTextArea id="add-recs" label="Staff Recommendations" value={staffRecommendations} onChange={setStaffRecommendations} phrases={phrases} onEditPhrases={() => setShowPhrases(true)} />

          {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13.5px] text-red-800">{error}</p>}
        </form>
      </RecordColumns>
      {showPhrases && phrases && <QuickPhrasesManager phrases={phrases} onChanged={() => void reload()} onClose={() => setShowPhrases(false)} />}
    </RecordModalShell>
  );
}
