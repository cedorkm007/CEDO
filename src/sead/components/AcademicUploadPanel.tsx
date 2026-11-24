import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, RotateCcw, Upload } from "lucide-react";
import { readXlsx, buildXlsx } from "@/lib/xlsxLite";
import {
  UPLOAD_CHUNK, UPLOAD_HEADERS, UPLOAD_INSTRUCTIONS, UPLOAD_MAX_MB, UPLOAD_MAX_ROWS, UPLOAD_SQL, errorReportRows, findDuplicates, parseDelimited, parseUploadGrid, resultText, statusWord, summaryText, uploadTotals,
  type ParsedUpload, type UploadChecked, type UploadRow,
} from "@/lib/academicUpload";
import { applyChunk, checkChunk, fetchTemplateRows, finishUpload, listUploads, startUpload, undoUpload, type PastUpload } from "../academicUploadApi";
import { downloadBytes, downloadTable } from "../creditedExport";
import { filterIsEmpty, type ScreenFilter } from "@/lib/academicScreen";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-40";
const BTN_DARK = "inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-5 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-40";
const STATE_STYLE = { valid: "bg-green-50 text-green-900 border-green-300", warning: "bg-amber-50 text-amber-950 border-amber-400", error: "bg-red-50 text-red-900 border-red-300" } as const;
const STATE_LABEL = { valid: "Ready", warning: "Ready, with a warning", error: "Problem" } as const;
const n = (v: number) => v.toLocaleString("en-US");
const today = () => new Date().toISOString().slice(0, 10);
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "school";
const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type View = "all" | "change" | "nochange" | "warning" | "error";
interface Outcome { batchNo: number; batchId: string; set: number; same: number; errors: number }

/**
 * Grades and Academic Management > "Upload by file" for ONE school. Download the pre-filled template of the school, change the "Academic status" column, upload it. The file is CHECKED first (nothing is saved):
 * every row says what will happen, with the row number of the file; then it is SAVED in chunks of 500 as a numbered batch, with a progress count and "Retry remaining rows" if the connection breaks.
 * Rows with a problem are skipped (and listed in an error report with a "Problem" column); the rows that are fine are still saved. The upload can be undone for 30 days.
 */
export function AcademicUploadPanel({ schoolId, schoolName, filter, matching, onSaved }: { schoolId: string; schoolName: string; /** The search and filters set on the school screen: the template has only these scholars. */ filter: ScreenFilter; matching: number; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [fileName, setFileName] = useState("");
  const [checked, setChecked] = useState<UploadChecked[]>([]);
  const [problems, setProblems] = useState<Map<number, string[]>>(new Map());
  const [headerError, setHeaderError] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number; batchNo: number } | null>(null);
  const [ackWarnings, setAckWarnings] = useState(false);
  const [view, setView] = useState<View>("all");
  const [limit, setLimit] = useState(100);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [retry, setRetry] = useState<{ batchId: string; batchNo: number; next: number; set: number; same: number; errors: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [past, setPast] = useState<PastUpload[] | null>(null);
  const [undoMsg, setUndoMsg] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const rowsToSave = useRef<UploadRow[]>([]);

  const reset = useCallback(() => {
    setParsed(null); setFileName(""); setChecked([]); setProblems(new Map()); setHeaderError(""); setError(""); setOutcome(null); setRetry(null); setAckWarnings(false); setView("all"); setLimit(100);
    if (fileInput.current) fileInput.current.value = "";
  }, []);
  const loadPast = useCallback(async () => {
    const r = await listUploads(schoolId);
    if (r.ok) setPast(r.rows); else setPast(null);
  }, [schoolId]);
  useEffect(() => { reset(); setUndoMsg(""); setPast(null); if (open) void loadPast(); }, [schoolId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) void loadPast(); }, [open, loadPast]);

  const totals = uploadTotals(checked);
  const filtered = !filterIsEmpty(filter);

  async function downloadTemplate() {
    setBusy("template"); setError("");
    const r = await fetchTemplateRows(schoolId, filter);
    setBusy(null);
    if (!r.ok) { setError(r.missing ? `This needs the latest database update (${UPLOAD_SQL}). Ask the IT admin to run it.` : r.error); return; }
    const ins = UPLOAD_INSTRUCTIONS;
    const rows = [
      [...UPLOAD_HEADERS.map(h => ({ value: h, style: "header" as const })), null, { value: ins[0], style: "bold" as const }],
      ...r.rows.map((x, k) => [...x, null, k + 1 < ins.length ? ins[k + 1] : null] as (string | null)[]),
    ];
    for (let k = r.rows.length + 1; k < ins.length; k++) rows.push([null, null, null, null, null, null, null, null, ins[k]] as never);
    downloadBytes(await buildXlsx({ name: "Academic status", rows, widths: [18, 32, 34, 28, 12, 18, 18, 3, 90] }) as BlobPart, `Academic-status_${slug(schoolName)}${filtered ? "_filtered" : ""}_${today()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (r.rows.length === 0) setError(filtered ? "No scholar matches the filters, so the template only has the column names." : "This school has no scholars, so the template only has the column names.");
  }

  async function handleFile(file: File) {
    reset(); setFileName(file.name);
    if (file.size > UPLOAD_MAX_MB * 1024 * 1024) { setHeaderError(`The file is larger than ${UPLOAD_MAX_MB} MB. Please split it into smaller files.`); return; }
    let grid: string[][];
    try {
      if (/\.xlsx$/i.test(file.name)) grid = await readXlsx(await file.arrayBuffer());
      else if (/\.(csv|txt)$/i.test(file.name)) grid = parseDelimited(await file.text());
      else { setHeaderError("Choose an Excel file (.xlsx) or a CSV file (.csv)."); return; }
    } catch { setHeaderError("This file could not be read. Is it a real .xlsx or .csv file?"); return; }
    const p = parseUploadGrid(grid);
    if (p.headerError) { setHeaderError(p.headerError); return; }
    if (p.rows.length === 0) { setHeaderError("There are no rows to check (only the column names, or only the example row)."); return; }
    if (p.rows.length > UPLOAD_MAX_ROWS) { setHeaderError(`The file has ${n(p.rows.length)} rows; at most ${n(UPLOAD_MAX_ROWS)} can be uploaded at a time. Please split the file.`); return; }
    setParsed(p);
    // STEP 1: the check, chunk by chunk. Nothing is saved.
    const dup = findDuplicates(p.rows);
    const toCheck = p.rows.filter(r => !dup.has(r.i));
    const results: UploadChecked[] = [];
    setChecking({ done: 0, total: p.rows.length });
    for (let at = 0; at < toCheck.length; at += UPLOAD_CHUNK) {
      const r = await checkChunk(schoolId, toCheck.slice(at, at + UPLOAD_CHUNK));
      if (!r.ok) { setChecking(null); setError(r.missing ? `This needs the latest database update (${UPLOAD_SQL}). Ask the IT admin to run it.` : `${r.error} Nothing was saved. Please choose the file again.`); return; }
      results.push(...r.rows); setChecking({ done: Math.min(at + UPLOAD_CHUNK, toCheck.length) + dup.size, total: p.rows.length });
    }
    for (const r of p.rows) if (dup.has(r.i)) results.push({ i: r.i, state: "error", action: "none", messages: [`This scholar is in the file more than once (also row ${dup.get(r.i)}): only the first row is used.`], scholarId: null, name: null, program: null, currentStatus: null, newStatus: null, currentCustom: null, newCustom: null, clearCustom: false });
    results.sort((a, b) => a.i - b.i);
    setChecking(null); setChecked(results);
    setProblems(new Map(results.filter(x => x.state === "error").map(x => [x.i, x.messages])));
  }

  /** STEP 2: the ready rows are saved in chunks as a numbered batch; if a chunk fails, "Retry remaining rows" goes on from there (the chunks already saved are not saved again). */
  async function runSave(resume: typeof retry) {
    const ready = rowsToSave.current;
    setError(""); setRetry(null);
    let batchId = resume?.batchId ?? "", batchNo = resume?.batchNo ?? 0, at = resume?.next ?? 0, set = resume?.set ?? 0, same = resume?.same ?? 0, errors = resume?.errors ?? 0;
    if (!resume) {
      const s = await startUpload(schoolId, fileName, parsed?.rows.length ?? ready.length);
      if (!s.ok) { setError(s.missing ? `This needs the latest database update (${UPLOAD_SQL}). Ask the IT admin to run it.` : s.error); return; }
      batchId = s.id; batchNo = s.batchNo;
    }
    setSaving({ done: at, total: ready.length, batchNo });
    while (at < ready.length) {
      const r = await applyChunk(batchId, ready.slice(at, at + UPLOAD_CHUNK));
      if (!r.ok) { setSaving(null); setRetry({ batchId, batchNo, next: at, set, same, errors }); setError(`${r.error} ${n(set)} scholar${set === 1 ? " was" : "s were"} saved so far (batch ${batchNo}). Press “Retry remaining rows”: the rows already saved are not saved again.`); return; }
      set += r.set; same += r.same; errors += r.errors; at += UPLOAD_CHUNK; setSaving({ done: Math.min(at, ready.length), total: ready.length, batchNo });
    }
    const skipped = totals.error + errors;
    const f = await finishUpload(batchId, skipped);
    setSaving(null);
    if (!f.ok) { setError(f.error); return; }
    setOutcome({ batchNo, batchId, set, same: same + totals.same, errors: skipped });
    onSaved?.(); void loadPast();
  }
  function handleSave() {
    rowsToSave.current = (parsed?.rows ?? []).filter(r => checked.find(c => c.i === r.i)?.action === "set");
    if (rowsToSave.current.length === 0) return;
    if (!window.confirm(`Change the academic status of ${n(rowsToSave.current.length)} scholar${rowsToSave.current.length === 1 ? "" : "s"} of ${schoolName}? It is saved as a numbered batch and can be undone for 30 days.`)) return;
    void runSave(null);
  }

  async function downloadReport() {
    if (!parsed) return;
    const rows = errorReportRows(parsed.header, parsed.rows, problems);
    await downloadTable(rows, `Upload-problems_${slug(schoolName)}_${today()}.xlsx`, "xlsx", [8, ...parsed.header.map(() => 22), 70], "Problems");
  }
  async function undo(b: PastUpload) {
    if (!window.confirm(`Undo upload ${b.batchNo}? Each scholar it changed goes back to what they were before, unless somebody changed them since (they are left alone).`)) return;
    setBusy(`undo${b.id}`); setUndoMsg("");
    const r = await undoUpload(b.id);
    setBusy(null);
    if (!r.ok) { setUndoMsg(r.error); return; }
    setUndoMsg(`Upload ${b.batchNo} undone: ${n(r.restored)} scholar${r.restored === 1 ? "" : "s"} put back${r.kept > 0 ? `, ${n(r.kept)} left alone because they were changed since` : ""}.`);
    onSaved?.(); void loadPast();
  }

  const shown = checked.filter(c => view === "all" ? true : view === "change" ? c.action === "set" : view === "nochange" ? c.state !== "error" && c.action === "skip" : view === "warning" ? c.state === "warning" : c.state === "error");
  const rowOf = new Map((parsed?.rows ?? []).map(r => [r.i, r]));
  const needAck = totals.warning > 0;

  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="Upload by file">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span><span className="block text-[16px] font-bold text-[#062444]">Upload by file for {schoolName}</span>
          <span className="block text-[14px] text-slate-700">Download the template with this school's scholars, change their status in Excel, upload it. Checked first, saved second, and it can be undone.</span></span>
        <span className="text-[14px] font-semibold text-[#00709f]">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {outcome ? (
            <div className="space-y-3 rounded-xl border border-green-300 bg-green-50 p-4">
              <p className="flex items-center gap-2 text-[16px] font-bold text-green-900"><CheckCircle2 size={18} aria-hidden="true" /> Upload {outcome.batchNo} is finished</p>
              <p className="text-[15px] font-semibold text-[#062444]">{summaryText(outcome.set, outcome.same, outcome.errors)}</p>
              <p className="text-[14px] text-slate-800">Only the open renewals whose passing GWA changed are checked again; the count is at the top of the page.</p>
              <div className="flex flex-wrap gap-2">
                {outcome.errors > 0 && <button type="button" onClick={() => void downloadReport()} className={BTN}><Download size={14} /> Download the error report</button>}
                <button type="button" className={BTN} onClick={() => { const b = past?.find(x => x.id === outcome.batchId); if (b) void undo(b); }} disabled={!past?.find(x => x.id === outcome.batchId)?.canUndo}><RotateCcw size={14} /> Undo this upload</button>
                <button type="button" onClick={reset} className={BTN_DARK}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-[14px] text-slate-700">
                <li>Download the template: it already has the scholars of this school and their status today{filtered ? <>: <strong>only the {n(matching)} that match the search and filters now set above</strong> (clear the filters to get the whole school)</> : " (the whole school, as no filter is set)"}.</li>
                <li>In Excel change the <strong>Academic status</strong> of the scholars you want (Academic, Non-academic or Not set). Scholars are found by <strong>Scholar ID</strong>; keep that column as Text.</li>
                <li>Upload the file. It is only <strong>checked</strong>: nothing is saved yet. Up to {n(UPLOAD_MAX_ROWS)} rows and {UPLOAD_MAX_MB} MB; .xlsx or .csv (commas or semicolons).</li>
                <li>Read the check, then press <strong>Save</strong>. Rows with a problem are skipped and listed in the error report; the others are saved.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void downloadTemplate()} disabled={busy === "template" || !!saving} className={BTN}>{busy === "template" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {filtered ? `Download the template of the ${n(matching)} scholar${matching === 1 ? "" : "s"} shown` : "Download the template of this school"}</button>
                <label className={`${BTN} cursor-pointer ${checking || saving ? "pointer-events-none opacity-40" : ""}`}><Upload size={14} /> Choose file
                  <input ref={fileInput} type="file" accept=".xlsx,.csv,.txt" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} /></label>
                {fileName && <span className="text-[14px] text-slate-700">{fileName}</span>}
              </div>
              {headerError && <p role="alert" className="flex items-start gap-2 text-[14px] text-red-700"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {headerError}</p>}
              {checking && <p role="status" className="flex items-center gap-2 text-[14px] text-slate-800"><Loader2 size={14} className="animate-spin" /> Checking… {n(checking.done)} of {n(checking.total)} rows</p>}
              {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
              {retry && <button type="button" onClick={() => void runSave(retry)} className={BTN_DARK}><RotateCcw size={14} /> Retry remaining rows</button>}

              {checked.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[14px] text-slate-800">
                    <strong>{n(totals.rows)}</strong> rows checked: <strong>{n(totals.willSet)}</strong> will be changed, <strong>{n(totals.same)}</strong> need no change, <strong>{n(totals.error)}</strong> have a problem and will be skipped{totals.warning > 0 ? `, ${n(totals.warning)} have a warning` : ""}.
                  </p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Show rows">
                    {([["all", `All (${n(totals.rows)})`], ["change", `Will change (${n(totals.willSet)})`], ["nochange", `No change (${n(totals.same)})`], ["warning", `Warnings (${n(totals.warning)})`], ["error", `Problems (${n(totals.error)})`]] as const).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setLimit(100); }} className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${view === k ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444]"}`}>{label}</button>))}
                    {totals.error > 0 && <button type="button" onClick={() => void downloadReport()} className={BTN}><Download size={14} /> Error report</button>}
                  </div>
                  <div className="max-h-[46vh] overflow-auto rounded-xl border border-[#e6ecf5]">
                    <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
                      <thead><tr className="sticky top-0 bg-[#f8fafd] text-left text-[12px] font-semibold uppercase tracking-wide text-slate-600"><th className="px-3 py-2">Row</th><th className="px-3 py-2">Scholar ID (file)</th><th className="px-3 py-2">Scholar</th><th className="px-3 py-2">Now</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th></tr></thead>
                      <tbody>
                        {shown.slice(0, limit).map(c => (
                          <tr key={c.i} className="border-t border-[#f0f3f8] align-top">
                            <td className="px-3 py-2">{c.i}</td><td className="px-3 py-2 whitespace-nowrap">{rowOf.get(c.i)?.scholar_id || "—"}{c.scholarId && c.scholarId !== rowOf.get(c.i)?.scholar_id && <span className="block text-[12.5px] text-slate-600">= {c.scholarId}</span>}</td>
                            <td className="px-3 py-2">{c.name || "—"}{c.program && <span className="block text-[12.5px] text-slate-600">{c.program}</span>}</td>
                            <td className="px-3 py-2">{c.state === "error" ? "—" : statusWord(c.currentStatus)}</td>
                            <td className="px-3 py-2"><span className={`inline-block rounded-full border px-2 py-0.5 text-[12.5px] font-semibold ${STATE_STYLE[c.state]}`}>{STATE_LABEL[c.state]}</span><span className="mt-1 block">{resultText(c)}</span></td>
                            <td className="px-3 py-2 text-slate-800">{c.messages.length ? c.messages.join(" ") : "—"}</td></tr>))}
                        {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-700">No rows here.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {shown.length > limit && <button type="button" onClick={() => setLimit(l => l + 200)} className={BTN}>Show more ({n(shown.length - limit)} left)</button>}
                  {needAck && <label className="flex items-center gap-2 text-[14px] text-slate-800"><input type="checkbox" checked={ackWarnings} onChange={e => setAckWarnings(e.target.checked)} /> I have read the {n(totals.warning)} warning{totals.warning === 1 ? "" : "s"} (an ID read with its dash or zeros fixed, or a name that differs).</label>}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={handleSave} disabled={totals.willSet === 0 || !!saving || (needAck && !ackWarnings)} className={BTN_DARK}>
                      {saving ? <><Loader2 size={14} className="animate-spin" /> Saving… {n(saving.done)} of {n(saving.total)} (batch {saving.batchNo})</> : `Save (${n(totals.willSet)})`}</button>
                    <button type="button" onClick={reset} disabled={!!saving} className="text-[14px] font-semibold text-slate-600 disabled:opacity-40">Cancel</button>
                    {totals.willSet === 0 && <span className="text-[14px] text-slate-700">Nothing in this file needs to change.</span>}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="border-t border-[#eef3fb] pt-3">
            <h3 className="text-[15px] font-bold text-[#062444]">Past uploads of this school</h3>
            {undoMsg && <p role="status" className="mt-1 text-[14px] text-slate-800">{undoMsg}</p>}
            {past === null ? <p className="mt-1 text-[14px] text-slate-700">Loading…</p> : past.length === 0 ? <p className="mt-1 text-[14px] text-slate-700">No upload yet.</p> : (
              <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13.5px]">
                <thead className="bg-[#f7f9fc] text-[#062444]"><tr><th className="px-2 py-1.5">Batch</th><th className="px-2 py-1.5">File</th><th className="px-2 py-1.5">By, when</th><th className="px-2 py-1.5">Result</th><th className="px-2 py-1.5"></th></tr></thead>
                <tbody>{past.map(b => (
                  <tr key={b.id} className="border-t border-[#eef3fb] align-top"><td className="px-2 py-1.5 font-semibold">{b.batchNo}</td><td className="px-2 py-1.5">{b.fileName || "—"}</td><td className="px-2 py-1.5">{b.by}<span className="block text-[12.5px] text-slate-600">{when(b.startedAt)}</span></td>
                    <td className="px-2 py-1.5">{b.state === "in_progress" ? "In progress" : b.state === "abandoned" ? "Stopped before it finished" : b.state === "undone" ? `Undone ${b.undoneAt ? when(b.undoneAt) : ""}${b.undoKept ? ` (${n(b.undoKept)} left alone)` : ""}` : summaryText(b.setCount, b.sameCount, b.errorCount)}</td>
                    <td className="px-2 py-1.5">{b.canUndo && <button type="button" className={BTN} disabled={busy !== null} onClick={() => void undo(b)}>{busy === `undo${b.id}` ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Undo</button>}</td></tr>))}</tbody>
              </table></div>)}
          </div>
        </div>
      )}
    </section>
  );
}
