import { useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2, UploadCloud } from "lucide-react";
import { createFinancialAssistanceApplicant, FA_MODES_OF_APPLICATION, type NewFinancialAssistanceApplicantInput, type FaModeOfApplication } from "../financialAssistanceApi";
import { parseCsv, toCsv, downloadCsv, normalizeHeader, findColumn, cell } from "../csvUtils";
import { ExportButton } from "@/app/components/ExportButtons";

const TEMPLATE_HEADERS = [
  "Name", "Barangay", "School", "Program", "Year Level", "Vulnerable Sector",
  "Mode of Application (Walk-in or People's Day)",
  "Father's First Name", "Father's Middle Initial", "Father's Last Name",
  "Mother's First Name", "Mother's Middle Initial", "Mother's Last Name",
];
const TEMPLATE_SAMPLE_ROWS = [
  ["Juan Dela Cruz", "Carmen", "Cagayan de Oro College PHINMA", "BS Criminology", "1st Year", "Solo Parent", "Walk-in", "Pedro", "D", "Dela Cruz", "Maria", "S", "Dela Cruz"],
];

interface ParsedRow {
  rowNumber: number;
  ok: boolean;
  error?: string;
  preview: string;
  applicant?: Omit<NewFinancialAssistanceApplicantInput, "periodId">;
}

function downloadTemplate() {
  downloadCsv("financial-assistance-applicants-template.csv", toCsv(TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS));
}

function normalizeMode(raw: string): FaModeOfApplication | null {
  const s = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (s === "walkin") return "Walk-in";
  if (s === "peoplesday") return "People's Day";
  return null;
}

function parseAndValidate(text: string): { rows: ParsedRow[]; headerError?: string } {
  const raw = parseCsv(text);
  if (raw.length < 1) return { rows: [], headerError: "The file is empty." };

  const headers = raw[0].map(normalizeHeader);
  const idx = {
    name: findColumn(headers, ["name"]),
    barangay: findColumn(headers, ["barangay"]),
    school: findColumn(headers, ["school"]),
    program: findColumn(headers, ["program"]),
    yearLevel: findColumn(headers, ["year level", "yearlevel"]),
    vulnerableSector: findColumn(headers, ["vulnerable sector", "vulnerablesector"]),
    mode: findColumn(headers, ["mode of application (walk-in or people's day)", "mode of application", "mode"]),
    fatherFirstName: findColumn(headers, ["father's first name", "father first name", "father firstname"]),
    fatherMiddleInitial: findColumn(headers, ["father's middle initial", "father middle initial"]),
    fatherLastName: findColumn(headers, ["father's last name", "father last name", "father lastname"]),
    motherFirstName: findColumn(headers, ["mother's first name", "mother first name", "mother firstname"]),
    motherMiddleInitial: findColumn(headers, ["mother's middle initial", "mother middle initial"]),
    motherLastName: findColumn(headers, ["mother's last name", "mother last name", "mother lastname"]),
  };

  if (idx.name === -1) return { rows: [], headerError: 'Missing a "Name" column.' };
  if (idx.mode === -1) return { rows: [], headerError: 'Missing a "Mode of Application" column.' };

  const dataRows = raw.slice(1);
  const parsed: ParsedRow[] = dataRows.map((r, i) => {
    const rowNumber = i + 2;
    const name = cell(r, idx.name);
    const preview = name || `(row ${rowNumber})`;
    if (!name) return { rowNumber, ok: false, error: "Name is required.", preview };

    const modeRaw = cell(r, idx.mode);
    const mode = normalizeMode(modeRaw);
    if (!mode) return { rowNumber, ok: false, error: `Unrecognized mode of application: "${modeRaw}". Use "Walk-in" or "People's Day".`, preview };

    return {
      rowNumber, ok: true, preview,
      applicant: {
        name, barangay: cell(r, idx.barangay), school: cell(r, idx.school), program: cell(r, idx.program),
        yearLevel: cell(r, idx.yearLevel), vulnerableSector: cell(r, idx.vulnerableSector), modeOfApplication: mode,
        fatherFirstName: cell(r, idx.fatherFirstName), fatherMiddleInitial: cell(r, idx.fatherMiddleInitial), fatherLastName: cell(r, idx.fatherLastName),
        motherFirstName: cell(r, idx.motherFirstName), motherMiddleInitial: cell(r, idx.motherMiddleInitial), motherLastName: cell(r, idx.motherLastName),
      },
    };
  });

  return { rows: parsed };
}

export function BulkFinancialAssistanceUploadModal({
  periodId, onClose, onDone,
}: { periodId: string; onClose: () => void; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ row: ParsedRow; ok: boolean; error?: string }[] | null>(null);

  const validRows = rows.filter(r => r.ok);
  const invalidRows = rows.filter(r => !r.ok);

  function handleFile(file: File) {
    setFileName(file.name);
    setResults(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const { rows: parsed, headerError: hErr } = parseAndValidate(text);
      setRows(parsed);
      setHeaderError(hErr ?? null);
    };
    reader.readAsText(file);
  }

  async function handleUpload() {
    if (validRows.length === 0) return;
    setUploading(true);
    setProgress(0);
    const outcomes: { row: ParsedRow; ok: boolean; error?: string }[] = [];
    for (const row of validRows) {
      const result = await createFinancialAssistanceApplicant({ periodId, ...row.applicant! });
      outcomes.push({ row, ok: result.ok, error: result.error });
      setProgress(outcomes.length);
    }
    setUploading(false);
    setResults(outcomes);
    onDone();
  }

  function reset() {
    setFileName(null);
    setRows([]);
    setHeaderError(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const successCount = results?.filter(r => r.ok).length ?? 0;
  const failCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UploadCloud size={16} className="text-[#F3BC00]" /> Bulk Import Applicants</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {results !== null ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p className="text-sm font-semibold text-[#062444] mb-1">
                {successCount} applicant{successCount === 1 ? "" : "s"} added.
              </p>
              {failCount > 0 && (
                <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[12.5px] font-semibold text-red-600 mb-1.5">{failCount} row(s) failed:</p>
                  {results.filter(r => !r.ok).map((r, i) => (
                    <p key={i} className="text-[12px] text-red-600">Row {r.row.rowNumber} ({r.row.preview}): {r.error}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-center gap-3 mt-5">
                {failCount > 0 && (
                  <button onClick={reset} className="text-[13px] font-semibold text-[#0088cc] cursor-pointer hover:opacity-80 transition-opacity">Upload another file</button>
                )}
                <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-slate-500 mb-3">
                Download the template, fill in one row per applicant, then upload it below. Each row generates its own reference number and QR code, same as adding one applicant at a time.
              </p>

              <div className="mb-4">
                <ExportButton format="csv" onClick={downloadTemplate} label="Download CSV Template" />
              </div>

              <div className="border-2 border-dashed border-[#062444]/15 rounded-xl px-4 py-6 text-center mb-4">
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                <button onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }} className="text-[13px] font-semibold text-[#0088cc] hover:opacity-80 transition-opacity">
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
                        {r.ok ? (
                          <span className="text-[#062444] flex-1 truncate">{r.preview}</span>
                        ) : (
                          <span className="text-red-600 flex-1">{r.preview} — {r.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                {uploading && <span className="text-[12px] text-slate-400">{progress} / {validRows.length}</span>}
                <button onClick={handleUpload} disabled={validRows.length === 0 || uploading}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {uploading ? "Creating…" : `Create ${validRows.length || ""} Applicant${validRows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
