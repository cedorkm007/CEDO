import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDraft, savedAtText, useDraftAutosave } from "@/lib/formDraft";
import { sanitizeSelfGradesDraft, selfGradesDraftHasContent, selfGradesDraftKey, type SelfGradesDraft } from "../../renewalDraft";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { formatDateTime, selfGradeDifferenceText, selfGradesStatusText, termLabelOf, type RenewalEvaluation } from "@/lib/renewal";
import { SelfGradesForm, emptyGradeRow, type GradeFormRow } from "./SelfGradesForm";
import { rowsWithWarnings } from "@/lib/gradeCheck";
import { useMyGradeRules } from "../../useMyGradeRules";
import { fetchMySelfGrades, getSelfGradeImageUrl, submitSelfGrades, type MyRenewalRecord, type MySelfGrades } from "../../renewalApi";
import { useLiveReload } from "@/lib/liveUpdates";

const TONE: Record<"good" | "bad" | "warn" | "plain", string> = {
  good: "bg-green-100 text-green-950 border-green-300", bad: "bg-red-100 text-red-950 border-red-300", warn: "bg-amber-100 text-amber-950 border-amber-300", plain: "bg-slate-100 text-slate-900 border-slate-300",
};

/**
 * "Your grades": while the school has not uploaded the grades the renewal looks at, the scholar can enter their own grades (subject code, subject name, units and grade for every
 * subject), upload one or more screenshots, and tick that wrong or false information means disciplinary action or removal from the scholarship. The Grades Approver approves it
 * (the scholar then counts as having complete grades) or returns it; when the school uploads its grades they replace the entered ones. Shown only after the database update is run.
 */
export function SelfGradesSection({ record, ev, scholarIdNumber, onChanged }: { record: MyRenewalRecord; ev: RenewalEvaluation; scholarIdNumber: string; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<MySelfGrades | null>(null);
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<GradeFormRow[]>([emptyGradeRow()]);
  const [keep, setKeep] = useState<{ name: string; path: string }[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [ack, setAck] = useState(false);
  const gradeRules = useMyGradeRules();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const basis = ev.basis_school_year && ev.basis_term ? termLabelOf(ev.basis_school_year, ev.basis_term) : "the previous semester";

  const load = useCallback(async () => {
    const r = await fetchMySelfGrades(record.id);
    if (!r.ok) { if (r.missing) setHidden(true); return; }
    setData(prev => (prev && JSON.stringify(prev) === JSON.stringify(r.data) ? prev : r.data));      // same answer: keep what is on screen
  }, [record.id]);
  useEffect(() => { void load(); }, [load, ev.grades?.self_status, ev.grades?.school_submitted]);
  useLiveReload(load);

  // little previews of the images already sent
  useEffect(() => {
    let live = true;
    void Promise.all((data?.files ?? []).map(async f => [f.path, await getSelfGradeImageUrl(f.path)] as const)).then(list => { if (live) setThumbs(Object.fromEntries(list.filter(([, u]) => u).map(([p, u]) => [p, u as string]))); });
    return () => { live = false; };
  }, [data?.files]);

  // Auto-save: what the scholar types and picks while entering grades is kept on this device, so it is not lost when they leave the page, reload it or cancel.
  const draftKey = selfGradesDraftKey(scholarIdNumber, record.id);
  const [touched, setTouched] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const checkedDraft = useRef(false);
  const snapshot = useMemo<SelfGradesDraft | null>(() => (editing && touched ? { rows, keep, newFiles, ack } : null), [editing, touched, rows, keep, newFiles, ack]);
  const draft = useDraftAutosave<SelfGradesDraft>(draftKey, snapshot);
  const canEnterNow = !!data && !(data.submission == null && data.cannotEnterReason) && data.submission?.status !== "approved" && !ev.grades?.school_submitted;

  function applyDraft(d: SelfGradesDraft, savedAt: number) {
    const sent = new Set((data?.files ?? []).map(f => f.path));
    setRows(d.rows); setKeep(d.keep.filter(k => sent.has(k.path))); setNewFiles(d.newFiles); setAck(d.ack);
    setError(""); setTouched(true); setRestoredAt(savedAt); setEditing(true);
  }
  // when the section opens: bring back an unsent draft (or drop it when grades can no longer be entered)
  useEffect(() => {
    if (!data || checkedDraft.current) return;
    checkedDraft.current = true;
    void loadDraft<unknown>(draftKey).then(async r => {
      const d = r ? sanitizeSelfGradesDraft(r.value) : null;
      if (!r || !d || !selfGradesDraftHasContent(d)) return;
      if (!canEnterNow) { await draft.discard(); return; }
      applyDraft(d, r.savedAt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (hidden || !data) return null;
  const sub = data.submission;
  if (!sub && data.cannotEnterReason) return null;      // for example the school already uploaded: nothing to enter

  async function startEditing() {
    setError(""); setAck(false); setNewFiles([]); setTouched(false); setRestoredAt(null);
    const found = await loadDraft<unknown>(draftKey);      // a draft the scholar left (Cancel keeps it) comes back
    const d = found ? sanitizeSelfGradesDraft(found.value) : null;
    if (found && d && selfGradesDraftHasContent(d)) { applyDraft(d, found.savedAt); return; }
    if (data && data.lines.length > 0) { setRows(data.lines.map(l => ({ code: l.code, subject: l.subject, units: String(l.units), grade: l.grade }))); setKeep(data.files); }
    else { setRows([emptyGradeRow()]); setKeep([]); }
    setEditing(true);
  }
  async function send() {
    setBusy(true); setError("");
    const r = await submitSelfGrades({ recordId: record.id, scholarIdNumber, lines: rows, newFiles, keepFiles: keep, acknowledged: ack });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await draft.discard();      // sent: the saved draft is no longer needed
    setEditing(false); setTouched(false); await load(); await onChanged();
  }
  async function cancelEditing() { await draft.saveNow(); setEditing(false); }      // Cancel closes the form but keeps what was typed
  async function startOver() {
    if (!window.confirm("Start over? What you typed and the pictures you picked will be removed.")) return;
    await draft.discard(); setEditing(false); setTouched(false); setRestoredAt(null);
  }
  const rowsChanged = (r: GradeFormRow[]) => { setRows(r); setTouched(true); };
  const keepChanged = (k: { name: string; path: string }[]) => { setKeep(k); setTouched(true); };
  const filesChanged = (f: File[]) => { setNewFiles(f); setTouched(true); };
  const ackChanged = (a: boolean) => { setAck(a); setTouched(true); };

  const st = sub ? selfGradesStatusText(sub.status) : null;
  const diffs = sub?.differences ?? null;
  return (
    <div className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3 text-[14px] text-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold text-[#062444]">Your grades for {basis}</p>
        {st && <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${TONE[st.tone]}`}>{st.text}</span>}
      </div>

      {!editing && !sub && (
        <>
          <p className="mt-1.5">Your school has not uploaded your grades yet. You do not have to wait: you can enter your grades yourself, with a screenshot of them. The Grades Approver checks them, and once they are approved you count as having complete grades. When your school uploads its grades, they replace the ones you entered and are compared with them.</p>
          <button onClick={startEditing} className="mt-2 rounded-lg bg-[#062444] px-4 py-2 font-bold text-white">Enter my grades</button>
        </>
      )}

      {!editing && sub && (
        <div className="mt-1.5">
          {sub.status === "pending" && <p>You sent these grades on {formatDateTime(sub.submittedAt)}. Your renewal waits until the Grades Approver checks them against your screenshot.</p>}
          {sub.status === "approved" && <p className="flex items-start gap-1.5 text-green-900"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> Approved{sub.decidedAt ? ` on ${formatDateTime(sub.decidedAt)}` : ""}. You count as having complete grades{ev.grades?.school_submitted ? "" : " until your school uploads its own grades"}.{sub.note ? ` Note: ${sub.note}` : ""}</p>}
          {sub.status === "returned" && <p className="flex items-start gap-1.5 text-red-900"><XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> The Grades Approver returned your grades. Reason: {sub.note || "not given"}. Please correct them and send them again.</p>}
          {data.lines.length > 0 && (
            <table className="mt-2 w-full text-left text-[14px]">
              <thead className="text-[#062444]"><tr><th scope="col" className="py-1 pr-2 font-bold">Code</th><th scope="col" className="py-1 pr-2 font-bold">Subject</th><th scope="col" className="py-1 pr-2 text-right font-bold">Units</th><th scope="col" className="py-1 text-right font-bold">Grade</th></tr></thead>
              <tbody>{data.lines.map(l => <tr key={l.code} className="border-t border-[#e6ecf5]"><td className="py-1 pr-2">{l.code}</td><td className="py-1 pr-2 break-words">{l.subject}</td><td className="py-1 pr-2 text-right">{l.units}</td><td className="py-1 text-right font-semibold">{l.grade}</td></tr>)}</tbody>
            </table>
          )}
          {data.files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{data.files.map(f => (thumbs[f.path] ? <a key={f.path} href={thumbs[f.path]} target="_blank" rel="noreferrer" aria-label={`Open ${f.name}`}><img src={thumbs[f.path]} alt={f.name} className="h-16 w-16 rounded-md border border-[#e6ecf5] object-cover" /></a> : <span key={f.path} className="rounded-md border border-[#e6ecf5] px-2 py-1 text-[13px]">{f.name}</span>))}</div>}
          {sub.officialCheckedAt && (
            <div className={`mt-2 rounded-md border px-2.5 py-2 ${diffs && diffs.length > 0 ? "border-amber-300 bg-amber-50 text-amber-950" : "border-green-300 bg-green-50 text-green-950"}`}>
              <p className="font-semibold">Your school uploaded its grades on {formatDateTime(sub.officialCheckedAt)}; the school's grades are the ones that count now.</p>
              {diffs && diffs.length === 0 && <p>They match the grades you entered.</p>}
              {diffs && diffs.length > 0 && <><p>{diffs.length} subject{diffs.length === 1 ? "" : "s"} differ from what you entered. The evaluator will review the differences.</p><ul className="mt-1 list-disc pl-5">{diffs.map((d, i) => <li key={i}>{selfGradeDifferenceText(d)}</li>)}</ul></>}
            </div>
          )}
          {(sub.status === "pending" || sub.status === "returned") && !ev.grades?.school_submitted && (
            <button onClick={startEditing} className="mt-2 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">{sub.status === "returned" ? "Correct and send again" : "Change and send again"}</button>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-2 space-y-3">
          {restoredAt && <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">We brought back what you had already typed (saved {new Date(restoredAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}).</p>}
          <p data-testid="draft-status" className="flex flex-wrap items-center gap-x-3 text-[13px] text-slate-600" aria-live="polite">
            <span>Your progress is saved on this device as you go.{touched && draft.savedAt ? ` ${savedAtText(draft.savedAt)}.` : ""}</span>
            {touched && <button type="button" onClick={() => void startOver()} disabled={busy} className="font-semibold text-red-800 underline">Start over</button>}
          </p>
          <SelfGradesForm basis={basis} rows={rows} setRows={rowsChanged} keep={keep} setKeep={keepChanged} newFiles={newFiles} setNewFiles={filesChanged} ack={ack} setAck={ackChanged} onError={setError} />
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void send()} disabled={busy || !ack || rowsWithWarnings(rows, gradeRules).length > 0} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 font-bold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Send my grades for approval
            </button>
            <button onClick={() => void cancelEditing()} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 font-semibold text-[#062444]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
