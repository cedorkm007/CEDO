import { useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2, UploadCloud, Undo2 } from "lucide-react";
import { bulkCreateScholars, undoBulkScholarUpload, type NewScholarInput, type BulkScholarRowResult } from "../seadApi";
import { parseCsv, toCsv, downloadCsv, normalizeHeader, findColumn, cell } from "../csvUtils";
import { ExportButton } from "@/app/components/ExportButtons";

const TEMPLATE_HEADERS = [
  "Scholar ID Number", "First Name", "Last Name", "Middle Name", "Birthday (YYYY-MM-DD)",
  "Address", "School", "Course", "Civil Status", "Contact No.",
];

const TEMPLATE_SAMPLE_ROWS = [
  ["20250001", "Juan", "Dela Cruz", "Santos", "2004-05-14", "Butuan City", "Caraga State University", "BS Computer Science", "Single", "09171234567"],
];

interface ParsedRow {
  rowNumber: number; // 1-based, matches spreadsheet row (header = row 1)
  ok: boolean;
  error?: string;
  preview: string;
  scholar?: NewScholarInput;
}

function downloadTemplate() {
  downloadCsv("scholar-accounts-template.csv", toCsv(TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS));
}

// Accepts YYYY-MM-DD or MM/DD/YYYY and normalizes to YYYY-MM-DD.
function normalizeBirthday(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

function parseAndValidate(text: string): { rows: ParsedRow[]; headerError?: string } {
  const raw = parseCsv(text);
  if (raw.length < 1) return { rows: [], headerError: "The file is empty." };

  const headers = raw[0].map(normalizeHeader);
  const idx = {
    id: findColumn(headers, ["scholar id number", "scholar id", "scholarid", "id number", "id"]),
    first: findColumn(headers, ["first name", "firstname"]),
    last: findColumn(headers, ["last name", "lastname"]),
    middle: findColumn(headers, ["middle name", "middlename", "m.i.", "mi"]),
    birthday: findColumn(headers, ["birthday (yyyy-mm-dd)", "birthday", "birthdate", "birth date", "date of birth", "dob"]),
    address: findColumn(headers, ["address"]),
    school: findColumn(headers, ["school"]),
    course: findColumn(headers, ["course"]),
    civilStatus: findColumn(headers, ["civil status", "civilstatus"]),
    contactNo: findColumn(headers, ["contact no.", "contact no", "contact number", "contact"]),
  };

  if (idx.id === -1) return { rows: [], headerError: 'Missing a "Scholar ID Number" column.' };
  if (idx.first === -1) return { rows: [], headerError: 'Missing a "First Name" column.' };
  if (idx.last === -1) return { rows: [], headerError: 'Missing a "Last Name" column.' };
  if (idx.birthday === -1) return { rows: [], headerError: 'Missing a "Birthday" column.' };

  const dataRows = raw.slice(1);
  const parsed: ParsedRow[] = dataRows.map((r, i) => {
    const rowNumber = i + 2; // account for header row
    const scholarIdNumber = cell(r, idx.id);
    const firstName = cell(r, idx.first);
    const lastName = cell(r, idx.last);
    const preview = scholarIdNumber ? `${scholarIdNumber} — ${firstName} ${lastName}`.trim() : `(row ${rowNumber})`;

    if (!scholarIdNumber || !firstName || !lastName) {
      return { rowNumber, ok: false, error: "Scholar ID, first name, and last name are required.", preview };
    }
    const birthdayRaw = cell(r, idx.birthday);
    const birthday = normalizeBirthday(birthdayRaw);
    if (!birthday) return { rowNumber, ok: false, error: `Unrecognized birthday format: "${birthdayRaw}". Use YYYY-MM-DD or MM/DD/YYYY.`, preview };

    const scholar: NewScholarInput = {
      scholarIdNumber, firstName, lastName,
      middleName: cell(r, idx.middle),
      birthday,
      address: cell(r, idx.address),
      school: cell(r, idx.school),
      course: cell(r, idx.course),
      civilStatus: cell(r, idx.civilStatus),
      contactNo: cell(r, idx.contactNo),
    };
    return { rowNumber, ok: true, preview, scholar };
  });

  return { rows: parsed };
}

export function BulkScholarUploadModal({
  onClose, onDone,
}: { onClose: () => void; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkScholarRowResult[] | null>(null);
  const [rowLookup, setRowLookup] = useState<ParsedRow[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoResult, setUndoResult] = useState<{ removedCount: number } | { error: string } | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const validRows = rows.filter(r => r.ok);
  const invalidRows = rows.filter(r => !r.ok);

  function handleFile(file: File) {
    setFileName(file.name);
    setResults(null);
    setSubmitError(null);
    setBatchId(null);
    setUndoResult(null);
    setConfirmUndo(false);
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
    setSubmitError(null);
    const inputs = validRows.map(r => r.scholar!);
    const result = await bulkCreateScholars(inputs);
    setUploading(false);
    if (!result.ok) { setSubmitError(result.error || "Failed to upload."); return; }
    setResults(result.results ?? []);
    setRowLookup(validRows);
    setBatchId(result.batchId ?? null);
    onDone();
  }

  async function handleUndo() {
    if (!batchId) return;
    setUndoing(true);
    setUndoResult(null);
    const result = await undoBulkScholarUpload(batchId);
    setUndoing(false);
    if (!result.ok) { setUndoResult({ error: result.error || "Failed to undo this upload." }); return; }
    setUndoResult({ removedCount: result.removedCount ?? 0 });
    onDone();
  }

  function reset() {
    setFileName(null);
    setRows([]);
    setHeaderError(null);
    setResults(null);
    setSubmitError(null);
    setBatchId(null);
    setUndoResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function downloadCredentials() {
    if (!results) return;
    const successRows = results.filter(r => r.ok);
    const lines = successRows.map(r => {
      const parsedRow = rowLookup[r.index];
      const name = parsedRow?.scholar ? `${parsedRow.scholar.firstName} ${parsedRow.scholar.lastName}` : "";
      return [r.scholarIdNumber, name, r.password ?? ""];
    });
    downloadCsv(`scholar-credentials-${Date.now()}.csv`, toCsv(["scholar_id_number", "name", "password"], lines));
  }

  const successCount = results?.filter(r => r.ok).length ?? 0;
  const failCount = results?.filter(r => !r.ok).length ?? 0;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UploadCloud size={16} className="text-[#F3BC00]" /> Bulk Upload Scholars</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {results !== null ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p className="text-sm font-semibold text-[#062444] mb-1">
                {successCount} scholar account{successCount === 1 ? "" : "s"} created.
              </p>
              {successCount > 0 && (
                <div className="mx-auto w-fit mt-2">
                  <ExportButton format="csv" onClick={downloadCredentials} label="Download Credentials CSV" />
                </div>
              )}
              {successCount > 0 && (
                <p className="text-[12px] text-slate-400 mt-2 max-w-md mx-auto">
                  This file is the only copy of these passwords. Distribute it to scholars securely, then delete it.
                </p>
              )}
              {failCount > 0 && (
                <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[12.5px] font-semibold text-red-600 mb-1.5">{failCount} row(s) failed:</p>
                  {results.filter(r => !r.ok).map((r, i) => (
                    <p key={i} className="text-[12px] text-red-600">Row {rowLookup[r.index]?.rowNumber ?? "?"} ({r.scholarIdNumber}): {r.error}</p>
                  ))}
                </div>
              )}

              {successCount > 0 && batchId && !undoResult && (
                <div className="mt-4 border-t border-[#f0f3f8] pt-4">
                  {confirmUndo ? (
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-[12.5px] text-slate-500">Remove all {successCount} scholar account{successCount === 1 ? "" : "s"} just created?</span>
                      <button onClick={handleUndo} disabled={undoing} className="text-[12.5px] font-bold text-red-600 cursor-pointer hover:underline hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                        {undoing ? "…" : "Confirm"}
                      </button>
                      <button onClick={() => setConfirmUndo(false)} className="text-[12.5px] text-slate-400 cursor-pointer hover:underline hover:opacity-80 transition-opacity">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmUndo(true)}
                      className="flex items-center gap-2 mx-auto text-[12.5px] font-semibold text-red-600 cursor-pointer hover:underline hover:opacity-80 transition-opacity">
                      <Undo2 size={14} /> Undo this upload
                    </button>
                  )}
                </div>
              )}
              {undoResult && "removedCount" in undoResult && (
                <p className="text-[12.5px] font-semibold text-green-700 mt-4">
                  Undo complete — {undoResult.removedCount} account{undoResult.removedCount === 1 ? "" : "s"} removed.
                </p>
              )}
              {undoResult && "error" in undoResult && (
                <p className="text-[12.5px] font-semibold text-red-600 mt-4">{undoResult.error}</p>
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
                Download the template, fill in one row per scholar, then upload it below. Each new account gets its own randomly generated password, delivered in a downloadable credentials file after upload.
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

              <div className="flex justify-end">
                <button onClick={handleUpload} disabled={validRows.length === 0 || uploading}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {uploading ? "Creating accounts…" : `Create ${validRows.length || ""} Account${validRows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
