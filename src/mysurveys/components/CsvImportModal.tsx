import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FileSpreadsheet, Info, Loader2, X } from "lucide-react";
import { downloadCsv } from "@/sead/csvUtils";
import { buildTemplateCsv, parseSurveyCsv, TEMPLATE_FILE_NAME, type CsvParseResult } from "../csv/surveyCsv";
import { createSurveyFromCsvDoc } from "../csvImportApi";
import { QUESTION_TYPE_LABELS, type SurveyItem } from "../surveyTypes";
import { TYPE_ICONS } from "../builder/typeIcons";
import { fieldClass } from "../builder/cardParts";

const MAX_ERRORS_LISTED = 100;

/**
 * "Create from Template (CSV)": download the template, upload a filled-in file,
 * see every problem by row number (nothing is created if there is any), or
 * review a preview and create the survey as an editable Draft.
 * Parsing and validation live in ../csv/surveyCsv.ts; creating is one server
 * call (create_my_survey_from_doc) that either makes the whole survey or nothing.
 */
export function CsvImportModal({ onClose, onCreated }: { onClose: () => void; onCreated: (surveyId: string) => void }) {
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === "Escape" && !creating) onClose(); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose, creating]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setCreateError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseSurveyCsv(bytes, file.name);
      setFileName(file.name);
      setResult(parsed);
      setTitle(parsed.ok ? parsed.doc.title : "");
    } catch {
      setResult({ ok: false, errors: [{ row: 0, message: "The file could not be read." }], totalErrors: 1, warnings: [], notices: [] });
      setFileName(file.name);
    }
    setReading(false);
    if (fileInput.current) fileInput.current.value = ""; // allow choosing the same file again after fixing it
  }

  async function handleCreate() {
    if (!result || !result.ok) return;
    setCreating(true);
    setCreateError("");
    const res = await createSurveyFromCsvDoc({ ...result.doc, title: title.trim() || "Untitled survey" });
    if (res.ok) { onCreated(res.id); return; }
    setCreating(false);
    setCreateError(res.error);
  }

  function reset() { setResult(null); setFileName(""); setCreateError(""); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
      <div className="absolute inset-0 bg-black/40" onClick={() => { if (!creating) onClose(); }} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#f0f3f8] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 id="csv-import-title" className="text-[15px] font-bold text-[#062444]">Create from Template (CSV)</h3>
            <p className="text-[12.5px] text-slate-500">Build a survey in a spreadsheet, then upload it here.</p>
          </div>
          <button onClick={onClose} disabled={creating} aria-label="Close" className="rounded-md p-1.5 text-slate-400 hover:bg-[#f0f3f8] disabled:opacity-40"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {/* ── 1. choose a file ── */}
          {!result && (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-[#062444]">
                <li>
                  Download the template and open it in Excel or Google Sheets.{" "}
                  <button onClick={() => downloadCsv(TEMPLATE_FILE_NAME, buildTemplateCsv())} className="inline-flex items-center gap-1 font-semibold text-[#0088cc] hover:underline">
                    <Download size={13} /> Download Template
                  </button>
                </li>
                <li>Replace the example rows with your questions — one question per row. The instructions are at the bottom of the file.</li>
                <li>Save it as CSV (UTF-8) and upload it below.</li>
              </ol>

              <div className="rounded-xl bg-[#f7f9fc] p-3 text-[12.5px] text-slate-600">
                <p className="font-semibold text-[#062444] mb-1">Columns</p>
                <p><span className="font-mono text-[12px]">section, question_text, question_type, required, options, help_text, scale_min, scale_max, scale_min_label, scale_max_label</span></p>
                <p className="mt-1.5"><span className="font-semibold">question_type:</span> short_answer, paragraph, multiple_choice, checkboxes, dropdown, linear_scale, rating, date, time. <span className="font-semibold">options:</span> separate choices with | (for example Math|Science|English).</p>
              </div>

              <label
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files?.[0]); }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-2 focus-within:ring-[#0088cc]/40 ${dragging ? "border-[#0088cc] bg-[#f0f8ff]" : "border-[#d5dfec] hover:border-[#0088cc]/50"}`}
              >
                {reading ? <Loader2 size={26} className="animate-spin text-slate-400" /> : <FileSpreadsheet size={26} className="text-slate-400" />}
                <span className="text-[13.5px] font-semibold text-[#062444]">{reading ? "Checking your file…" : "Choose your CSV file"}</span>
                <span className="text-[12px] text-slate-500">or drag it here · every row is checked before anything is created</span>
                <input
                  ref={fileInput} type="file" accept=".csv,text/csv,text/plain" className="sr-only"
                  onChange={e => void handleFile(e.target.files?.[0])}
                />
              </label>
            </div>
          )}

          {/* ── 2a. problems ── */}
          {result && !result.ok && (
            <div className="space-y-4">
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="flex items-center gap-2 text-[13.5px] font-bold text-red-700">
                  <AlertTriangle size={16} /> {result.totalErrors} problem{result.totalErrors === 1 ? "" : "s"} found in {fileName} — nothing was created
                </p>
                <p className="mt-1 text-[12.5px] text-red-700/90">Fix them in your spreadsheet, save it again, and choose the file again. Row numbers match the rows you see in Excel or Google Sheets (row 1 is the column names).</p>
              </div>
              <ul className="max-h-[38vh] space-y-1.5 overflow-y-auto rounded-xl border border-[#e6ecf5] p-2">
                {result.errors.slice(0, MAX_ERRORS_LISTED).map((e, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-[#f7f9fc]">
                    <span className="mt-px h-fit shrink-0 rounded-md bg-red-100 px-2 py-0.5 text-[11.5px] font-bold text-red-700">{e.row > 0 ? `Row ${e.row}` : "File"}</span>
                    <span className="min-w-0 break-words text-[#062444]">{e.message}</span>
                  </li>
                ))}
                {result.totalErrors > MAX_ERRORS_LISTED && (
                  <li className="px-2 py-1.5 text-[12.5px] text-slate-500">…and {result.totalErrors - MAX_ERRORS_LISTED} more. Fix these first and upload again to see the rest.</li>
                )}
              </ul>
              {result.notices.map(n => <Notice key={n}>{n}</Notice>)}
            </div>
          )}

          {/* ── 2b. preview ── */}
          {result && result.ok && (
            <div className="space-y-4">
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-800">
                <span className="font-bold">{fileName}</span> passed every check: {result.questionCount} question{result.questionCount === 1 ? "" : "s"}
                {result.sectionCount > 0 ? ` in ${result.sectionCount} section${result.sectionCount === 1 ? "" : "s"}` : ""}. Review it, then create the survey — it will be a Draft you can still edit.
              </div>

              <div>
                <label htmlFor="csv-title" className="mb-1 block text-[12px] font-semibold text-slate-600">Survey title</label>
                <input id="csv-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="Untitled survey" className={fieldClass} />
              </div>

              {result.notices.map(n => <Notice key={n}>{n}</Notice>)}
              {result.warnings.length > 0 && (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
                  <p className="font-semibold">{result.warnings.length} thing{result.warnings.length === 1 ? "" : "s"} to double-check (these don't stop you):</p>
                  <ul className="mt-1 max-h-28 list-disc space-y-0.5 overflow-y-auto pl-5">
                    {result.warnings.map((w, i) => <li key={i}>{w.row > 0 ? <span className="font-semibold">Row {w.row}: </span> : null}{w.message}</li>)}
                  </ul>
                </div>
              )}

              <PreviewList items={result.doc.items} />
              {createError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-700">{createError}</p>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#f0f3f8] px-5 py-3 sm:px-6">
          {result && (
            <button onClick={reset} disabled={creating} className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-slate-500 hover:bg-[#f7f9fc] disabled:opacity-40">
              Choose a different file
            </button>
          )}
          {result && !result.ok && (
            <button onClick={() => downloadCsv(TEMPLATE_FILE_NAME, buildTemplateCsv())} className="flex items-center gap-1.5 rounded-lg border border-[#e6ecf5] px-3.5 py-2 text-[12.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">
              <Download size={14} /> Download Template
            </button>
          )}
          {result && result.ok && (
            <button
              onClick={() => void handleCreate()} disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0a3a6b] disabled:opacity-60"
            >
              {creating && <Loader2 size={14} className="animate-spin" />} {creating ? "Creating…" : "Create survey as Draft"}
            </button>
          )}
          {!result && <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-slate-500 hover:bg-[#f7f9fc]">Cancel</button>}
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2.5 text-[12.5px] text-sky-900"><Info size={14} className="mt-0.5 shrink-0" /> <span>{children}</span></p>;
}

function PreviewList({ items }: { items: SurveyItem[] }) {
  let n = 0;
  return (
    <div className="max-h-[34vh] space-y-1.5 overflow-y-auto rounded-xl border border-[#e6ecf5] p-2" aria-label="Survey preview">
      {items.map(item => {
        if (item.kind === "section") {
          return <p key={item.id} className="rounded-lg bg-[#062444] px-3 py-1.5 text-[12px] font-bold uppercase tracking-wide text-white">Section: {item.title}</p>;
        }
        n += 1;
        const Icon = TYPE_ICONS[item.type];
        const detail =
          item.options.length > 0 ? item.options.slice(0, 6).map(o => o.label).join(" · ") + (item.options.length > 6 ? ` · +${item.options.length - 6} more` : "")
          : item.type === "linear_scale" ? `${item.scaleMin} to ${item.scaleMax}${item.scaleMinLabel || item.scaleMaxLabel ? ` (${item.scaleMinLabel || "…"} → ${item.scaleMaxLabel || "…"})` : ""}`
          : item.type === "rating" ? `${item.scaleMax} stars`
          : "";
        return (
          <div key={item.id} className="rounded-lg px-3 py-2 hover:bg-[#f7f9fc]">
            <p className="break-words text-[13px] font-semibold text-[#062444]">
              <span className="mr-1.5 text-slate-400">{n}.</span>{item.text}{item.required && <span className="ml-1 text-red-500" aria-label="required">*</span>}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-slate-500">
              <span className="inline-flex items-center gap-1"><Icon size={11} /> {QUESTION_TYPE_LABELS[item.type]}</span>
              {detail && <span className="break-words">{detail}</span>}
            </p>
            {item.helpText && <p className="mt-0.5 text-[11.5px] italic text-slate-400">{item.helpText}</p>}
          </div>
        );
      })}
    </div>
  );
}
