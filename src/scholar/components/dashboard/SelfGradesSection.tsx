import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import {
  SELF_GRADES_MAX_IMAGES, SELF_GRADES_MAX_SUBJECTS, SELF_GRADES_WARNING, formatDateTime, selfGradeDifferenceText, selfGradesStatusText, termLabelOf, validateSelfGradeImage,
  type RenewalEvaluation,
} from "@/lib/renewal";
import { fetchMySelfGrades, getSelfGradeImageUrl, submitSelfGrades, type MyRenewalRecord, type MySelfGrades } from "../../renewalApi";

const TONE: Record<"good" | "bad" | "warn" | "plain", string> = {
  good: "bg-green-100 text-green-950 border-green-300", bad: "bg-red-100 text-red-950 border-red-300", warn: "bg-amber-100 text-amber-950 border-amber-300", plain: "bg-slate-100 text-slate-900 border-slate-300",
};
interface Row { code: string; subject: string; units: string; grade: string }
const emptyRow = (): Row => ({ code: "", subject: "", units: "", grade: "" });
const inputCls = "w-full rounded-lg border border-[#062444]/25 px-2.5 py-2 text-[14px] outline-none focus:border-[#062444] bg-white";

/**
 * "Your grades": while the school has not uploaded the grades the renewal looks at, the scholar can enter their own grades (subject code, subject name, units and grade for every
 * subject), upload one or more screenshots, and tick that wrong or false information means disciplinary action or removal from the scholarship. The Grades Approver approves it
 * (the scholar then counts as having complete grades) or returns it; when the school uploads its grades they replace the entered ones. Shown only after the database update is run.
 */
export function SelfGradesSection({ record, ev, scholarIdNumber, onChanged }: { record: MyRenewalRecord; ev: RenewalEvaluation; scholarIdNumber: string; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<MySelfGrades | null>(null);
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [keep, setKeep] = useState<{ name: string; path: string }[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const basis = ev.basis_school_year && ev.basis_term ? termLabelOf(ev.basis_school_year, ev.basis_term) : "the previous semester";

  const load = useCallback(async () => {
    const r = await fetchMySelfGrades(record.id);
    if (!r.ok) { if (r.missing) setHidden(true); return; }
    setData(r.data);
  }, [record.id]);
  useEffect(() => { void load(); }, [load, ev.grades?.self_status, ev.grades?.school_submitted]);

  // little previews of the images already sent
  useEffect(() => {
    let live = true;
    void Promise.all((data?.files ?? []).map(async f => [f.path, await getSelfGradeImageUrl(f.path)] as const)).then(list => { if (live) setThumbs(Object.fromEntries(list.filter(([, u]) => u).map(([p, u]) => [p, u as string]))); });
    return () => { live = false; };
  }, [data?.files]);

  if (hidden || !data) return null;
  const sub = data.submission;
  if (!sub && data.cannotEnterReason) return null;      // for example the school already uploaded: nothing to enter

  function startEditing() {
    setError(""); setAck(false); setNewFiles([]);
    if (data && data.lines.length > 0) { setRows(data.lines.map(l => ({ code: l.code, subject: l.subject, units: String(l.units), grade: l.grade }))); setKeep(data.files); }
    else { setRows([emptyRow()]); setKeep([]); }
    setEditing(true);
  }
  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = [...list]; let count = keep.length + newFiles.length; const accepted: File[] = [];
    for (const f of picked) { const p = validateSelfGradeImage(f, count); if (p) { setError(p); continue; } accepted.push(f); count++; }
    if (accepted.length) { setError(""); setNewFiles(n => [...n, ...accepted]); }
  }
  async function send() {
    setBusy(true); setError("");
    const r = await submitSelfGrades({ recordId: record.id, scholarIdNumber, lines: rows, newFiles, keepFiles: keep, acknowledged: ack });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEditing(false); await load(); await onChanged();
  }

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
          <p>Enter every subject of {basis}, exactly as in your screenshot.</p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-[#e6ecf5] bg-white p-2 sm:grid-cols-[8rem_1fr_5rem_6rem_auto]">
                <input value={r.code} onChange={e => setRow(i, { code: e.target.value })} placeholder="Subject code" aria-label={`Subject ${i + 1} code`} maxLength={30} className={inputCls} />
                <input value={r.subject} onChange={e => setRow(i, { subject: e.target.value })} placeholder="Subject name" aria-label={`Subject ${i + 1} name`} maxLength={150} className={`${inputCls} col-span-2 sm:col-span-1`} />
                <input value={r.units} onChange={e => setRow(i, { units: e.target.value })} placeholder="Units" aria-label={`Subject ${i + 1} units`} inputMode="decimal" maxLength={5} className={inputCls} />
                <input value={r.grade} onChange={e => setRow(i, { grade: e.target.value })} placeholder="Grade" aria-label={`Subject ${i + 1} grade`} maxLength={12} className={inputCls} />
                <button onClick={() => setRows(rs => (rs.length === 1 ? [emptyRow()] : rs.filter((_, j) => j !== i)))} aria-label={`Remove subject ${i + 1}`} className="flex items-center justify-center rounded-lg border border-[#062444]/25 px-2 text-[#062444] hover:bg-[#f7f9fc]"><Trash2 size={15} aria-hidden="true" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setRows(rs => [...rs, emptyRow()])} disabled={rows.length >= SELF_GRADES_MAX_SUBJECTS} className="inline-flex items-center gap-1.5 font-semibold text-[#00709f] hover:underline disabled:opacity-50"><Plus size={14} aria-hidden="true" /> Add a subject</button>

          <div>
            <p className="font-semibold text-[#062444]">Screenshot or image of your grades</p>
            <p className="text-[13.5px] text-slate-700">Upload at least one clear JPG, PNG or WEBP image (up to {SELF_GRADES_MAX_IMAGES}, 10 MB each) that shows your grades.</p>
            <ul className="mt-1 space-y-1">
              {keep.map(f => <li key={f.path} className="flex items-center justify-between gap-2 rounded-md border border-[#e6ecf5] bg-white px-2 py-1"><span className="break-all">{f.name} (already sent)</span><button onClick={() => setKeep(k => k.filter(x => x.path !== f.path))} aria-label={`Remove ${f.name}`} className="font-semibold text-red-800">Remove</button></li>)}
              {newFiles.map((f, i) => <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-[#e6ecf5] bg-white px-2 py-1"><span className="break-all">{f.name}</span><button onClick={() => setNewFiles(n => n.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="font-semibold text-red-800">Remove</button></li>)}
            </ul>
            <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">
              <ImagePlus size={15} aria-hidden="true" /> Add an image
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-950">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            <span>{SELF_GRADES_WARNING}</span>
          </label>
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => void send()} disabled={busy || !ack} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 font-bold text-white disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Send my grades for approval
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 font-semibold text-[#062444]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
