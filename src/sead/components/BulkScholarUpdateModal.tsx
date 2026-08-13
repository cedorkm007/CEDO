import { useRef, useState } from "react";
import { X, Download, Upload, AlertTriangle, CheckCircle2, UploadCloud } from "lucide-react";
import { bulkUpdateScholars, type BulkScholarUpdateInput, type BulkScholarUpdateRowResult } from "../seadApi";
import { parseCsv, toCsv, downloadCsv, normalizeHeader, findColumn, cell } from "../csvUtils";
import { ALL_BARANGAYS } from "@/lib/cdoBarangays";

const TEMPLATE_HEADERS = [
  "Scholar ID Number", "First Name", "Last Name", "Middle Name", "Birthday (YYYY-MM-DD)",
  "School", "Course", "Year Level", "Civil Status", "Contact No.",
  "House/Unit No.", "Street", "Barangay", "City/Municipality", "Province/Region", "Country", "Zip Code",
];

const TEMPLATE_SAMPLE_ROWS = [
  ["20250001", "", "", "", "", "", "", "2nd Year", "", "09171234567", "Blk 3 Lot 12", "Rizal St.", "Poblacion", "Butuan City", "Agusan del Norte", "Philippines", "8600"],
];

interface ParsedRow {
  rowNumber: number; // 1-based, matches spreadsheet row (header = row 1)
  ok: boolean;
  error?: string;
  preview: string;
  changedFieldLabels: string[];
  update?: BulkScholarUpdateInput;
}

function downloadTemplate() {
  downloadCsv("scholar-bulk-update-template.csv", toCsv(TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS));
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

const FIELD_DEFS: { key: keyof Omit<BulkScholarUpdateInput, "scholarIdNumber">; label: string; aliases: string[]; isBirthday?: boolean; isBarangay?: boolean }[] = [
  { key: "firstName", label: "First Name", aliases: ["first name", "firstname"] },
  { key: "lastName", label: "Last Name", aliases: ["last name", "lastname"] },
  { key: "middleName", label: "Middle Name", aliases: ["middle name", "middlename"] },
  { key: "birthday", label: "Birthday", aliases: ["birthday (yyyy-mm-dd)", "birthday", "birthdate", "date of birth"], isBirthday: true },
  { key: "school", label: "School", aliases: ["school"] },
  { key: "course", label: "Course", aliases: ["course"] },
  { key: "yearLevel", label: "Year Level", aliases: ["year level", "yearlevel", "year"] },
  { key: "civilStatus", label: "Civil Status", aliases: ["civil status", "civilstatus"] },
  { key: "contactNo", label: "Contact No.", aliases: ["contact no.", "contact no", "contact number", "contact"] },
  { key: "houseUnitNo", label: "House/Unit No.", aliases: ["house/unit no.", "house/unit no", "house unit no", "house no"] },
  { key: "street", label: "Street", aliases: ["street"] },
  { key: "barangay", label: "Barangay", aliases: ["barangay"], isBarangay: true },
  { key: "cityMunicipality", label: "City/Municipality", aliases: ["city/municipality", "city municipality", "city"] },
  { key: "provinceRegion", label: "Province/Region", aliases: ["province/region", "province region", "province"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "zipCode", label: "Zip Code", aliases: ["zip code", "zipcode", "postal code"] },
];

function parseAndValidate(text: string): { rows: ParsedRow[]; headerError?: string } {
  const raw = parseCsv(text);
  if (raw.length < 1) return { rows: [], headerError: "The file is empty." };

  const headers = raw[0].map(normalizeHeader);
  const idIdx = findColumn(headers, ["scholar id number", "scholar id", "scholarid", "id number", "id"]);
  if (idIdx === -1) return { rows: [], headerError: 'Missing a "Scholar ID Number" column.' };

  const fieldIdx = FIELD_DEFS.map(f => ({ ...f, idx: findColumn(headers, f.aliases) }));

  const dataRows = raw.slice(1);
  const parsed: ParsedRow[] = dataRows.map((r, i) => {
    const rowNumber = i + 2; // account for header row
    const scholarIdNumber = cell(r, idIdx);
    if (!scholarIdNumber) return { rowNumber, ok: false, error: "Missing Scholar ID Number.", preview: `(row ${rowNumber})`, changedFieldLabels: [] };

    const update: BulkScholarUpdateInput = { scholarIdNumber };
    const changedFieldLabels: string[] = [];

    for (const f of fieldIdx) {
      if (f.idx === -1) continue; // column not present in this CSV at all — fine, just skip it entirely
      const raw = cell(r, f.idx);
      if (raw === "") continue; // blank cell = no change for this field

      if (f.isBirthday) {
        const normalized = normalizeBirthday(raw);
        if (!normalized) return { rowNumber, ok: false, error: `Unrecognized birthday format: "${raw}". Use YYYY-MM-DD or MM/DD/YYYY, or leave blank.`, preview: scholarIdNumber, changedFieldLabels: [] };
        update.birthday = normalized;
      } else if (f.isBarangay) {
        const match = ALL_BARANGAYS.find(b => b.toLowerCase() === raw.toLowerCase());
        if (!match) return { rowNumber, ok: false, error: `"${raw}" isn't a recognized Barangay — check spelling against the official list, or leave blank.`, preview: scholarIdNumber, changedFieldLabels: [] };
        update.barangay = match;
      } else {
        (update[f.key] as string) = raw;
      }
      changedFieldLabels.push(f.label);
    }

    if (changedFieldLabels.length === 0) {
      return { rowNumber, ok: false, error: "No fields to update — every column besides Scholar ID Number is blank.", preview: scholarIdNumber, changedFieldLabels: [] };
    }

    return { rowNumber, ok: true, preview: scholarIdNumber, changedFieldLabels, update };
  });

  return { rows: parsed };
}

export function BulkScholarUpdateModal({
  onClose, onDone,
}: { onClose: () => void; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<BulkScholarUpdateRowResult[] | null>(null);
  const [rowLookup, setRowLookup] = useState<ParsedRow[]>([]);

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
    const inputs = validRows.map(r => r.update!);
    const { results: res } = await bulkUpdateScholars(inputs);
    setUploading(false);
    setResults(res);
    setRowLookup(validRows);
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
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UploadCloud size={16} className="text-[#F3BC00]" /> Bulk Update Scholars</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {results !== null ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p className="text-sm font-semibold text-[#062444] mb-1">
                {successCount} scholar{successCount === 1 ? "" : "s"} updated.
              </p>
              {failCount > 0 && (
                <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[12.5px] font-semibold text-red-600 mb-1.5">{failCount} row(s) failed:</p>
                  {results!.filter(r => !r.ok).map((r, i) => (
                    <p key={i} className="text-[12px] text-red-600">Row {rowLookup[r.index]?.rowNumber ?? "?"} ({r.scholarIdNumber}): {r.error}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-center gap-3 mt-5">
                {failCount > 0 && (
                  <button onClick={reset} className="text-[13px] font-semibold text-[#0088cc]">Upload another file</button>
                )}
                <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-slate-500 mb-3">
                Update existing scholars by Scholar ID Number — download the template, fill in <strong>only the fields you want to change</strong>, and leave the rest blank. Blank cells are never overwritten.
              </p>

              <button onClick={downloadTemplate}
                className="flex items-center gap-2 text-[12.5px] font-semibold text-[#0088cc] border border-[#0088cc]/30 rounded-lg px-3 py-2 mb-4 hover:bg-[#0088cc]/5">
                <Download size={14} /> Download CSV Template
              </button>

              <div className="border-2 border-dashed border-[#062444]/15 rounded-xl px-4 py-6 text-center mb-4">
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                <Upload size={20} className="mx-auto text-slate-400 mb-2" />
                <button onClick={() => fileInputRef.current?.click()} className="text-[13px] font-semibold text-[#0088cc]">
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
                    <p className="text-[12.5px] font-semibold text-green-700">{validRows.length} ready to update</p>
                    {invalidRows.length > 0 && <p className="text-[12.5px] font-semibold text-red-600">{invalidRows.length} with errors</p>}
                  </div>
                  <div className="max-h-52 overflow-y-auto border border-[#e6ecf5] rounded-lg divide-y divide-[#f0f3f8]">
                    {rows.map((r, i) => (
                      <div key={i} className="px-3 py-2 flex items-start gap-2 text-[12.5px]">
                        <span className="shrink-0 text-slate-400 w-14">Row {r.rowNumber}</span>
                        {r.ok ? (
                          <span className="text-[#062444] flex-1">
                            <strong>{r.preview}</strong> — {r.changedFieldLabels.length} field{r.changedFieldLabels.length === 1 ? "" : "s"} changing: {r.changedFieldLabels.join(", ")}
                          </span>
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
                  {uploading ? "Updating…" : `Update ${validRows.length || ""} Scholar${validRows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
