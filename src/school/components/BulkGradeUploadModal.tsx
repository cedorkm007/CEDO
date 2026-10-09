import { useMemo, useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2, UploadCloud, Download, XCircle, Info, MinusCircle } from "lucide-react";
import { downloadCsv } from "@/sead/csvUtils";
import { downloadGradeTemplate } from "../templateDownload";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { fetchGradingConfig, fetchLetterGrades, fetchGradesForScholars, bulkUpsertGrades } from "../schoolApi";
import {
  parseGradeUpload, countRows, rowsToSave, summaryText, buildErrorReport,
  type ParseResult, type PreviewRow, type SaveOutcome,
} from "../bulkGradeLogic";
import { periodOptions, periodKey, periodRefOf, periodTitle, type AcademicPeriod } from "@/lib/academicPeriods";
import type { SchoolScholarRow } from "../types";

type Filter = "all" | "valid" | "warning" | "error" | "unchanged";
const SAVE_CHUNK = 200;

function statusChip(r: PreviewRow) {
  if (r.status === "error") return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><XCircle size={12} /> Error</span>;
  if (r.action === "unchanged") return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5"><MinusCircle size={12} /> No change</span>;
  if (r.status === "warning") return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><AlertTriangle size={12} /> Warning</span>;
  return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-green-800 bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><CheckCircle2 size={12} /> Valid</span>;
}

/**
 * Bulk grade upload with validate-then-save:
 *   1. pick the period (Open periods only) -> 2. download the template for it -> 3. upload the filled file ->
 *   4. every row is checked and previewed, NOTHING is saved yet -> 5. "Save valid rows" or cancel -> 6. summary + error report.
 * Rows are matched to scholars by Scholar ID, never by name. The checks live in ../bulkGradeLogic.ts; the database re-checks
 * the period, the school's own scholars and the grading scale on every row it saves.
 */
export function BulkGradeUploadModal({
  scholars, schoolId, periods, initialKey, onClose, onDone,
}: {
  scholars: SchoolScholarRow[]; schoolId: string; periods: AcademicPeriod[]; initialKey: string; onClose: () => void; onDone: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openPeriods = useMemo(() => periods.filter(p => p.status === "open"), [periods]);
  const options = useMemo(() => periodOptions(openPeriods, null), [openPeriods]);
  const [selectedKey, setSelectedKey] = useState<string>(() => (options.some(o => o.key === initialKey) ? initialKey : options[0]?.key ?? ""));
  const period = openPeriods.find(p => periodKey(p.schoolYear, p.term) === selectedKey) ?? null;

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<"" | "template" | "checking" | "saving">("");
  const [problem, setProblem] = useState("");
  const [outcomes, setOutcomes] = useState<SaveOutcome[] | null>(null);

  const counts = useMemo(() => (parsed ? countRows(parsed.rows) : null), [parsed]);
  const shownRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.filter(r => {
      if (filter === "all") return true;
      if (filter === "error") return r.status === "error";
      if (filter === "unchanged") return r.status !== "error" && r.action === "unchanged";
      if (filter === "warning") return r.status === "warning" && r.action !== "unchanged";
      return r.status === "valid" && r.action !== "unchanged";
    });
  }, [parsed, filter]);

  function resetUpload() {
    setFileName(null);
    setParsed(null);
    setOutcomes(null);
    setProblem("");
    setFilter("all");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function chooseOtherPeriod(key: string) {
    setSelectedKey(key);
    resetUpload();
  }

  async function handleDownloadTemplate() {
    if (!period) return;
    setBusy("template");
    setProblem("");
    const result = await downloadGradeTemplate(scholars, periodRefOf(period));
    setBusy("");
    if (!result.ok) setProblem(`Couldn't prepare the template: ${result.error}`);
  }

  async function handleFile(file: File) {
    if (!period) return;
    setFileName(file.name);
    setOutcomes(null);
    setProblem("");
    setParsed(null);
    setBusy("checking");
    try {
      const text = await file.text();
      // Fresh copies of what is already saved and of the school's scale, so warnings and range checks are current.
      const [existing, config] = await Promise.all([fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), periodRefOf(period)), fetchGradingConfig()]);
      if (!existing.ok) { setProblem(`Couldn't compare the file with your saved grades: ${existing.error}`); setBusy(""); return; }
      const letters = config?.usesLetterGrades ? await fetchLetterGrades(schoolId) : [];
      const result = parseGradeUpload(text, {
        period: periodRefOf(period), periodStatus: period.status, scholars, existing: existing.rows, config, letters,
      });
      setParsed(result);
      setFilter("all");
    } catch (e) {
      setProblem(`Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy("");
  }

  async function handleSave() {
    if (!parsed || parsed.fileError) return;
    const toSave = rowsToSave(parsed.rows);
    if (toSave.length === 0) return;
    setBusy("saving");
    setProblem("");
    const done: SaveOutcome[] = [];
    for (let i = 0; i < toSave.length; i += SAVE_CHUNK) {
      const chunk = toSave.slice(i, i + SAVE_CHUNK);
      const result = await bulkUpsertGrades(chunk.map(r => r.payload!));
      if (!result.ok) {
        for (const row of chunk) done.push({ row, ok: false, error: result.error ?? "The request failed." });
        continue;
      }
      const byIndex = new Map((result.results ?? []).map(r => [r.rowIndex, r]));
      chunk.forEach((row, j) => {
        const r = byIndex.get(j);
        done.push(r ? { row, ok: r.ok, error: r.error } : { row, ok: false, error: "The database did not report a result for this row." });
      });
    }
    setOutcomes(done);
    setBusy("");
    onDone();
  }

  function downloadErrorReport() {
    if (!parsed) return;
    const csv = buildErrorReport(parsed.headers, parsed.rows, outcomes ?? []);
    if (csv) downloadCsv(`grades-error-report_${selectedKey.replace("|", "_").replace(/\s+/g, "-")}.csv`, csv);
  }

  const savedCount = outcomes?.filter(o => o.ok).length ?? 0;
  const failedAtSave = outcomes?.filter(o => !o.ok) ?? [];
  const skippedCount = (counts?.error ?? 0) + failedAtSave.length;
  const hasReport = !!parsed && !parsed.fileError && !!buildErrorReport(parsed.headers, parsed.rows, outcomes ?? []);

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UploadCloud size={16} className="text-[#F3BC00]" /> Bulk Upload Grades</h3>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {outcomes !== null ? (
            <div className="text-center py-2">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p role="status" className="text-[15px] font-bold text-[#062444] mb-1">{summaryText(savedCount, skippedCount, counts?.unchanged ?? 0)}</p>
              <p className="text-[14px] text-slate-700">{period ? periodTitle(periodRefOf(period)) : ""}</p>
              {failedAtSave.length > 0 && (
                <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[14px] font-semibold text-red-700 mb-1.5">{failedAtSave.length} row(s) could not be saved:</p>
                  {failedAtSave.slice(0, 20).map((o, i) => (
                    <p key={i} className="text-[13.5px] text-red-700">Row {o.row.rowNumber}: {o.error}</p>
                  ))}
                  {failedAtSave.length > 20 && <p className="text-[13.5px] text-red-700">…and {failedAtSave.length - 20} more (see the error report).</p>}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                {hasReport && (
                  <button onClick={downloadErrorReport} className="flex items-center gap-1.5 border border-[#062444]/25 text-[#062444] text-[14px] font-semibold rounded-lg px-4 py-2.5">
                    <Download size={14} /> Download error report (CSV)
                  </button>
                )}
                <button onClick={resetUpload} className="border border-[#062444]/25 text-[#062444] text-[14px] font-semibold rounded-lg px-4 py-2.5">Upload another file</button>
                <button onClick={onClose} className="bg-[#062444] text-white text-[14px] font-semibold rounded-lg px-5 py-2.5">Done</button>
              </div>
            </div>
          ) : (
            <>
              {/* 1. Period */}
              <section className="mb-5">
                <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">1. Choose the period</h4>
                {options.length === 0 ? (
                  <p className="text-[14px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    There is no Open grading period right now, so grades can't be uploaded. Ask CEDO to open one.
                  </p>
                ) : (
                  <>
                    <PeriodSelect label="Period" options={options} value={selectedKey} onChange={chooseOtherPeriod} />
                    <p className="text-[13.5px] text-slate-700 mt-1.5">Only Open periods are listed. Every row in your file must be for this period.</p>
                  </>
                )}
              </section>

              {/* 2. Template */}
              <section className="mb-5">
                <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">2. Download the template</h4>
                <p className="text-[14px] text-slate-700 mb-2">
                  It comes pre-filled with the period, each of your scholars (Scholar ID and name) and the subjects already declared, so you only need to type
                  grades. Columns: school_year, semester, scholar_id, scholar_name, subject_code, subject_name, units, grade. A blank grade means “not graded yet”.
                  Scholars are matched by <strong>Scholar ID</strong>, not by name.
                </p>
                <button onClick={() => void handleDownloadTemplate()} disabled={!period || busy !== ""}
                  className="flex items-center gap-1.5 text-[14px] font-semibold text-[#0077b6] hover:opacity-80 disabled:opacity-50">
                  <Download size={14} /> {busy === "template" ? "Preparing…" : "Download CSV template"}
                </button>
              </section>

              {/* 3. Upload */}
              <section className="mb-4">
                <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">3. Upload your filled file</h4>
                <div className="border-2 border-dashed border-[#062444]/20 rounded-xl px-4 py-5 text-center">
                  <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose CSV file"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                  <Upload size={20} className="mx-auto text-slate-700 mb-2" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={!period || busy !== ""} className="text-[14px] font-semibold text-[#0077b6] hover:opacity-80 disabled:opacity-50">
                    {fileName ? "Choose a different CSV file" : "Choose CSV file"}
                  </button>
                  {fileName && <p className="text-[13.5px] text-slate-700 mt-1">{fileName}</p>}
                  <p className="text-[13.5px] text-slate-700 mt-1">Nothing is saved until you review the preview below and confirm.</p>
                </div>
                {busy === "checking" && <p className="text-[14px] text-slate-700 mt-2">Checking every row…</p>}
              </section>

              {problem && (
                <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
                  <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[14px] text-red-700">{problem}</p>
                </div>
              )}
              {parsed?.fileError && (
                <div role="alert" className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
                  <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[14px] font-semibold text-red-700 mb-0.5">This file was rejected.</p>
                    <p className="text-[14px] text-red-700">{parsed.fileError}</p>
                  </div>
                </div>
              )}

              {/* 4. Preview */}
              {parsed && !parsed.fileError && counts && (
                <section className="mb-4">
                  <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">4. Review — nothing has been saved yet</h4>
                  <div className="flex flex-wrap gap-2 mb-2" role="group" aria-label="Filter rows">
                    {([
                      ["all", `All (${parsed.rows.length})`],
                      ["valid", `Valid (${counts.valid})`],
                      ["warning", `Warnings (${counts.warning})`],
                      ["error", `Errors (${counts.error})`],
                      ["unchanged", `No change (${counts.unchanged})`],
                    ] as [Filter, string][]).map(([key, label]) => (
                      <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
                        className={`text-[14px] font-semibold rounded-full px-3 py-1 border ${filter === key ? "bg-[#062444] border-[#062444] text-white" : "bg-white border-[#062444]/25 text-[#062444]"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-auto border border-[#e6ecf5] rounded-lg">
                    <table className="w-full text-[14px]">
                      <thead className="bg-[#f7f9fc] sticky top-0">
                        <tr className="text-left text-slate-700">
                          <th className="px-3 py-2 font-bold">Row</th>
                          <th className="px-3 py-2 font-bold">Status</th>
                          <th className="px-3 py-2 font-bold">Scholar</th>
                          <th className="px-3 py-2 font-bold">Subject</th>
                          <th className="px-3 py-2 font-bold">Grade</th>
                          <th className="px-3 py-2 font-bold min-w-[14rem]">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownRows.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-700">No rows in this filter.</td></tr>
                        )}
                        {shownRows.map(r => (
                          <tr key={r.rowNumber} className="border-t border-[#f0f3f8] align-top">
                            <td className="px-3 py-2 text-slate-700">{r.rowNumber}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{statusChip(r)}</td>
                            <td className="px-3 py-2 text-slate-800">{r.scholarId}{r.scholarName ? <span className="block text-slate-700">{r.scholarName}</span> : null}</td>
                            <td className="px-3 py-2 text-slate-800">{r.subject || "—"}{r.subjectCode ? <span className="block text-slate-700">{r.subjectCode}</span> : null}</td>
                            <td className="px-3 py-2 font-semibold text-[#062444]">{r.grade || "—"}</td>
                            <td className={`px-3 py-2 ${r.status === "error" ? "text-red-700" : r.status === "warning" ? "text-amber-900" : "text-slate-700"}`}>
                              {r.messages.length > 0 ? r.messages.join(" ") : r.action === "unchanged" ? "Same as what is already saved." : r.action === "add" ? "New subject." : "Updates a declared subject."}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="flex items-start gap-1.5 text-[14px] text-slate-700 mt-2">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>{counts.toSave}</strong> row{counts.toSave === 1 ? "" : "s"} will be saved
                      {counts.warning > 0 ? ` (${counts.warning} with a warning — review them above)` : ""}.
                      {counts.error > 0 ? ` ${counts.error} row${counts.error === 1 ? " has" : "s have"} errors and will be skipped.` : ""}
                      {counts.unchanged > 0 ? ` ${counts.unchanged} already match what is saved.` : ""}
                      {parsed.ignoredBlank > 0 ? ` ${parsed.ignoredBlank} empty template row${parsed.ignoredBlank === 1 ? " was" : "s were"} ignored.` : ""}
                    </span>
                  </p>
                </section>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                {(parsed || fileName) && busy === "" && (
                  <button onClick={resetUpload} className="px-4 py-2.5 rounded-lg border border-[#062444]/25 text-[14px] font-semibold text-[#062444]">Cancel</button>
                )}
                {parsed && !parsed.fileError && (
                  <>
                    {counts && counts.error > 0 && counts.toSave > 0 && (
                      <button onClick={() => { setFilter("error"); }} className="px-4 py-2.5 text-[14px] font-semibold text-red-700">Show errors</button>
                    )}
                    <button onClick={() => void handleSave()} disabled={!counts || counts.toSave === 0 || busy !== ""}
                      className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[14px] font-semibold rounded-lg px-5 py-2.5">
                      {busy === "saving" ? "Saving…" : `Save valid rows${counts && counts.toSave > 0 ? ` (${counts.toSave})` : ""}`}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
