import { useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { checkOrAddBulkRecords } from "../scholarCounselingApi";
import { parseCsv } from "../csvUtils";
import { buildXlsx, readXlsx } from "@/lib/xlsxLite";
import {
  BULK_MAX_ROWS, BULK_TEMPLATE_EXAMPLE, BULK_TEMPLATE_HEADERS, parseDailyRecordGrid, rowState, summarize,
  type BulkParsedRow, type BulkRowResult,
} from "@/lib/bulkDailyRecords";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function downloadTemplate() {
  const bytes = await buildXlsx({
    name: "Daily Records",
    rows: [BULK_TEMPLATE_HEADERS.map(h => ({ value: h, style: "header" as const })), [...BULK_TEMPLATE_EXAMPLE]],
    widths: [26, 16, 16, 14, 24, 40, 40],
  });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url; a.download = "daily-records-template.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const dayText = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

/**
 * Consultation Tool > Daily Records > "Bulk Add Records": many PAST daily records from one spreadsheet (.xlsx or .csv). The file is read here, the database checks every row (so the preview
 * is exactly what will happen: added, skipped because it is already recorded, or refused with the reason), and only then are the good rows saved. Every record is saved like one added by hand.
 */
export function BulkDailyRecordsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<BulkParsedRow[]>([]);
  const [results, setResults] = useState<Map<number, BulkRowResult>>(new Map());
  const [headerError, setHeaderError] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [skippedExample, setSkippedExample] = useState(0);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [outcome, setOutcome] = useState<{ added: number; skipped: number; failed: { rowNumber: number; message: string }[] } | null>(null);

  const counts = summarize(rows, results);

  function reset() {
    setFileName(""); setRows([]); setResults(new Map()); setHeaderError(""); setError(""); setSkippedExample(0); setOutcome(null); setOnlyProblems(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleFile(file: File) {
    reset(); setFileName(file.name); setMissing(false);
    let grid: string[][];
    try {
      if (/\.xlsx$/i.test(file.name)) grid = await readXlsx(await file.arrayBuffer());
      else if (/\.(csv|txt)$/i.test(file.name)) grid = parseCsv((await file.text()).replace(/^﻿/, ""));
      else { setHeaderError("Choose an Excel file (.xlsx) or a CSV file (.csv)."); return; }
    } catch {
      setHeaderError("This file could not be read. Is it a real .xlsx or .csv file?"); return;
    }
    const parsed = parseDailyRecordGrid(grid);
    if (parsed.headerError) { setHeaderError(parsed.headerError); return; }
    if (parsed.rows.length === 0) { setHeaderError("There are no records in the file (only the column names, or only the example row)."); setSkippedExample(parsed.skippedExample); return; }
    if (parsed.rows.length > BULK_MAX_ROWS) { setHeaderError(`The file has ${parsed.rows.length.toLocaleString()} records; at most ${BULK_MAX_ROWS.toLocaleString()} can be added at a time. Please split the file.`); return; }
    setRows(parsed.rows); setSkippedExample(parsed.skippedExample);
    // the database looks at every row that can be read (nothing is saved yet)
    setChecking(true);
    const r = await checkOrAddBulkRecords(parsed.rows.filter(x => !x.problem).map(x => ({ rowNumber: x.rowNumber, input: x.input })), true);
    setChecking(false);
    if (!r.ok) { setError(r.error); setMissing(r.missing); return; }
    setResults(r.results);
  }

  async function handleAdd() {
    const ready = rows.filter(r => rowState(r, results.get(r.rowNumber)).state === "ready");
    if (ready.length === 0) return;
    if (!window.confirm(`Add ${ready.length.toLocaleString()} daily record${ready.length === 1 ? "" : "s"}${counts.error > 0 ? ` (the ${counts.error} row${counts.error === 1 ? "" : "s"} with a problem will not be added)` : ""}? They are saved with your name as the staff who consulted, and cannot be undone from here.`)) return;
    setError(""); setImporting({ done: 0, total: ready.length });
    const r = await checkOrAddBulkRecords(ready.map(x => ({ rowNumber: x.rowNumber, input: x.input })), false, (done, total) => setImporting({ done, total }));
    setImporting(null);
    if (!r.ok) { setError(r.error); return; }
    let added = 0, skipped = 0; const failed: { rowNumber: number; message: string }[] = [];
    for (const x of ready) {
      const res = r.results.get(x.rowNumber);
      if (!res || !res.ok) failed.push({ rowNumber: x.rowNumber, message: res?.error ?? "The row was not saved." });
      else if (res.duplicate) skipped++;
      else added++;
    }
    setOutcome({ added, skipped, failed });
    onDone();
  }

  const shown = onlyProblems ? rows.filter(r => rowState(r, results.get(r.rowNumber)).state !== "ready") : rows;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><FileSpreadsheet size={16} className="text-[#F3BC00]" /> Bulk Add Daily Records</h3>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {outcome ? (
            <div className="py-2">
              <div className="text-center">
                <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
                <p className="text-[15px] font-semibold text-[#062444]">{outcome.added.toLocaleString()} daily record{outcome.added === 1 ? "" : "s"} added.</p>
                {outcome.skipped > 0 && <p className="text-[13.5px] text-slate-700 mt-1">{outcome.skipped.toLocaleString()} {outcome.skipped === 1 ? "was" : "were"} already recorded and skipped.</p>}
              </div>
              {outcome.failed.length > 0 && (
                <div role="alert" className="mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <p className="text-[13px] font-semibold text-red-700 mb-1.5">{outcome.failed.length} row{outcome.failed.length === 1 ? "" : "s"} could not be added:</p>
                  {outcome.failed.map(f => <p key={f.rowNumber} className="text-[13px] text-red-700">Row {f.rowNumber}: {f.message}</p>)}
                </div>
              )}
              <div className="flex justify-center gap-3 mt-5">
                <button onClick={reset} className="text-[13.5px] font-semibold text-[#0088cc] hover:underline">Add another file</button>
                <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[14px] text-slate-800 mb-1">Add many <strong>past</strong> daily records at once from a spreadsheet. One row is one visit.</p>
              <ol className="list-decimal pl-5 text-[13.5px] text-slate-700 mb-3 space-y-0.5">
                <li>Download the Excel template and fill in one row per visit (you can also use your own file if it has the same column names).</li>
                <li>Only <strong>Scholar ID Number</strong> and <strong>Date Visited</strong> are needed. Status (empty = the scholar's current status), Visit Type (Office, KSB Client or Home Visit; empty = Office), Failed Subject(s), Findings and Staff Recommendations are optional.</li>
                <li>Dates can be written 2026-09-15 or 09/15/2026. Records of the future are refused. A visit that is already recorded is skipped, so the same file can be uploaded twice safely.</li>
              </ol>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <button onClick={() => void downloadTemplate()} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]"><Download size={14} aria-hidden="true" /> Download Excel template</button>
              </div>

              <div className="border-2 border-dashed border-[#062444]/15 rounded-xl px-4 py-5 text-center mb-4">
                <input ref={fileInput} type="file" accept=".xlsx,.csv,text/csv" className="hidden" aria-label="Choose the file of daily records" onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                <Upload size={20} className="mx-auto text-slate-500 mb-2" aria-hidden="true" />
                <button onClick={() => fileInput.current?.click()} className="text-[13.5px] font-semibold text-[#0088cc] hover:underline">{fileName ? "Choose a different file" : "Choose the Excel or CSV file"}</button>
                {fileName && <p className="text-[13px] text-slate-700 mt-1">{fileName}</p>}
              </div>

              {headerError && (
                <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
                  <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-[13.5px] text-red-700">{headerError}</p>
                </div>
              )}
              {error && <p role="alert" className={`mb-4 rounded-lg px-3 py-2.5 text-[13.5px] ${missing ? "bg-amber-50 border border-amber-200 text-amber-950" : "bg-red-50 border border-red-100 text-red-700"}`}>{error}</p>}

              {rows.length > 0 && !headerError && (
                <div className="mb-4">
                  {checking ? (
                    <p className="flex items-center gap-2 text-[13.5px] text-slate-700"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Checking {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}…</p>
                  ) : (
                    <>
                      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13.5px]">
                        <span className="font-semibold text-green-800">{counts.ready.toLocaleString()} ready to add</span>
                        {counts.duplicate > 0 && <span className="font-semibold text-slate-700">{counts.duplicate.toLocaleString()} already recorded (skipped)</span>}
                        {counts.error > 0 && <span className="font-semibold text-red-700">{counts.error.toLocaleString()} with a problem (not added)</span>}
                        {skippedExample > 0 && <span className="text-slate-600">The example row was ignored.</span>}
                        {(counts.duplicate > 0 || counts.error > 0) && (
                          <label className="ml-auto flex items-center gap-1.5 text-slate-800"><input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Show only rows that will not be added</label>
                        )}
                      </div>
                      <div className="max-h-72 overflow-auto border border-[#e6ecf5] rounded-lg">
                        <table className="w-full text-[13px]">
                          <caption className="sr-only">The rows of the file and what will happen to each</caption>
                          <thead className="sticky top-0 bg-[#f8fafd] text-left text-slate-600">
                            <tr><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Scholar</th><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Visit type</th><th className="px-3 py-2 font-medium">Result</th></tr>
                          </thead>
                          <tbody>
                            {shown.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">Every row is ready to be added.</td></tr> : shown.map(r => {
                              const res = results.get(r.rowNumber); const st = rowState(r, res);
                              return (
                                <tr key={r.rowNumber} className="border-t border-[#f0f3f8] align-top">
                                  <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{r.rowNumber}</td>
                                  <td className="px-3 py-1.5 text-[#062444]">{res?.name ? <><span className="font-medium">{res.name}</span> <span className="text-slate-600">({res.scholarId})</span></> : r.input.id || "—"}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap text-slate-800">{res?.date ? dayText(res.date) : r.input.date || "—"}</td>
                                  <td className="px-3 py-1.5 text-slate-800">{res?.status ?? (r.input.status || "—")}</td>
                                  <td className="px-3 py-1.5 text-slate-800">{res?.visitType ?? (r.input.visit_type || "Office")}</td>
                                  <td className="px-3 py-1.5">{st.state === "ready" ? <span className="font-semibold text-green-800">Will be added</span> : st.state === "duplicate" ? <span className="text-slate-700">{st.message}</span> : <span className="text-red-700">{st.message}</span>}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {importing && (
                <div className="mb-3" role="status">
                  <div className="flex items-center justify-between mb-1"><span className="text-[13px] font-semibold text-slate-700">Adding…</span><span className="text-[13px] font-semibold text-slate-700">{importing.done} / {importing.total}</span></div>
                  <div className="h-2 w-full rounded-full bg-[#e6ecf5] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-[#062444] to-[#0a3a6b] transition-[width] duration-150" style={{ width: `${Math.round((importing.done / Math.max(1, importing.total)) * 100)}%` }} /></div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button onClick={onClose} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Close</button>
                <button onClick={() => void handleAdd()} disabled={counts.ready === 0 || checking || !!importing || !!headerError}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13.5px] font-semibold rounded-lg px-5 py-2.5">
                  {importing ? "Adding…" : `Add ${counts.ready ? counts.ready.toLocaleString() : ""} Record${counts.ready === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
