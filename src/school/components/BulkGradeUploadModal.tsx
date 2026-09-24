import { useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2, UploadCloud } from "lucide-react";
import { parseCsv, toCsv, downloadCsv, normalizeHeader, findColumn, cell } from "@/sead/csvUtils";
import { fetchCurrentGradingPeriod, fetchScholarGrades, bulkUpsertGrades, type UpsertGradeInput, type BulkGradeRowResult } from "../schoolApi";
import type { SchoolScholarRow } from "../types";
import type { GradingPeriod } from "@/sead/scholarsGradesMonitoringApi";

const TEMPLATE_HEADERS = ["Row ID (leave as-is)", "Scholar ID Number", "Name", "Subject Code", "Subject Name", "Grade"];

interface ParsedRow {
  rowNumber: number;
  ok: boolean;
  error?: string;
  preview: string;
  input?: UpsertGradeInput;
}

function displayName(row: SchoolScholarRow): string {
  const mi = row.middleName.trim() ? `${row.middleName.trim()[0]}.` : "";
  return [row.firstName, mi, row.lastName].filter(Boolean).join(" ");
}

async function downloadTemplate(scholars: SchoolScholarRow[], period: GradingPeriod) {
  const rows: (string | number)[][] = [];
  for (const s of scholars) {
    const existing = await fetchScholarGrades(s.scholarIdNumber, period);
    if (existing.length > 0) {
      for (const g of existing) rows.push([g.id, s.scholarIdNumber, displayName(s), g.subjectCode, g.subject, g.grade]);
    } else {
      rows.push(["", s.scholarIdNumber, displayName(s), "", "", ""]);
    }
  }
  downloadCsv(`grades-template-${period.schoolYear || "period"}.csv`, toCsv(TEMPLATE_HEADERS, rows));
}

function parseAndValidate(text: string, period: GradingPeriod): { rows: ParsedRow[]; headerError?: string } {
  const raw = parseCsv(text);
  if (raw.length < 1) return { rows: [], headerError: "The file is empty." };

  const headers = raw[0].map(normalizeHeader);
  const idx = {
    id: findColumn(headers, ["row id (leave as-is)", "row id", "id"]),
    scholarId: findColumn(headers, ["scholar id number", "scholar id", "scholarid"]),
    subjectCode: findColumn(headers, ["subject code", "code"]),
    subject: findColumn(headers, ["subject name", "subject"]),
    grade: findColumn(headers, ["grade"]),
  };

  if (idx.scholarId === -1) return { rows: [], headerError: 'Missing a "Scholar ID Number" column.' };
  if (idx.subject === -1) return { rows: [], headerError: 'Missing a "Subject Name" column.' };

  const dataRows = raw.slice(1);
  const parsed: ParsedRow[] = dataRows.map((r, i) => {
    const rowNumber = i + 2;
    const scholarIdNumber = cell(r, idx.scholarId);
    const subject = cell(r, idx.subject);
    const preview = `${scholarIdNumber} — ${subject || "(no subject)"}`;

    if (!scholarIdNumber) return { rowNumber, ok: false, error: "Scholar ID Number is required.", preview };
    if (!subject) return { rowNumber, ok: false, error: "Subject Name is required.", preview };

    return {
      rowNumber, ok: true, preview,
      input: {
        id: cell(r, idx.id) || null, scholarIdNumber, schoolYear: period.schoolYear, semester: period.semester,
        subjectCode: cell(r, idx.subjectCode), subject, grade: cell(r, idx.grade),
      },
    };
  });

  return { rows: parsed };
}

export function BulkGradeUploadModal({
  scholars, onClose, onDone,
}: { scholars: SchoolScholarRow[]; onClose: () => void; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkGradeRowResult[] | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const validRows = rows.filter(r => r.ok);
  const invalidRows = rows.filter(r => !r.ok);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    const period = await fetchCurrentGradingPeriod();
    await downloadTemplate(scholars, period);
    setDownloadingTemplate(false);
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setResults(null);
    setSubmitError(null);
    const period = await fetchCurrentGradingPeriod();
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const { rows: parsed, headerError: hErr } = parseAndValidate(text, period);
      setRows(parsed);
      setHeaderError(hErr ?? null);
    };
    reader.readAsText(file);
  }

  async function handleUpload() {
    if (validRows.length === 0) return;
    setUploading(true);
    setSubmitError(null);
    const inputs = validRows.map(r => r.input!);
    const result = await bulkUpsertGrades(inputs);
    setUploading(false);
    if (!result.ok) { setSubmitError(result.error || "Failed to upload."); return; }
    setResults(result.results ?? []);
    onDone();
  }

  function reset() {
    setFileName(null);
    setRows([]);
    setHeaderError(null);
    setResults(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const successCount = results?.filter(r => r.ok).length ?? 0;
  const failCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UploadCloud size={16} className="text-[#F3BC00]" /> Bulk Upload Grades</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {results !== null ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p className="text-sm font-semibold text-[#062444] mb-1">{successCount} row{successCount === 1 ? "" : "s"} saved.</p>
              {failCount > 0 && (
                <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[12.5px] font-semibold text-red-600 mb-1.5">{failCount} row(s) failed:</p>
                  {results.filter(r => !r.ok).map((r, i) => (
                    <p key={i} className="text-[12px] text-red-600">Row {validRows[r.rowIndex]?.rowNumber ?? "?"}: {r.error}</p>
                  ))}
                </div>
              )}
              <button onClick={onClose} className="mt-5 bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-slate-500 mb-3">
                Download the template — one row per scholar in this Year Level/Program, names pre-filled. Fill in Subject Code, Subject Name, and Grade (grade may be left blank to declare a subject without grading it yet), then upload it below.
              </p>

              <div className="mb-4">
                <button onClick={handleDownloadTemplate} disabled={downloadingTemplate}
                  className="text-[13px] font-semibold text-[#0088cc] hover:opacity-80 disabled:opacity-60">
                  {downloadingTemplate ? "Preparing…" : "Download CSV Template"}
                </button>
              </div>

              <div className="border-2 border-dashed border-[#062444]/15 rounded-xl px-4 py-6 text-center mb-4">
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
                <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                <button onClick={() => fileInputRef.current?.click()} className="text-[13px] font-semibold text-[#0088cc] hover:opacity-80">
                  {fileName ? "Choose a different CSV file" : "Choose CSV file"}
                </button>
                {fileName && <p className="text-[12px] text-slate-400 mt-1">{fileName}</p>}
              </div>

              {headerError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
                  <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-red-600">{headerError}</p>
                </div>
              )}
              {submitError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mb-4">
                  <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-red-600">{submitError}</p>
                </div>
              )}

              {rows.length > 0 && !headerError && (
                <div className="mb-4">
                  <div className="flex items-center gap-4 mb-2">
                    <p className="text-[12.5px] font-semibold text-green-700">{validRows.length} ready to upload</p>
                    {invalidRows.length > 0 && <p className="text-[12.5px] font-semibold text-red-600">{invalidRows.length} with errors</p>}
                  </div>
                  <div className="max-h-52 overflow-y-auto border border-[#e6ecf5] rounded-lg divide-y divide-[#f0f3f8]">
                    {rows.map((r, i) => (
                      <div key={i} className="px-3 py-2 flex items-start gap-2 text-[12.5px]">
                        <span className="shrink-0 text-slate-400 w-14">Row {r.rowNumber}</span>
                        {r.ok ? <span className="text-[#062444] flex-1 truncate">{r.preview}</span> : <span className="text-red-600 flex-1">{r.preview} — {r.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {rows.length > 0 && <button onClick={reset} className="text-[13px] font-semibold text-slate-400 hover:opacity-80">Reset</button>}
                <button onClick={handleUpload} disabled={validRows.length === 0 || uploading}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {uploading ? "Saving…" : `Save ${validRows.length || ""} Row${validRows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
