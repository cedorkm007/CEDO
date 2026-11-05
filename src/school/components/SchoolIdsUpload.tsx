import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, Link2, MinusCircle, Upload, XCircle } from "lucide-react";
import { downloadCsv, parseCsv } from "@/sead/csvUtils";
import { readXlsx } from "@/lib/xlsxLite";
import { linkStudentNos } from "../schoolApi";
import { buildIdsReport, parseSchoolIdsUpload, type IdRow, type IdsResult } from "../bulkGradeLogic";
import type { SchoolScholarRow } from "../types";

const LINK_CHUNK = 200;
const SHOWN_LEFT_OUT = 200;

function chip(r: IdRow) {
  if (r.status === "error") return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><XCircle size={12} /> Needs attention</span>;
  if (r.status === "same") return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5"><MinusCircle size={12} /> Already saved</span>;
  return <span className="inline-flex items-center gap-1 text-[13px] font-bold text-green-800 bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><CheckCircle2 size={12} /> Will be saved</span>;
}

/**
 * "School IDs only": the school uploads its own Excel list (the Promotional Report / Enrollment List) and only the STUDENT NO. of each of its scholars is saved. No grade is read.
 * The list holds every student of the school, so the students who are not scholars are left out (and listed, so nothing is lost without the school seeing it).
 * A Student No. the system does not know yet is matched to a scholar by exact name and saved only after the school confirms it. The checks are in ../bulkGradeLogic.ts
 * (parseSchoolIdsUpload); the database re-checks every link (school_link_student_nos).
 */
export function SchoolIdsUpload({ scholars, initialFile, onDone, onClose }: { scholars: SchoolScholarRow[]; initialFile?: File | null; onDone: () => void; onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<IdsResult | null>(null);
  const [busy, setBusy] = useState<"" | "checking" | "saving">("");
  const [linksOk, setLinksOk] = useState(false);
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState<{ saved: number; failed: { row: IdRow; error: string }[] } | null>(null);

  function reset() {
    setFileName(null); setParsed(null); setLinksOk(false); setProblem(""); setOutcome(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(file: File) {
    setFileName(file.name); setParsed(null); setOutcome(null); setProblem(""); setLinksOk(false); setBusy("checking");
    try {
      if (/\.xls$/i.test(file.name)) { setProblem("That is an older Excel file (.xls). Please open it in Excel, choose Save As, pick Excel Workbook (.xlsx), and upload that."); setBusy(""); return; }
      const grid = /\.xlsx$/i.test(file.name) ? await readXlsx(await file.arrayBuffer()) : parseCsv((await file.text()).replace(/^﻿/, ""));
      setParsed(parseSchoolIdsUpload(grid, scholars));
    } catch (e) {
      setProblem(`Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy("");
  }

  // a file the school already chose in the grades upload (it had no grades) is checked again here, without choosing it twice
  const started = useRef(false);
  useEffect(() => { if (initialFile && !started.current) { started.current = true; void handleFile(initialFile); } }, [initialFile]);   // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const rows = parsed?.rows ?? [];
    return { link: rows.filter(r => r.status === "link").length, same: rows.filter(r => r.status === "same").length, error: rows.filter(r => r.status === "error").length };
  }, [parsed]);
  const report = parsed && !parsed.fileError ? buildIdsReport(parsed) : null;

  async function handleSave() {
    if (!parsed || parsed.fileError || parsed.links.length === 0 || !linksOk) return;
    setBusy("saving"); setProblem("");
    const byScholar = new Map(parsed.rows.filter(r => r.status === "link").map(r => [r.scholarId, r]));
    const failed: { row: IdRow; error: string }[] = [];
    let saved = 0;
    for (let i = 0; i < parsed.links.length; i += LINK_CHUNK) {
      const chunk = parsed.links.slice(i, i + LINK_CHUNK);
      const res = await linkStudentNos(chunk.map(l => ({ scholarIdNumber: l.scholarIdNumber, studentNo: l.studentNo })));
      chunk.forEach((l, j) => {
        const row = byScholar.get(l.scholarIdNumber)!;
        if (!res.ok) failed.push({ row, error: res.error });
        else if (res.results[j]?.ok) saved++;
        else failed.push({ row, error: res.results[j]?.error ?? "The School ID could not be saved." });
      });
    }
    setOutcome({ saved, failed });
    setBusy("");
    onDone();
  }

  function downloadReport() { if (report) downloadCsv("school-ids-left-out-and-problems.csv", report); }

  if (outcome) {
    return (
      <div className="text-center py-2">
        <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
        <p role="status" className="text-[15px] font-bold text-[#062444] mb-1">{outcome.saved} School ID{outcome.saved === 1 ? "" : "s"} saved</p>
        <p className="text-[14px] text-slate-700">No grades were read or changed.</p>
        {parsed && counts.same > 0 && <p className="text-[14px] text-slate-700 mt-1">{counts.same} scholar{counts.same === 1 ? " already had" : "s already had"} their School ID.</p>}
        {parsed && parsed.leftOut.length > 0 && <p className="text-[14px] text-slate-700 mt-1">{parsed.leftOut.length} student{parsed.leftOut.length === 1 ? "" : "s"} on the list {parsed.leftOut.length === 1 ? "is" : "are"} not your scholars and {parsed.leftOut.length === 1 ? "was" : "were"} left out.</p>}
        {outcome.failed.length > 0 && (
          <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
            <p className="text-[14px] font-semibold text-red-700 mb-1.5">{outcome.failed.length} School ID{outcome.failed.length === 1 ? "" : "s"} could not be saved:</p>
            {outcome.failed.slice(0, 20).map((f, i) => <p key={i} className="text-[13.5px] text-red-700">{f.row.studentNo} ({f.row.scholarName}): {f.error}</p>)}
            {outcome.failed.length > 20 && <p className="text-[13.5px] text-red-700">…and {outcome.failed.length - 20} more.</p>}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          {report && <button onClick={downloadReport} className="flex items-center gap-1.5 border border-[#062444]/25 text-[#062444] text-[14px] font-semibold rounded-lg px-4 py-2.5"><Download size={14} /> Download the list of what was left out (CSV)</button>}
          <button onClick={reset} className="border border-[#062444]/25 text-[#062444] text-[14px] font-semibold rounded-lg px-4 py-2.5">Upload another file</button>
          <button onClick={onClose} className="bg-[#062444] text-white text-[14px] font-semibold rounded-lg px-5 py-2.5">Done</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="mb-4">
        <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">1. Upload your school's Excel list (Excel or CSV)</h4>
        <p className="text-[14px] text-slate-700 mb-2">
          Use your school's <strong>Promotional Report / Enrollment List</strong>. Only the <strong>STUDENT NO.</strong> and the name of each student are read: the grades can stay blank, and any grades in the file are ignored.
          Students who are <strong>not on your scholars list</strong> are left out automatically.
        </p>
        <div className="border-2 border-dashed border-[#062444]/20 rounded-xl px-4 py-5 text-center">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" aria-label="Choose Excel or CSV file with the School IDs"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
          <Upload size={20} className="mx-auto text-slate-700 mb-2" />
          <button onClick={() => fileInputRef.current?.click()} disabled={busy !== ""} className="text-[14px] font-semibold text-[#0077b6] hover:opacity-80 disabled:opacity-50">
            {fileName ? "Choose a different file" : "Choose Excel or CSV file"}
          </button>
          {fileName && <p className="text-[13.5px] text-slate-700 mt-1">{fileName}</p>}
          <p className="text-[13.5px] text-slate-700 mt-1">Nothing is saved until you review the list below and confirm.</p>
        </div>
        {busy === "checking" && <p className="text-[14px] text-slate-700 mt-2">Checking every student…</p>}
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
          <div><p className="text-[14px] font-semibold text-red-700 mb-0.5">This file was rejected.</p><p className="text-[14px] text-red-700">{parsed.fileError}</p></div>
        </div>
      )}

      {parsed && !parsed.fileError && (
        <section className="mb-4">
          <h4 className="text-[13.5px] font-bold text-[#062444] mb-1.5">2. Review — nothing has been saved yet</h4>
          <p className="text-[14px] text-slate-700 mb-2">
            The list has <strong>{parsed.sheetStudents}</strong> student{parsed.sheetStudents === 1 ? "" : "s"}: <strong>{parsed.rows.length}</strong> {parsed.rows.length === 1 ? "is" : "are"} your scholars and <strong>{parsed.leftOut.length}</strong> {parsed.leftOut.length === 1 ? "is" : "are"} not (left out).
          </p>
          <div className="flex flex-wrap gap-2 mb-2 text-[14px]">
            <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-800">{counts.link} to save</span>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 font-semibold text-slate-700">{counts.same} already saved</span>
            <span className={`rounded-full border px-3 py-1 font-semibold ${counts.error > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{counts.error} need attention</span>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 font-semibold text-slate-700">{parsed.leftOut.length} left out</span>
          </div>
          {parsed.gradesNotRead > 0 && (
            <p className="flex items-start gap-1.5 text-[14px] text-slate-700 mb-2"><Info size={14} className="shrink-0 mt-0.5" /><span>The file has {parsed.gradesNotRead} grade{parsed.gradesNotRead === 1 ? "" : "s"}. They are <strong>not read</strong> in this kind of upload. To save grades, go back and choose "Grades".</span></p>
          )}
          <div className="max-h-72 overflow-auto border border-[#e6ecf5] rounded-lg">
            <table className="w-full text-[14px]">
              <thead className="bg-[#f7f9fc] sticky top-0">
                <tr className="text-left text-slate-700">
                  <th className="px-3 py-2 font-bold">Row</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                  <th className="px-3 py-2 font-bold">Student No.</th>
                  <th className="px-3 py-2 font-bold">Scholar</th>
                  <th className="px-3 py-2 font-bold min-w-[14rem]">Note</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-700">No scholar of your school is on this list.</td></tr>}
                {parsed.rows.map(r => (
                  <tr key={`${r.rowNumber}-${r.studentNo}`} className="border-t border-[#f0f3f8] align-top">
                    <td className="px-3 py-2 text-slate-700">{r.rowNumber}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{chip(r)}</td>
                    <td className="px-3 py-2 text-slate-800">{r.studentNo || "—"}</td>
                    <td className="px-3 py-2 text-slate-800">{r.scholarName || r.fileName || "—"}{r.scholarId ? <span className="block text-slate-700">{r.scholarId}</span> : null}</td>
                    <td className={`px-3 py-2 ${r.status === "error" ? "text-red-700" : "text-slate-700"}`}>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {parsed.leftOut.length > 0 && (
            <details className="mt-3 rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3">
              <summary className="cursor-pointer text-[14px] font-bold text-[#062444]">{parsed.leftOut.length} student{parsed.leftOut.length === 1 ? "" : "s"} left out — not on your scholars list</summary>
              <p className="mt-2 text-[14px] text-slate-700">These students are on the sheet, but no scholar of your school has their Student No. or their name. Check that none of them is a scholar (a spelling that differs from the Scholars list is the usual reason). If one is, type the School ID in the Scholars list, then upload again.</p>
              <ul className="mt-2 max-h-40 overflow-y-auto text-[14px] text-slate-800">
                {parsed.leftOut.slice(0, SHOWN_LEFT_OUT).map((l, i) => <li key={i}>{l.name || "(no name)"}{l.studentNo ? <span className="text-slate-700"> · {l.studentNo}</span> : null}</li>)}
                {parsed.leftOut.length > SHOWN_LEFT_OUT && <li className="text-slate-700">…and {parsed.leftOut.length - SHOWN_LEFT_OUT} more (they are all in the downloaded list).</li>}
              </ul>
            </details>
          )}

          {parsed.links.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3" aria-label="New School IDs to save">
              <p className="flex items-center gap-1.5 text-[14px] font-bold text-amber-950"><Link2 size={14} aria-hidden="true" /> {parsed.links.length} new School ID{parsed.links.length === 1 ? "" : "s"} to save</p>
              <p className="mt-1 text-[14px] text-amber-950">The system did not know these Student Nos. yet. Each one matches exactly one of your scholars by name. After you confirm, the next uploads find them by Student No.</p>
              <label className="mt-2 flex items-start gap-2 text-[14px] font-semibold text-amber-950">
                <input type="checkbox" checked={linksOk} onChange={e => setLinksOk(e.target.checked)} className="mt-1" />
                <span>I checked these. They are the right scholars.</span>
              </label>
            </div>
          )}
          {counts.error > 0 && <p className="mt-2 text-[14px] text-red-700">{counts.error} scholar{counts.error === 1 ? "" : "s"} need{counts.error === 1 ? "s" : ""} attention and will be skipped. The note on each row says what to do.</p>}
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {(parsed || fileName) && busy === "" && <button onClick={reset} className="px-4 py-2.5 rounded-lg border border-[#062444]/25 text-[14px] font-semibold text-[#062444]">Cancel</button>}
        {report && busy === "" && <button onClick={downloadReport} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-[#062444]/25 text-[14px] font-semibold text-[#062444]"><Download size={14} /> Download the list of problems and left out (CSV)</button>}
        {parsed && !parsed.fileError && (
          <button onClick={() => void handleSave()} disabled={parsed.links.length === 0 || !linksOk || busy !== ""}
            title={parsed.links.length === 0 ? "There is no new School ID to save" : !linksOk ? "Tick the box to confirm the new School IDs first" : undefined}
            className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[14px] font-semibold rounded-lg px-5 py-2.5">
            {busy === "saving" ? "Saving…" : `Save ${parsed.links.length} School ID${parsed.links.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </>
  );
}
