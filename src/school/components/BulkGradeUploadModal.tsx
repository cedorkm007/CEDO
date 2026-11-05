import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2, UploadCloud, Download, XCircle, Info, MinusCircle, Link2 } from "lucide-react";
import { downloadCsv, parseCsv } from "@/sead/csvUtils";
import { readXlsx } from "@/lib/xlsxLite";
import { TemplateDownloadMenu } from "./TemplateDownloadMenu";
import { SchoolIdsUpload } from "./SchoolIdsUpload";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { fetchGradingConfig, fetchLetterGrades, fetchSchoolMarksAsLetters, fetchGradesForScholars, bulkUpsertGrades, linkStudentNos } from "../schoolApi";
import {
  parseUploadedGrid, countRows, rowsToSave, summaryText, buildUploadErrorReport,
  type ParseResult, type PreviewRow, type SaveOutcome,
} from "../bulkGradeLogic";
import { periodOptions, periodKey, periodRefOf, periodTitle, type AcademicPeriod } from "@/lib/academicPeriods";
import { fetchRulesTimeline } from "@/lib/gradeRulesApi";
import { hasTable, rulesAt, type RuleVersion } from "@/lib/rulesRuntime";
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
 *   1. pick the period (Open periods only) -> 2. download the template for it (pre-filled or blank, asked each time) -> 3. upload the filled file (Excel or CSV) ->
 *   4. every row is checked and previewed, NOTHING is saved yet -> 5. "Save valid rows" or cancel -> 6. summary + error report.
 * The school's Promotional Report / Enrollment List finds each scholar by STUDENT NO. (the School ID); a Student No. the system does not know yet is matched
 * to a scholar by name and saved only after the school confirms the link. The earlier CSV layout finds scholars by Scholar ID. The checks live in
 * ../bulkGradeLogic.ts; the database re-checks the period, the school's own scholars and the grading scale on every row it saves.
 */
export function BulkGradeUploadModal({
  scholars, schoolId, schoolName, periods, initialKey, onClose, onDone,
}: {
  scholars: SchoolScholarRow[]; schoolId: string; schoolName: string; periods: AcademicPeriod[]; initialKey: string; onClose: () => void; onDone: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openPeriods = useMemo(() => periods.filter(p => p.status === "open"), [periods]);
  const options = useMemo(() => periodOptions(openPeriods, null), [openPeriods]);
  const [selectedKey, setSelectedKey] = useState<string>(() => (options.some(o => o.key === initialKey) ? initialKey : options[0]?.key ?? ""));
  const period = openPeriods.find(p => periodKey(p.schoolYear, p.term) === selectedKey) ?? null;
  // The school's grading rules for the chosen period: a percentage in the file becomes the grade of the conversion table, and the pre-filled Excel shows percentages for a school that enters them.
  const [ruleVersions, setRuleVersions] = useState<RuleVersion[]>([]);
  useEffect(() => { void fetchRulesTimeline().then(t => setRuleVersions(t[schoolId] ?? Object.values(t)[0] ?? [])); }, [schoolId]);
  const periodRules = useMemo(() => (period ? rulesAt(ruleVersions, period.schoolYear, period.term) : null), [ruleVersions, period]);

  /** grades = subjects and grades (School IDs on the sheet are linked too); ids = only the School ID (STUDENT NO.) of each scholar, no grade is read. */
  const [mode, setMode] = useState<"grades" | "ids">("grades");
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<"" | "checking" | "saving">("");
  const [linksOk, setLinksOk] = useState(false);              // the school ticked "these links are right"
  const [linkedCount, setLinkedCount] = useState(0);
  const [problem, setProblem] = useState("");
  const [outcomes, setOutcomes] = useState<SaveOutcome[] | null>(null);

  const counts = useMemo(() => (parsed ? countRows(parsed.rows) : null), [parsed]);
  const links = parsed?.links ?? [];
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
    setLinksOk(false);
    setLinkedCount(0);
    setLastFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function chooseOtherPeriod(key: string) {
    setSelectedKey(key);
    resetUpload();
  }

  async function handleFile(file: File) {
    if (!period) return;
    setLastFile(file);
    setFileName(file.name);
    setOutcomes(null);
    setProblem("");
    setParsed(null);
    setLinksOk(false);
    setBusy("checking");
    try {
      if (/\.xls$/i.test(file.name)) { setProblem("That is an older Excel file (.xls). Please open it in Excel, choose Save As, pick Excel Workbook (.xlsx), and upload that."); setBusy(""); return; }
      const grid = /\.xlsx$/i.test(file.name) ? await readXlsx(await file.arrayBuffer()) : parseCsv((await file.text()).replace(/^\ufeff/, ""));
      // Fresh copies of what is already saved and of the school's scale, so warnings and range checks are current.
      const [existing, config, timeline] = await Promise.all([fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), periodRefOf(period)), fetchGradingConfig(), fetchRulesTimeline()]);
      const rules = rulesAt(timeline[schoolId] ?? Object.values(timeline)[0] ?? [], period.schoolYear, period.term);
      if (!existing.ok) { setProblem(`Couldn't compare the file with your saved grades: ${existing.error}`); setBusy(""); return; }
      const letters = [...(config?.usesLetterGrades ? await fetchLetterGrades(schoolId) : []), ...(await fetchSchoolMarksAsLetters(schoolId))];
      const result = parseUploadedGrid(grid, {
        period: periodRefOf(period), periodStatus: period.status, scholars, existing: existing.rows, config, letters, rules,
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
    let toSave = rowsToSave(parsed.rows);
    if (toSave.length === 0 && links.length === 0) return;
    if (links.length > 0 && !linksOk) return;
    setBusy("saving");
    setProblem("");
    const done: SaveOutcome[] = [];
    // 1. the Student Nos. the school confirmed are linked to their scholars; a scholar whose link fails is not saved (the rows would be matched to nobody next time)
    if (links.length > 0) {
      const linked = await linkStudentNos(links.map(l => ({ scholarIdNumber: l.scholarIdNumber, studentNo: l.studentNo })));
      const failedIds = new Map<string, string>();
      if (!linked.ok) links.forEach(l => failedIds.set(l.scholarIdNumber, linked.error));
      else linked.results.forEach((r, i) => { if (!r.ok) failedIds.set(links[i].scholarIdNumber, r.error ?? "The link could not be saved."); });
      setLinkedCount(links.length - failedIds.size);
      if (failedIds.size > 0) {
        for (const row of toSave) { const why = failedIds.get(row.payload!.scholarIdNumber); if (why) done.push({ row, ok: false, error: `The Student No. could not be linked: ${why}` }); }
        toSave = toSave.filter(row => !failedIds.has(row.payload!.scholarIdNumber));
      }
    }
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
    const csv = period ? buildUploadErrorReport(parsed, periodRefOf(period), outcomes ?? []) : null;
    if (csv) downloadCsv(`grades-error-report_${selectedKey.replace("|", "_").replace(/\s+/g, "-")}.csv`, csv);
  }

  const savedCount = outcomes?.filter(o => o.ok).length ?? 0;
  const failedAtSave = outcomes?.filter(o => !o.ok) ?? [];
  const skippedCount = (counts?.error ?? 0) + failedAtSave.length;
  const hasReport = !!parsed && !parsed.fileError && !!period && !!buildUploadErrorReport(parsed, periodRefOf(period), outcomes ?? []);

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl my-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UploadCloud size={16} className="text-[#F3BC00]" /> {mode === "ids" ? "Upload School IDs" : "Bulk Upload Grades"}</h3>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {outcomes !== null ? (
            <div className="text-center py-2">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p role="status" className="text-[15px] font-bold text-[#062444] mb-1">{summaryText(savedCount, skippedCount, counts?.unchanged ?? 0)}</p>
              <p className="text-[14px] text-slate-700">{period ? periodTitle(periodRefOf(period)) : ""}</p>
              {linkedCount > 0 && <p className="text-[14px] text-slate-700 mt-1">{linkedCount} School ID{linkedCount === 1 ? "" : "s"} linked to the scholars.</p>}
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
              {/* What to upload */}
              <section className="mb-5" aria-label="What do you want to upload?">
                <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">What do you want to upload?</h4>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What do you want to upload?">
                  {([
                    ["grades", "Grades", "Subjects and grades from your Promotional Report / Enrollment List. The School ID (STUDENT NO.) of each scholar is saved too."],
                    ["ids", "School IDs only", "Only each scholar's STUDENT NO. is saved. The grades can stay blank. Students who are not your scholars are left out."],
                  ] as const).map(([key, title, text]) => (
                    <label key={key} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3.5 py-3 ${mode === key ? "border-[#062444] bg-[#eef5fc]" : "border-[#062444]/20 bg-white"}`}>
                      <input type="radio" name="upload-mode" checked={mode === key} onChange={() => { if (mode !== key) { setMode(key); resetUpload(); } }} className="mt-1" />
                      <span><span className="block text-[14px] font-bold text-[#062444]">{title}</span><span className="block text-[13.5px] text-slate-700">{text}</span></span>
                    </label>
                  ))}
                </div>
              </section>

              {mode === "ids" ? (
                <SchoolIdsUpload scholars={scholars} initialFile={lastFile} onDone={onDone} onClose={onClose} />
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
                  The template is your Promotional Report / Enrollment List (Excel). You choose whether it comes <strong>pre-filled</strong> with your scholars and the subjects
                  already saved, or <strong>blank</strong>. Each student is found by <strong>STUDENT NO.</strong> (the School ID); a blank grade means “not graded yet”.
                  The remark (PASSED, FAILED, DROPPED, INCOMPLETE) is saved with the grade.
                  {hasTable(periodRules) && periodRules.entryMode !== "grade" && (
                    <> Your school enters {periodRules.entryMode === "percentage" ? <strong>percentages</strong> : <>percentages or grades</>}: the <strong>GRADES</strong> column of the Excel sheet is read as the percentage
                    {periodRules.entryMode === "either" ? " (a value that is one of your conversion table's grades is read as the grade)" : ""}, and the system fills in the equivalent grade. The CSV has a <strong>percentage</strong> column for the same.</>
                  )}
                </p>
                {period && <TemplateDownloadMenu scholars={scholars} period={periodRefOf(period)} schoolName={schoolName} disabled={busy !== ""} percentageEntry={hasTable(periodRules) && periodRules.entryMode === "percentage"}
                  buttonClassName="flex items-center gap-1.5 text-[14px] font-semibold text-[#0077b6] hover:opacity-80 disabled:opacity-50" />}
              </section>

              {/* 3. Upload */}
              <section className="mb-4">
                <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">3. Upload your filled file (Excel or CSV)</h4>
                <div className="border-2 border-dashed border-[#062444]/20 rounded-xl px-4 py-5 text-center">
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Choose Excel or CSV file"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                  <Upload size={20} className="mx-auto text-slate-700 mb-2" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={!period || busy !== ""} className="text-[14px] font-semibold text-[#0077b6] hover:opacity-80 disabled:opacity-50">
                    {fileName ? "Choose a different file" : "Choose Excel or CSV file"}
                  </button>
                  {fileName && <p className="text-[13.5px] text-slate-700 mt-1">{fileName}</p>}
                  <p className="text-[13.5px] text-slate-700 mt-1">Nothing is saved until you review the preview below and confirm. A CSV in the older layout (matched by Scholar ID) still works.</p>
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

              {parsed && parsed.noGradesInFile && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#eef5fc] border border-[#cfe0f5] rounded-lg px-3 py-2.5 mb-4" role="status">
                  <p className="flex items-start gap-1.5 text-[14px] text-[#062444]"><Info size={14} className="shrink-0 mt-0.5" /><span>This file has <strong>no grades</strong>. Did you want to save only the School IDs?</span></p>
                  <button onClick={() => { setMode("ids"); }} className="text-[14px] font-semibold text-[#0077b6] hover:underline">Use this file for School IDs only</button>
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
                            <td className="px-3 py-2 text-slate-800">{r.studentNo !== undefined ? (r.studentNo || "—") : r.scholarId}{r.scholarName ? <span className="block text-slate-700">{r.scholarName}</span> : null}</td>
                            <td className="px-3 py-2 text-slate-800">{r.subject || "—"}{r.subjectCode ? <span className="block text-slate-700">{r.subjectCode}</span> : null}</td>
                            <td className="px-3 py-2 font-semibold text-[#062444]">{r.percentage ? <span className="font-normal text-slate-700">{r.percentage}% → </span> : null}{(r.status === "error" ? r.grade : r.gradeShown || r.grade) || "—"}{r.reading ? <span className="block text-[13px] font-normal text-slate-700">{r.reading}</span> : null}</td>
                            <td className={`px-3 py-2 ${r.status === "error" ? "text-red-700" : r.status === "warning" ? "text-amber-900" : "text-slate-700"}`}>
                              {r.messages.length > 0 ? r.messages.join(" ") : r.action === "unchanged" ? "Same as what is already saved." : r.action === "add" ? "New subject." : "Updates a declared subject."}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsed.leftOut.length > 0 && (
                    <details className="mt-3 rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3">
                      <summary className="cursor-pointer text-[14px] font-bold text-[#062444]">{parsed.leftOut.length} student{parsed.leftOut.length === 1 ? "" : "s"} left out — not on your scholars list</summary>
                      <p className="mt-2 text-[14px] text-slate-700">The sheet lists every student of your school. These are not scholars, so their rows were not checked or saved. If one of them is a scholar (a spelling that differs from the Scholars list is the usual reason), type the School ID in the Scholars list, then upload again.</p>
                      <ul className="mt-2 max-h-40 overflow-y-auto text-[14px] text-slate-800">
                        {parsed.leftOut.slice(0, 200).map((l, i) => <li key={i}>{l.name || "(no name)"}{l.studentNo ? <span className="text-slate-700"> · {l.studentNo}</span> : null} <span className="text-slate-700">({l.rows} row{l.rows === 1 ? "" : "s"})</span></li>)}
                        {parsed.leftOut.length > 200 && <li className="text-slate-700">…and {parsed.leftOut.length - 200} more.</li>}
                      </ul>
                    </details>
                  )}
                  {links.length > 0 && (
                    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3" aria-label="New School IDs to link">
                      <p className="flex items-center gap-1.5 text-[14px] font-bold text-amber-950"><Link2 size={14} aria-hidden="true" /> {links.length} new School ID{links.length === 1 ? "" : "s"} to link</p>
                      <p className="mt-1 text-[14px] text-amber-950">The system did not know these Student Nos. yet. Each one matches exactly one of your scholars by name. After you confirm, the next uploads find them by Student No.</p>
                      <ul className="mt-2 max-h-32 overflow-y-auto text-[14px] text-amber-950">
                        {links.map(l => <li key={l.scholarIdNumber}>Student No. <strong>{l.studentNo}</strong> → {l.scholarName} <span className="text-amber-900">({l.scholarIdNumber})</span></li>)}
                      </ul>
                      <label className="mt-2 flex items-start gap-2 text-[14px] font-semibold text-amber-950">
                        <input type="checkbox" checked={linksOk} onChange={e => setLinksOk(e.target.checked)} className="mt-1" />
                        <span>I checked these. They are the right scholars.</span>
                      </label>
                    </div>
                  )}
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
                    <button onClick={() => void handleSave()} disabled={!counts || (counts.toSave === 0 && links.length === 0) || (links.length > 0 && !linksOk) || busy !== ""}
                      title={links.length > 0 && !linksOk ? "Tick the box to confirm the new School IDs first" : undefined}
                      className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[14px] font-semibold rounded-lg px-5 py-2.5">
                      {busy === "saving" ? "Saving…" : counts && counts.toSave === 0 && links.length > 0 ? "Save the new School IDs" : `Save valid rows${counts && counts.toSave > 0 ? ` (${counts.toSave})` : ""}`}
                    </button>
                  </>
                )}
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
