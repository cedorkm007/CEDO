// ─────────────────────────────────────────────────────────────
// src/school/templateDownload.ts
// One place that builds and downloads the bulk-upload templates for a period, used by the toolbar's "Download template" button and by the
// bulk upload window (step 2), so both give the same files:
//   * the Promotional Report / Enrollment List (Excel), pre-filled with the school's scholars or blank — the school's own template;
//   * the earlier CSV layout (Scholar ID based), still accepted on upload.
// ─────────────────────────────────────────────────────────────
import { toCsv, downloadCsv } from "@/sead/csvUtils";
import { normalizeTerm, type PeriodRef } from "@/lib/academicPeriods";
import { buildXlsx } from "@/lib/xlsxLite";
import { fetchGradesForScholars } from "./schoolApi";
import { buildTemplate } from "./bulkGradeLogic";
import { buildPromoTemplate, promoTemplateFileName } from "./promoReport";
import type { SchoolScholarRow } from "./types";

type Result = { ok: true } | { ok: false; error: string };

export async function downloadGradeTemplate(scholars: SchoolScholarRow[], period: PeriodRef): Promise<Result> {
  const existing = await fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), period);
  if (!existing.ok) return { ok: false, error: existing.error };
  const { headers, rows } = buildTemplate(scholars, existing.rows, period);
  const term = (normalizeTerm(period.semester) ?? period.semester).toLowerCase().replace(/\s+/g, "-");
  downloadCsv(`grades-template_${period.schoolYear}_${term}.csv`, toCsv(headers, rows));
  return { ok: true };
}

/** The Promotional Report / Enrollment List as an Excel file: pre-filled with the school's scholars and the subjects already declared, or blank. */
export async function downloadPromoTemplate(opts: { schoolName: string; scholars: SchoolScholarRow[]; period: PeriodRef; blank: boolean }): Promise<Result> {
  const { schoolName, scholars, period, blank } = opts;
  let existing: Awaited<ReturnType<typeof fetchGradesForScholars>> = { ok: true, rows: [] };
  if (!blank) {
    existing = await fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), period);
    if (!existing.ok) return { ok: false, error: existing.error };
  }
  const bytes = await buildXlsx(buildPromoTemplate({ schoolName, period, scholars, existing: existing.ok ? existing.rows : [], blank }));
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = promoTemplateFileName(period, blank);
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}
