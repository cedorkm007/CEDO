// ─────────────────────────────────────────────────────────────
// src/school/templateDownload.ts
// One place that builds and downloads the bulk-upload CSV template for a period, used by the toolbar's
// "Download template" button and by the bulk upload window (step 2), so both give the same file.
// ─────────────────────────────────────────────────────────────
import { toCsv, downloadCsv } from "@/sead/csvUtils";
import { normalizeTerm, type PeriodRef } from "@/lib/academicPeriods";
import { fetchGradesForScholars } from "./schoolApi";
import { buildTemplate } from "./bulkGradeLogic";
import type { SchoolScholarRow } from "./types";

export async function downloadGradeTemplate(scholars: SchoolScholarRow[], period: PeriodRef): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), period);
  if (!existing.ok) return { ok: false, error: existing.error };
  const { headers, rows } = buildTemplate(scholars, existing.rows, period);
  const term = (normalizeTerm(period.semester) ?? period.semester).toLowerCase().replace(/\s+/g, "-");
  downloadCsv(`grades-template_${period.schoolYear}_${term}.csv`, toCsv(headers, rows));
  return { ok: true };
}
