import { useRef, useState } from "react";
import { X, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { bulkCreateSurveyQuestions, type BulkSurveyQuestionInput } from "../seadApi";
import { parseCsv, toCsv, downloadCsv, normalizeHeader, findColumn, cell } from "../csvUtils";
import type { SurveyChoiceDraft, SurveyQuestionType } from "../types";
import { ExportButton } from "@/app/components/ExportButtons";

const TEMPLATE_HEADERS = [
  "Question Type", "Question", "Choice 1", "Choice 2", "Choice 3", "Choice 4", "Scale Min", "Scale Max", "Min Label", "Max Label",
];

const TEMPLATE_SAMPLE_ROWS = [
  ["Multiple Choice", "How would you rate the venue?", "Excellent", "Good", "Fair", "Poor", "", "", "", ""],
  ["Likert", "The activity met its objectives.", "", "", "", "", "1", "5", "Strongly Disagree", "Strongly Agree"],
];

interface ParsedRow {
  rowNumber: number; // 1-based, matches spreadsheet row (header = row 1)
  ok: boolean;
  error?: string;
  question?: BulkSurveyQuestionInput;
  preview: string;
}

function downloadTemplate() {
  downloadCsv("survey-questions-template.csv", toCsv(TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS));
}

function parseQuestionType(raw: string): SurveyQuestionType | null {
  const v = raw.trim().toLowerCase();
  if (v === "multiple_choice" || v === "multiple choice" || v === "mc" || v === "choice") return "multiple_choice";
  if (v === "likert" || v === "likert scale" || v === "scale") return "likert";
  return null;
}

function parseAndValidate(text: string): { rows: ParsedRow[]; headerError?: string } {
  const raw = parseCsv(text);
  if (raw.length < 1) return { rows: [], headerError: "The file is empty." };

  const headers = raw[0].map(normalizeHeader);
  const idx = {
    type: findColumn(headers, ["question type", "type"]),
    question: findColumn(headers, ["question", "question text"]),
    scaleMin: findColumn(headers, ["scale min", "min scale"]),
    scaleMax: findColumn(headers, ["scale max", "max scale"]),
    minLabel: findColumn(headers, ["min label", "label min"]),
    maxLabel: findColumn(headers, ["max label", "label max"]),
  };
  // Unlimited choices: scan for every "Choice N" column present, in order,
  // rather than a fixed list of aliases — this is what lets the template
  // support more choices than Quests' fixed 6-column format.
  const choiceIndices = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^choice \d+$/.test(h))
    .sort((a, b) => Number(a.h.replace("choice ", "")) - Number(b.h.replace("choice ", "")))
    .map(({ i }) => i);

  if (idx.type === -1) return { rows: [], headerError: 'Missing a "Question Type" column.' };
  if (idx.question === -1) return { rows: [], headerError: 'Missing a "Question" column.' };

  const dataRows = raw.slice(1);
  const parsed: ParsedRow[] = dataRows.map((r, i) => {
    const rowNumber = i + 2; // account for header row
    const questionText = cell(r, idx.question);
    const preview = questionText || `(row ${rowNumber})`;

    if (!questionText) return { rowNumber, ok: false, error: "Question text is empty.", preview };

    const questionType = parseQuestionType(cell(r, idx.type));
    if (!questionType) return { rowNumber, ok: false, error: `Invalid Question Type: "${cell(r, idx.type)}" — use "Multiple Choice" or "Likert".`, preview };

    if (questionType === "multiple_choice") {
      const choiceTexts = choiceIndices.map(ci => cell(r, ci)).filter(t => t !== "");
      if (choiceTexts.length < 2) return { rowNumber, ok: false, error: "Needs at least two non-empty choices.", preview };
      const choices: SurveyChoiceDraft[] = choiceTexts.map(choiceText => ({ choiceText }));
      return { rowNumber, ok: true, preview, question: { questionType, questionText, choices } };
    }

    const scaleMinRaw = cell(r, idx.scaleMin), scaleMaxRaw = cell(r, idx.scaleMax);
    const scaleMin = Number(scaleMinRaw), scaleMax = Number(scaleMaxRaw);
    if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax) || scaleMax <= scaleMin) {
      return { rowNumber, ok: false, error: `Invalid scale range: "${scaleMinRaw}" to "${scaleMaxRaw}" (max must be greater than min).`, preview };
    }
    const minLabel = cell(r, idx.minLabel), maxLabel = cell(r, idx.maxLabel);
    if (!minLabel || !maxLabel) return { rowNumber, ok: false, error: "Both Min Label and Max Label are required for a Likert question.", preview };

    return { rowNumber, ok: true, preview, question: { questionType, questionText, choices: [], likertScaleMin: scaleMin, likertScaleMax: scaleMax, likertMinLabel: minLabel, likertMaxLabel: maxLabel } };
  });

  return { rows: parsed };
}

export function BulkSurveyQuestionUploadModal({
  surveyId, surveyTitle, onClose, onDone,
}: { surveyId: string; surveyTitle: string; onClose: () => void; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<{ rowNumber: number; error: string }[]>([]);
  const [createdCount, setCreatedCount] = useState<number | null>(null);

  const validRows = rows.filter(r => r.ok);
  const invalidRows = rows.filter(r => !r.ok);

  function handleFile(file: File) {
    setFileName(file.name);
    setCreatedCount(null);
    setUploadErrors([]);
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
    const inputs = validRows.map(r => r.question!);
    const { created, results } = await bulkCreateSurveyQuestions(surveyId, inputs);
    setUploading(false);
    setCreatedCount(created);
    const errs = results
      .filter(r => !r.ok)
      .map(r => ({ rowNumber: validRows[r.index].rowNumber, error: r.error || "Failed to create." }));
    setUploadErrors(errs);
    if (errs.length === 0) onDone();
  }

  function reset() {
    setFileName(null);
    setRows([]);
    setHeaderError(null);
    setCreatedCount(null);
    setUploadErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">Bulk Upload Questions — {surveyTitle}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {createdCount !== null ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p className="text-sm font-semibold text-[#062444] mb-1">
                {createdCount} question{createdCount === 1 ? "" : "s"} added to {surveyTitle}.
              </p>
              {uploadErrors.length > 0 && (
                <div className="text-left mt-4 bg-red-50 border border-red-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[12.5px] font-semibold text-red-600 mb-1.5">{uploadErrors.length} row(s) failed to save:</p>
                  {uploadErrors.map((e, i) => (
                    <p key={i} className="text-[12px] text-red-600">Row {e.rowNumber}: {e.error}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-center gap-3 mt-5">
                {uploadErrors.length > 0 && (
                  <button onClick={reset} className="text-[13px] font-semibold text-[#0088cc] cursor-pointer hover:opacity-80 transition-opacity">Upload another file</button>
                )}
                <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-slate-500 mb-3">
                Every question here will be added to <strong>{surveyTitle}</strong>. Download the template, fill it in, then upload it below. Add as many "Choice N" columns as you need for Multiple Choice rows — there's no fixed limit.
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

              <div className="flex justify-end">
                <button onClick={handleUpload} disabled={validRows.length === 0 || uploading}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {uploading ? "Uploading…" : `Upload ${validRows.length || ""} Question${validRows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
