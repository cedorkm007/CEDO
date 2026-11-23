import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { parseCsv } from "../csvUtils";
import { buildXlsx, readXlsx } from "@/lib/xlsxLite";
import { manilaDay } from "@/scholar/sdpApi";
import { formatCreditDate } from "@/lib/sdpCreditedView";
import {
  IMPORT_EXAMPLE, IMPORT_HEADERS, IMPORT_INSTRUCTIONS, IMPORT_MAX_MB, IMPORT_MAX_ROWS, IMPORT_REPORT_HEADERS, IMPORT_SAVE_CHUNK, STATE_LABEL, FILTERS_SQL,
  importOutcomeText, importReportRows, importSummaryText, importTotals, parseImportGrid, type ImportChecked, type ImportRow,
} from "@/lib/sdpCreditedFilters";
import { checkImport, saveImport, type ImportSaveResult } from "../sdpCreditedFiltersApi";
import { downloadBytes, downloadTable } from "../creditedExport";
import type { CreditPeriod, SDPActivity } from "../sdpMonitorApi";

type View = "all" | "credit" | "skipped" | "error";
const STATE_STYLE = { valid: "bg-green-50 text-green-900 border-green-300", warning: "bg-amber-50 text-amber-950 border-amber-400", error: "bg-red-50 text-red-900 border-red-300" } as const;

async function downloadTemplate(activityName: string) {
  const rows: (string | { value: string; style: "header" | "bold" } | null)[][] = [
    [...IMPORT_HEADERS.map(h => ({ value: h, style: "header" as const })), null, { value: IMPORT_INSTRUCTIONS[0], style: "bold" as const }],
    [...IMPORT_EXAMPLE, null, IMPORT_INSTRUCTIONS[1]],
    ...IMPORT_INSTRUCTIONS.slice(2).map(t => [null, null, null, null, null, null, null, t] as (string | null)[]),
  ];
  const bytes = await buildXlsx({ name: "Import credits", rows, widths: [26, 16, 26, 10, 22, 26, 3, 90] });
  downloadBytes(bytes as BlobPart, `Credit-import-template_${activityName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "activity"}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/**
 * "Import" in the Credited Scholars tab: many scholars credited from one file (.xlsx or .csv). Step 1 CHECKS the file (nothing is saved): the database says for every row whether it is valid, has a warning or is an error, and why.
 * Step 2 saves the rows that passed; the database checks them again, never credits a scholar twice, and writes each credit to the history as "imported". Scholars are matched by Scholar ID only.
 */
export function CreditedImportModal({ activity, period, defaultSchoolYear, periodLabel, onClose, onDone }: {
  activity: SDPActivity; period: CreditPeriod | null; defaultSchoolYear: string | null; periodLabel: string; onClose: () => void; onDone: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileRows, setFileRows] = useState<ImportRow[]>([]);
  const [checked, setChecked] = useState<ImportChecked[]>([]);
  const [headerError, setHeaderError] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [view, setView] = useState<View>("all");
  const [limit, setLimit] = useState(100);
  const [outcome, setOutcome] = useState<{ credited: number; skipped: number; errors: number; report: string[][] } | null>(null);
  const [skippedExample, setSkippedExample] = useState(0);

  const totals = importTotals(checked);

  function reset() {
    setFileName(""); setFileRows([]); setChecked([]); setHeaderError(""); setError(""); setMissing(false); setOutcome(null); setView("all"); setLimit(100); setSkippedExample(0);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleFile(file: File) {
    reset(); setFileName(file.name);
    if (file.size > IMPORT_MAX_MB * 1024 * 1024) { setHeaderError(`The file is larger than ${IMPORT_MAX_MB} MB. Please split it into smaller files.`); return; }
    let grid: string[][];
    try {
      if (/\.xlsx$/i.test(file.name)) grid = await readXlsx(await file.arrayBuffer());
      else if (/\.(csv|txt)$/i.test(file.name)) grid = parseCsv((await file.text()).replace(/^﻿/, ""));
      else { setHeaderError("Choose an Excel file (.xlsx) or a CSV file (.csv)."); return; }
    } catch { setHeaderError("This file could not be read. Is it a real .xlsx or .csv file?"); return; }
    const parsed = parseImportGrid(grid, defaultSchoolYear);
    if (parsed.headerError) { setHeaderError(parsed.headerError); return; }
    setSkippedExample(parsed.skippedExample);
    if (parsed.rows.length === 0) { setHeaderError("There are no rows to import (only the column names, or only the example row)."); return; }
    if (parsed.rows.length > IMPORT_MAX_ROWS) { setHeaderError(`The file has ${parsed.rows.length.toLocaleString("en-US")} rows; at most ${IMPORT_MAX_ROWS.toLocaleString("en-US")} can be checked at a time. Please split the file.`); return; }
    setFileRows(parsed.rows);
    setChecking(true);
    const r = await checkImport(activity.id, parsed.rows, period);      // STEP 1: nothing is saved
    setChecking(false);
    if (!r.ok) { setError(r.missing ? `This needs the latest database update (${FILTERS_SQL}). Ask the IT admin to run it.` : r.error); setMissing(r.missing); return; }
    setChecked(r.rows);
  }

  async function handleSave() {
    const ready = checked.filter(c => c.willCredit).map(c => fileRows.find(r => r.i === c.i)).filter((r): r is ImportRow => !!r);
    if (ready.length === 0) return;
    if (!window.confirm(`Credit ${ready.length.toLocaleString("en-US")} scholar${ready.length === 1 ? "" : "s"} for “${activity.name}”? Each credit is written to the credit history as “imported” with your name. Scholars who already have this credit are skipped.`)) return;
    setError(""); setSaving({ done: 0, total: ready.length });
    const results: ImportSaveResult[] = []; let credited = 0, skipped = 0, errors = 0;
    for (let at = 0; at < ready.length; at += IMPORT_SAVE_CHUNK) {
      const r = await saveImport(activity.id, ready.slice(at, at + IMPORT_SAVE_CHUNK), period);      // STEP 2: the database checks again
      if (!r.ok) { setError(`${r.error} ${credited.toLocaleString("en-US")} were credited before this stopped; check the list and run the import again (nobody is credited twice).`); break; }
      credited += r.credited; skipped += r.skipped; errors += r.errors; results.push(...r.results);
      setSaving({ done: Math.min(at + IMPORT_SAVE_CHUNK, ready.length), total: ready.length });
    }
    setSaving(null);
    const checkSkipped = checked.filter(c => !c.willCredit && c.state !== "error").length, checkErrors = checked.filter(c => c.state === "error").length;
    setOutcome({ credited, skipped: skipped + checkSkipped, errors: errors + checkErrors, report: importReportRows(fileRows, results, checked) });
    onDone();
  }

  const shown = checked.filter(c => view === "all" ? true : view === "credit" ? c.willCredit : view === "skipped" ? c.skip && c.state !== "error" : c.state === "error");
  const byI = new Map(fileRows.map(r => [r.i, r]));

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center overflow-y-auto bg-black/40 px-3 py-6 sm:px-4 sm:py-8" onClick={() => { if (!saving && !checking) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Import credits" className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-5 py-4">
          <h3 className="flex items-center gap-2 text-[15px] font-bold text-white"><FileSpreadsheet size={16} className="text-[#F3BC00]" /> Import credits · {activity.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close" disabled={!!saving || checking} className="text-white/70 hover:text-white disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="space-y-3 p-5">
          {outcome ? (
            <div className="py-2 text-center">
              <CheckCircle2 size={36} className="mx-auto mb-2 text-green-600" />
              <p className="text-[16px] font-bold text-[#062444]">{importSummaryText(outcome.credited, outcome.skipped, outcome.errors)}</p>
              <p className="mt-1 text-[13px] text-slate-600">Each credit is in the credit history as “imported”, and the list shows How credited = Import.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {outcome.report.length > 0 && <button type="button" onClick={() => void downloadTable([IMPORT_REPORT_HEADERS, ...outcome.report], `Import-error-report_${manilaDay(new Date().toISOString())}.xlsx`, "xlsx", [16, 22, 24, 16, 80], "Not credited")} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 px-4 py-2 text-[13px] font-semibold text-[#062444] hover:bg-[#f7f9fc]"><Download size={14} /> Download error report ({outcome.report.length})</button>}
                <button type="button" onClick={onClose} className="rounded-lg bg-[#062444] px-5 py-2 text-[13px] font-bold text-white">Close</button>
              </div>
            </div>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-slate-700">
                <li>Download the template and fill in one row for each scholar. Scholars are found by <strong>Scholar ID</strong> only, never by name.</li>
                <li>Upload the file. It is only <strong>checked</strong>: nothing is saved yet.</li>
                <li>Read the check, then press <strong>Save valid rows</strong>. A scholar who already has the credit is skipped, so nobody is credited twice.</li>
              </ol>
              <p className="text-[12.5px] text-slate-600">A row without a semester counts in <strong>{periodLabel}</strong> (the “Counts in” choice). A file can have up to {IMPORT_MAX_ROWS.toLocaleString("en-US")} rows and {IMPORT_MAX_MB} MB.</p>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void downloadTemplate(activity.name)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3.5 py-2 text-[13px] font-semibold text-[#062444] hover:bg-[#f7f9fc]"><Download size={14} /> Download template</button>
                <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#062444] px-3.5 py-2 text-[13px] font-bold text-white ${checking || saving ? "pointer-events-none opacity-50" : ""}`}>
                  <Upload size={14} /> {fileName ? "Choose another file" : "Choose file"}
                  <input ref={fileInput} type="file" accept=".xlsx,.csv,.txt" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                </label>
                {fileName && <span className="min-w-0 truncate text-[13px] text-slate-700" title={fileName}>{fileName}</span>}
              </div>

              {headerError && <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{headerError}</p>}
              {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
              {missing && <p role="status" className="text-[13px] text-slate-600">Update needed: {FILTERS_SQL}</p>}
              {checking && <p role="status" className="flex items-center gap-2 text-[13px] text-slate-700"><Loader2 size={15} className="animate-spin" /> Checking {fileRows.length.toLocaleString("en-US")} rows… nothing is saved.</p>}

              {checked.length > 0 && (
                <>
                  <p className="text-[13px] text-slate-700" role="status">
                    Checked {checked.length.toLocaleString("en-US")} rows{skippedExample > 0 ? " (the example row was left out)" : ""}: <strong className="text-green-800">{totals.valid} valid</strong>, <strong className="text-amber-900">{totals.warning} warning{totals.warning === 1 ? "" : "s"}</strong>, <strong className="text-red-800">{totals.error} error{totals.error === 1 ? "" : "s"}</strong>. <strong>{totals.willCredit.toLocaleString("en-US")}</strong> will be credited{totals.skipped > 0 ? `, ${totals.skipped} skipped` : ""}.
                  </p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show rows">
                    {([["all", `All (${checked.length})`], ["credit", `Will be credited (${totals.willCredit})`], ["skipped", `Skipped (${totals.skipped})`], ["error", `Errors (${totals.error})`]] as const).map(([k, label]) => (
                      <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setLimit(100); }} className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${view === k ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>{label}</button>
                    ))}
                  </div>
                  <div className="max-h-[48vh] overflow-auto rounded-xl border border-[#e6ecf5]">
                    <table className="w-full min-w-[640px] border-collapse text-[13px]">
                      <thead><tr className="sticky top-0 bg-[#f8fafd] text-left text-[12px] font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-2">Row</th><th className="px-3 py-2">Scholar ID</th><th className="px-3 py-2">Scholar</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th>
                      </tr></thead>
                      <tbody>
                        {shown.slice(0, limit).map(c => {
                          const f = byI.get(c.i);
                          return (
                            <tr key={c.i} className="border-t border-[#f0f3f8] align-top">
                              <td className="px-3 py-2 tabular-nums text-slate-600">{c.i}</td>
                              <td className="px-3 py-2 tabular-nums">{f?.scholar_id || "—"}</td>
                              <td className="px-3 py-2">{c.name || "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2">{c.date ? formatCreditDate(c.date) : f?.date_text || "—"}</td>
                              <td className="px-3 py-2"><span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-bold ${STATE_STYLE[c.state]}`}>{STATE_LABEL[c.state]}</span><span className="mt-0.5 block text-[12px] text-slate-600">{importOutcomeText(c)}</span></td>
                              <td className="px-3 py-2 text-slate-800">{c.messages.length ? c.messages.join(" ") : "—"}</td>
                            </tr>
                          );
                        })}
                        {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">No rows here.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {shown.length > limit && <button type="button" onClick={() => setLimit(l => l + 200)} className="text-[13px] font-semibold text-[#00709f] hover:underline">Show more ({(shown.length - limit).toLocaleString("en-US")} more rows)</button>}
                  <div className="flex flex-wrap items-center gap-3 border-t border-[#f0f3f8] pt-3">
                    <button type="button" onClick={() => void handleSave()} disabled={totals.willCredit === 0 || !!saving} className="rounded-lg bg-[#062444] px-5 py-2 text-[13.5px] font-bold text-white disabled:opacity-40">
                      {saving ? `Saving… ${saving.done.toLocaleString("en-US")} of ${saving.total.toLocaleString("en-US")}` : `Save valid rows (${totals.willCredit.toLocaleString("en-US")})`}
                    </button>
                    <button type="button" onClick={onClose} disabled={!!saving} className="text-[13px] font-semibold text-slate-600 disabled:opacity-40">Cancel</button>
                    {totals.willCredit === 0 && <span className="text-[13px] text-slate-600">Nothing in this file can be credited.</span>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
