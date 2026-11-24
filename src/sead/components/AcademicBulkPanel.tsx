import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from "lucide-react";
import { parseCsv } from "../csvUtils";
import { buildXlsx, readXlsx } from "@/lib/xlsxLite";
import {
  ACADEMIC_BULK_EXAMPLE, ACADEMIC_BULK_HEADERS, ACADEMIC_BULK_INSTRUCTIONS, ACADEMIC_BULK_MAX_MB, ACADEMIC_BULK_MAX_ROWS, ACADEMIC_BULK_SAVE_CHUNK, ACADEMIC_BULK_SQL, ACADEMIC_REPORT_HEADERS, STATE_LABEL,
  academicBulkTotals, academicSummaryText, actionText, parseAcademicBulkGrid, statusLabel, type AcademicBulkChecked, type AcademicBulkRow,
} from "@/lib/academicBulk";
import { checkAcademicBulk, fetchAcademicOverrides, saveAcademicBulk, type AcademicSaveResult } from "../academicBulkApi";
import { downloadBytes, downloadTable } from "../creditedExport";
import { forgetAcademicStatusMap } from "../academicStatusApi";

type View = "all" | "change" | "nochange" | "error";
const STATE_STYLE = { valid: "bg-green-50 text-green-900 border-green-300", warning: "bg-amber-50 text-amber-950 border-amber-400", error: "bg-red-50 text-red-900 border-red-300" } as const;
const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]";
const today = () => new Date().toISOString().slice(0, 10);

async function downloadTemplate() {
  const rows = [
    [...ACADEMIC_BULK_HEADERS.map(h => ({ value: h, style: "header" as const })), null, { value: ACADEMIC_BULK_INSTRUCTIONS[0], style: "bold" as const }],
    [...ACADEMIC_BULK_EXAMPLE, null, ACADEMIC_BULK_INSTRUCTIONS[1]],
    ...ACADEMIC_BULK_INSTRUCTIONS.slice(2).map(t => [null, null, null, null, null, null, t] as (string | null)[]),
  ];
  const bytes = await buildXlsx({ name: "Academic status", rows, widths: [28, 26, 34, 28, 18, 3, 90] });
  downloadBytes(bytes as BlobPart, "Academic-status-template.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/**
 * Grades and Academic Management > "Set a scholar's academic status by file": for the scholars whose academic status is different from the one of their program. Download the template (Scholar ID, Full name, School, Program,
 * Academic status), fill it, upload it: the file is CHECKED first (nothing is saved), then saved with one button. Scholars are found by Scholar ID only; the name, school and program are only compared with the record.
 */
export function AcademicBulkPanel({ onSaved }: { onSaved?: () => void } = {}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileRows, setFileRows] = useState<AcademicBulkRow[]>([]);
  const [checked, setChecked] = useState<AcademicBulkChecked[]>([]);
  const [headerError, setHeaderError] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [view, setView] = useState<View>("all");
  const [limit, setLimit] = useState(100);
  const [outcome, setOutcome] = useState<{ set: number; reset: number; skipped: number; errors: number; report: string[][] } | null>(null);
  const [busyList, setBusyList] = useState(false);
  const totals = academicBulkTotals(checked);

  function reset() {
    setFileName(""); setFileRows([]); setChecked([]); setHeaderError(""); setError(""); setOutcome(null); setView("all"); setLimit(100);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleFile(file: File) {
    reset(); setFileName(file.name);
    if (file.size > ACADEMIC_BULK_MAX_MB * 1024 * 1024) { setHeaderError(`The file is larger than ${ACADEMIC_BULK_MAX_MB} MB. Please split it into smaller files.`); return; }
    let grid: string[][];
    try {
      if (/\.xlsx$/i.test(file.name)) grid = await readXlsx(await file.arrayBuffer());
      else if (/\.(csv|txt)$/i.test(file.name)) grid = parseCsv((await file.text()).replace(/^﻿/, ""));
      else { setHeaderError("Choose an Excel file (.xlsx) or a CSV file (.csv)."); return; }
    } catch { setHeaderError("This file could not be read. Is it a real .xlsx or .csv file?"); return; }
    const parsed = parseAcademicBulkGrid(grid);
    if (parsed.headerError) { setHeaderError(parsed.headerError); return; }
    if (parsed.rows.length === 0) { setHeaderError("There are no rows to set (only the column names, or only the example row)."); return; }
    if (parsed.rows.length > ACADEMIC_BULK_MAX_ROWS) { setHeaderError(`The file has ${parsed.rows.length.toLocaleString("en-US")} rows; at most ${ACADEMIC_BULK_MAX_ROWS.toLocaleString("en-US")} can be checked at a time. Please split the file.`); return; }
    setFileRows(parsed.rows);
    setChecking(true);
    const r = await checkAcademicBulk(parsed.rows);      // STEP 1: nothing is saved
    setChecking(false);
    if (!r.ok) { setError(r.missing ? `This needs the latest database update (${ACADEMIC_BULK_SQL}). Ask the IT admin to run it.` : r.error); return; }
    setChecked(r.rows);
  }

  async function handleSave() {
    const ready = checked.filter(c => c.action === "set" || c.action === "reset").map(c => fileRows.find(r => r.i === c.i)).filter((r): r is AcademicBulkRow => !!r);
    if (ready.length === 0) return;
    if (!window.confirm(`Change the academic status of ${ready.length.toLocaleString("en-US")} scholar${ready.length === 1 ? "" : "s"}? The scholar's own status decides which passing GWA the renewal uses. The open renewals are checked again in the background.`)) return;
    setError(""); setSaving({ done: 0, total: ready.length });
    const results: AcademicSaveResult[] = []; let set = 0, reset = 0, skipped = 0, errors = 0;
    for (let at = 0; at < ready.length; at += ACADEMIC_BULK_SAVE_CHUNK) {
      const r = await saveAcademicBulk(ready.slice(at, at + ACADEMIC_BULK_SAVE_CHUNK));      // STEP 2: the database checks again
      if (!r.ok) { setError(`${r.error} ${(set + reset).toLocaleString("en-US")} were changed before this stopped; check the list and run the file again (nothing is changed twice).`); break; }
      set += r.set; reset += r.reset; skipped += r.skipped; errors += r.errors; results.push(...r.results);
      setSaving({ done: Math.min(at + ACADEMIC_BULK_SAVE_CHUNK, ready.length), total: ready.length });
    }
    setSaving(null); forgetAcademicStatusMap(); onSaved?.();
    const byI = new Map(fileRows.map(r => [r.i, r]));
    const report: string[][] = [];
    for (const c of checked) if (c.state === "error" || c.action === "skip") report.push([String(c.i), byI.get(c.i)?.scholar_id ?? "", c.state === "error" ? "Not changed" : "No change", c.messages.join(" ")]);
    for (const x of results) if (x.outcome === "error") report.push([String(x.i), byI.get(x.i)?.scholar_id ?? "", "Not changed", x.message ?? ""]);
    setOutcome({ set, reset, skipped: skipped + checked.filter(c => c.state !== "error" && c.action === "skip").length, errors: errors + checked.filter(c => c.state === "error").length, report: report.sort((a, b) => Number(a[0]) - Number(b[0])) });
  }

  async function downloadCurrent() {
    setBusyList(true); setError("");
    const r = await fetchAcademicOverrides();
    setBusyList(false);
    if (!r.ok) { setError(r.missing ? `This needs the latest database update (${ACADEMIC_BULK_SQL}). Ask the IT admin to run it.` : r.error); return; }
    await downloadTable([ACADEMIC_BULK_HEADERS, ...r.rows.map(x => [x.scholarId, x.name, x.school, x.program, statusLabel(x.status)])], `Academic-status-current_${today()}.xlsx`, "xlsx", [28, 26, 34, 28, 18], "Academic status");
    if (r.rows.length === 0) setError("Nobody has a status set by hand or by file yet, so the file only has the column names.");
  }

  const shown = checked.filter(c => view === "all" ? true : view === "change" ? c.action === "set" || c.action === "reset" : view === "nochange" ? c.state !== "error" && c.action === "skip" : c.state === "error");
  const byI = new Map(fileRows.map(r => [r.i, r]));

  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="Set academic status by file">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span><span className="block text-[16px] font-bold text-[#062444]">Set a scholar's academic status by file</span>
          <span className="block text-[14px] text-slate-700">Sets the academic status of each scholar (the status belongs to the scholar, not to the program).</span></span>
        <span className="text-[14px] font-semibold text-[#00709f]">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {outcome ? (
            <div className="py-2 text-center">
              <CheckCircle2 size={34} className="mx-auto mb-2 text-green-600" />
              <p className="text-[16px] font-bold text-[#062444]">{academicSummaryText(outcome.set, outcome.reset, outcome.skipped, outcome.errors)}</p>
              <p className="mt-1 text-[13.5px] text-slate-600">The open renewals are checked again in the background within a few minutes.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {outcome.report.length > 0 && <button type="button" onClick={() => void downloadTable([ACADEMIC_REPORT_HEADERS, ...outcome.report], `Academic-status-report_${today()}.xlsx`, "xlsx", [16, 22, 16, 80], "Not changed")} className={BTN}><Download size={14} /> Download error report ({outcome.report.length})</button>}
                <button type="button" onClick={reset} className="rounded-lg bg-[#062444] px-5 py-2 text-[14px] font-bold text-white">Done</button>
              </div>
            </div>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-[14px] text-slate-700">
                <li>Download the template and fill in one row for each scholar: Scholar ID, Full name, School, Program and the <strong>Academic status</strong> (Academic or Non-academic). Scholars are found by <strong>Scholar ID</strong> only.</li>
                <li>Upload the file. It is only <strong>checked</strong>: nothing is saved yet.</li>
                <li>Read the check, then press <strong>Save</strong>. The status is saved on the scholar and used by the renewal.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void downloadTemplate()} className={BTN}><Download size={14} /> Download template</button>
                <button type="button" onClick={() => void downloadCurrent()} disabled={busyList} className={`${BTN} disabled:opacity-60`}>{busyList ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download the current list</button>
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#062444] px-3.5 py-2 text-[14px] font-bold text-white ${checking || saving ? "pointer-events-none opacity-50" : ""}`}>
                  <Upload size={14} /> {fileName ? "Choose another file" : "Choose file"}
                  <input ref={fileInput} type="file" accept=".xlsx,.csv,.txt" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                </label>
                {fileName && <span className="min-w-0 truncate text-[14px] text-slate-700" title={fileName}>{fileName}</span>}
              </div>
              {headerError && <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[14px] text-red-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{headerError}</p>}
              {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[14px] text-red-900">{error}</p>}
              {checking && <p role="status" className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" /> Checking {fileRows.length.toLocaleString("en-US")} rows… nothing is saved.</p>}

              {checked.length > 0 && (
                <>
                  <p className="text-[14px] text-slate-700" role="status">
                    Checked {checked.length.toLocaleString("en-US")} rows: <strong className="text-green-800">{totals.valid} valid</strong>, <strong className="text-amber-900">{totals.warning} warning{totals.warning === 1 ? "" : "s"}</strong>, <strong className="text-red-800">{totals.error} error{totals.error === 1 ? "" : "s"}</strong>.
                    {" "}<strong>{totals.willSet.toLocaleString("en-US")}</strong> will get this status{totals.willReset > 0 ? `, ${totals.willReset} will follow the program again` : ""}{totals.noChange > 0 ? `, ${totals.noChange} need no change` : ""}.
                  </p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show rows">
                    {([["all", `All (${checked.length})`], ["change", `Will change (${totals.willSet + totals.willReset})`], ["nochange", `No change (${totals.noChange})`], ["error", `Errors (${totals.error})`]] as const).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setLimit(100); }} className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${view === k ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>{label}</button>
                    ))}
                  </div>
                  <div className="max-h-[46vh] overflow-auto rounded-xl border border-[#e6ecf5]">
                    <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
                      <thead><tr className="sticky top-0 bg-[#f8fafd] text-left text-[12px] font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-2">Row</th><th className="px-3 py-2">Scholar ID</th><th className="px-3 py-2">Scholar</th><th className="px-3 py-2">Now</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th>
                      </tr></thead>
                      <tbody>
                        {shown.slice(0, limit).map(c => (
                          <tr key={c.i} className="border-t border-[#f0f3f8] align-top">
                            <td className="px-3 py-2 tabular-nums text-slate-600">{c.i}</td>
                            <td className="px-3 py-2 tabular-nums">{byI.get(c.i)?.scholar_id || "—"}</td>
                            <td className="px-3 py-2">{c.name || "—"}{c.program && <span className="block text-[12.5px] text-slate-600">{c.program}</span>}</td>
                            
                            <td className="px-3 py-2">{statusLabel(c.currentStatus)}</td>
                            <td className="px-3 py-2"><span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-bold ${STATE_STYLE[c.state]}`}>{STATE_LABEL[c.state]}</span><span className="mt-0.5 block text-[12.5px] text-slate-700">{actionText(c)}</span></td>
                            <td className="px-3 py-2 text-slate-800">{c.messages.length ? c.messages.join(" ") : "—"}</td>
                          </tr>
                        ))}
                        {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-600">No rows here.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {shown.length > limit && <button type="button" onClick={() => setLimit(l => l + 200)} className="text-[14px] font-semibold text-[#00709f] hover:underline">Show more ({(shown.length - limit).toLocaleString("en-US")} more rows)</button>}
                  <div className="flex flex-wrap items-center gap-3 border-t border-[#f0f3f8] pt-3">
                    <button type="button" onClick={() => void handleSave()} disabled={totals.willSet + totals.willReset === 0 || !!saving} className="rounded-lg bg-[#062444] px-5 py-2 text-[14px] font-bold text-white disabled:opacity-40">
                      {saving ? `Saving… ${saving.done.toLocaleString("en-US")} of ${saving.total.toLocaleString("en-US")}` : `Save (${(totals.willSet + totals.willReset).toLocaleString("en-US")})`}
                    </button>
                    <button type="button" onClick={reset} disabled={!!saving} className="text-[14px] font-semibold text-slate-600 disabled:opacity-40">Cancel</button>
                    {totals.willSet + totals.willReset === 0 && <span className="text-[14px] text-slate-600">Nothing in this file needs to change.</span>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
