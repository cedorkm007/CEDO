import { useRef, useState } from "react";
import { X, Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { bulkCreateQuestions, type BulkQuestionInput } from "../seadApi";
import { parseCsv, toCsv, downloadCsv, normalizeHeader, findColumn, cell } from "../csvUtils";
import type { QuestChoiceDraft } from "../types";

const TEMPLATE_HEADERS = [
  "Question", "Points", "Choice 1", "Choice 2", "Choice 3", "Choice 4", "Choice 5", "Choice 6", "Correct Choice (1-6)",
];

const TEMPLATE_SAMPLE_ROWS = [
  ["What is the capital of the Philippines?", "1", "Manila", "Cebu", "Davao", "Quezon City", "", "", "1"],
  ["Which planet is known as the Red Planet?", "1", "Venus", "Mars", "Jupiter", "", "", "", "2"],
];

interface ParsedRow {
  rowNumber: number; // 1-based, matches spreadsheet row (header = row 1)
  ok: boolean;
  error?: string;
  question?: BulkQuestionInput;
  preview: string;
}

function downloadTemplate() {
  downloadCsv("question-bank-template.csv", toCsv(TEMPLATE_HEADERS, TEMPLATE_SAMPLE_ROWS));
}

function parseAndValidate(text: string): { rows: ParsedRow[]; headerError?: string } {
  const raw = parseCsv(text);
  if (raw.length < 1) return { rows: [], headerError: "The file is empty." };

  const headers = raw[0].map(normalizeHeader);
  const idx = {
    question: findColumn(headers, ["question", "question text"]),
    points: findColumn(headers, ["points", "point"]),
    c1: findColumn(headers, ["choice 1", "choice1"]),
    c2: findColumn(headers, ["choice 2", "choice2"]),
    c3: findColumn(headers, ["choice 3", "choice3"]),
    c4: findColumn(headers, ["choice 4", "choice4"]),
    c5: findColumn(headers, ["choice 5", "choice5"]),
    c6: findColumn(headers, ["choice 6", "choice6"]),
    correct: findColumn(headers, ["correct choice (1-6)", "correct choice", "correct", "correct answer", "answer"]),
  };

  if (idx.question === -1) return { rows: [], headerError: 'Missing a "Question" column.' };
  if (idx.c1 === -1 || idx.c2 === -1) return { rows: [], headerError: 'Missing "Choice 1" / "Choice 2" columns — at least two choices are required.' };
  if (idx.correct === -1) return { rows: [], headerError: 'Missing a "Correct Choice (1-6)" column.' };

  const dataRows = raw.slice(1);
  const parsed: ParsedRow[] = dataRows.map((r, i) => {
    const rowNumber = i + 2; // account for header row
    const questionText = cell(r, idx.question);
    const preview = questionText || `(row ${rowNumber})`;

    if (!questionText) return { rowNumber, ok: false, error: "Question text is empty.", preview };

    const pointsRaw = cell(r, idx.points);
    const points = pointsRaw === "" ? 1 : Number(pointsRaw);
    if (!Number.isFinite(points) || points < 0) return { rowNumber, ok: false, error: `Invalid points value: "${pointsRaw}".`, preview };

    const choiceTexts = [idx.c1, idx.c2, idx.c3, idx.c4, idx.c5, idx.c6]
      .map(ci => cell(r, ci))
      .filter(t => t !== "");
    if (choiceTexts.length < 2) return { rowNumber, ok: false, error: "Needs at least two non-empty choices.", preview };

    const correctRaw = cell(r, idx.correct);
    let correctIndex = -1;
    const asNumber = Number(correctRaw);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choiceTexts.length) {
      correctIndex = asNumber - 1;
    } else {
      correctIndex = choiceTexts.findIndex(t => t.toLowerCase() === correctRaw.toLowerCase());
    }
    if (correctIndex === -1) {
      return { rowNumber, ok: false, error: `"Correct Choice" value "${correctRaw}" doesn't match a choice number (1-${choiceTexts.length}) or choice text.`, preview };
    }

    const choices: QuestChoiceDraft[] = choiceTexts.map((choiceText, ci) => ({ choiceText, isCorrect: ci === correctIndex }));
    return { rowNumber, ok: true, preview, question: { questionText, points, choices } };
  });

  return { rows: parsed };
}

export function BulkQuestionUploadModal({
  topicId, topicName, onClose, onDone,
}: { topicId: string; topicName: string; onClose: () => void; onDone: () => void }) {
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
    const { created, results } = await bulkCreateQuestions(topicId, inputs);
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
          <h3 className="text-white font-bold text-[15px]">Bulk Upload Questions — {topicName}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {createdCount !== null ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-2" />
              <p className="text-sm font-semibold text-[#062444] mb-1">
                {createdCount} question{createdCount === 1 ? "" : "s"} added to {topicName}.
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
                  <button onClick={reset} className="text-[13px] font-semibold text-[#0088cc]">Upload another file</button>
                )}
                <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-slate-500 mb-3">
                Every question here will be added to the <strong>{topicName}</strong> topic. Download the template, fill it in, then upload it below.
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
