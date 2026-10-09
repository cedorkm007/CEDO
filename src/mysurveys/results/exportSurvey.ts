import { supabase } from "@/lib/supabase";
import { QUESTION_TYPE_LABELS, type QuestionType } from "../surveyTypes";
import { buildExportTable, exportFileBase, toCsvText, type ExportData, type ExportQuestion, type ExportResponse } from "./exportTable";
import { buildXlsxBytes, XLSX_MIME } from "./xlsxWriter";

const PAGE_SIZE = 500;
const MAX_PAGES = 2000; // 1,000,000 responses: a safety stop, not a real limit

export type ExportFormat = "csv" | "xlsx";

/**
 * Reads every response a page at a time (get_my_survey_export_page), so even a
 * survey with thousands of responses never travels in one request.
 */
export async function fetchExportData(
  surveyId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: true; data: ExportData } | { ok: false; error: string }> {
  let title = "Survey";
  let consentEnabled = false;
  let questions: ExportQuestion[] = [];
  const responses: ExportResponse[] = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase.rpc("get_my_survey_export_page", {
      p_survey_id: surveyId, p_offset: responses.length, p_limit: PAGE_SIZE,
    });
    if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the responses." };
    const d = data as { survey: { title: string; consentEnabled: boolean }; total: number; questions: ExportQuestion[]; responses: ExportResponse[] };
    if (page === 0) { title = d.survey.title; consentEnabled = d.survey.consentEnabled; questions = d.questions; }
    total = d.total;
    responses.push(...d.responses);
    onProgress?.(Math.min(responses.length, total), total);
    if (responses.length >= total || d.responses.length === 0) break;
  }
  return { ok: true, data: { title, consentEnabled, questions, responses } };
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Fetch, build and download the responses as CSV or Excel. */
export async function exportSurvey(
  surveyId: string,
  format: ExportFormat,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: true; fileName: string; responses: number } | { ok: false; error: string }> {
  const res = await fetchExportData(surveyId, onProgress);
  if (!res.ok) return res;
  const table = buildExportTable(res.data);
  const base = exportFileBase(res.data.title);

  if (format === "csv") {
    // A leading byte-order mark makes Excel open the UTF-8 file with accents and Filipino letters intact.
    const bom = String.fromCharCode(0xfeff);
    const fileName = `${base}.csv`;
    downloadBlob(fileName, new Blob([bom + toCsvText(table)], { type: "text/csv;charset=utf-8" }));
    return { ok: true, fileName, responses: res.data.responses.length };
  }

  const bytes = await buildXlsxBytes([
    { name: "Responses", headers: table.headers, rows: table.rows },
    {
      name: "Questions",
      headers: ["Column", "Question", "Type", "Version", "Status", "Answered"],
      rows: table.columns.map(c => [
        c.header, c.question.trim() || "Untitled question", QUESTION_TYPE_LABELS[c.type as QuestionType] ?? c.type,
        c.version, c.status === "current" ? "Current" : c.status === "replaced" ? "Replaced by a newer version" : "Removed from the survey", c.answered,
      ]),
    },
  ]);
  const fileName = `${base}.xlsx`;
  // Copy into a fresh ArrayBuffer so the Blob doesn't depend on the zip library's buffer.
  downloadBlob(fileName, new Blob([bytes.slice().buffer], { type: XLSX_MIME }));
  return { ok: true, fileName, responses: res.data.responses.length };
}
