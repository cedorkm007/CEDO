// ─────────────────────────────────────────────────────────────
// src/sead/gradesExport.ts
// "Export to Excel" for Scholars' Grades Monitoring: completion, submission status and GWA by school, program and period.
// Loads the data (scholars, grades, schools' setups, submissions) and hands it to src/lib/gradesReport.ts, which holds the
// numbers' rules, then writes the .xlsx with the same writer My Surveys uses.
// ─────────────────────────────────────────────────────────────
import { buildXlsxBytes, XLSX_MIME } from "@/mysurveys/results/xlsxWriter";
import { downloadBlob } from "@/mysurveys/results/exportSurvey";
import { fetchGradesForScholars } from "@/school/schoolApi";
import { periodKey, periodRefOf, type AcademicPeriod } from "@/lib/academicPeriods";
import {
  aggregateRows, buildReportSheets, buildScholarRows,
  type ReportPeriod, type ReportScholar, type ReportSubmission,
} from "@/lib/gradesReport";
import type { GradeLike } from "@/lib/gwa";
import { fetchSubmissionOverview } from "./gradesReviewApi";
import { fetchAllMatching, type SchoolSetup, type ScholarFilters } from "./scholarsMonitoringData";

/** Most scholars one export reads (the whole programme is about 7,000). */
const EXPORT_CAP = 20000;

export interface ExportRequest {
  filters: ScholarFilters;
  /** The periods to include (one, or all of them). */
  periods: AcademicPeriod[];
  setups: Map<string, SchoolSetup>;
  onProgress?: (message: string) => void;
}

function exportFileName(periods: AcademicPeriod[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const label = periods.length === 1 ? `${periods[0].schoolYear}-${periods[0].term}`.replace(/[^A-Za-z0-9-]+/g, "-") : "all-periods";
  return `scholar-grades-${label}-${stamp}.xlsx`;
}

/** Builds the workbook and downloads it. Resolves with the file name and how many scholars / periods it covers. */
export async function exportGradesToExcel(req: ExportRequest): Promise<{ ok: true; fileName: string; scholars: number; periods: number; capped: boolean } | { ok: false; error: string }> {
  const { filters, periods, setups, onProgress } = req;
  if (periods.length === 0) return { ok: false, error: "There is no period to export yet." };

  onProgress?.("Reading the scholars…");
  const found = await fetchAllMatching(filters, EXPORT_CAP);
  if (!found.ok) return found;

  const scholars: ReportScholar[] = found.rows.map(s => ({
    scholarIdNumber: s.scholarIdNumber,
    name: [`${s.lastName},`, s.firstName, s.middleName.trim() ? `${s.middleName.trim()[0]}.` : ""].filter(Boolean).join(" "),
    schoolId: s.schoolId ?? "",
    schoolName: s.schoolName.trim() || "(No school set)",
    program: s.program || "(No program set)",
    yearLevel: s.yearLevel,
  }));
  const ids = scholars.map(s => s.scholarIdNumber);

  const reportPeriods: ReportPeriod[] = periods.map(p => ({ key: periodKey(p.schoolYear, p.term), label: `${p.schoolYear} · ${p.term}` }));
  const gradesByPeriod = new Map<string, Map<string, GradeLike[]>>();
  const submissions = new Map<string, ReportSubmission>();

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const key = reportPeriods[i].key;
    onProgress?.(`Reading grades for ${reportPeriods[i].label} (${i + 1} of ${periods.length})…`);
    const grades = await fetchGradesForScholars(ids, periodRefOf(p));
    if (!grades.ok) return grades;
    const grouped = new Map<string, GradeLike[]>();
    for (const g of grades.rows) {
      const list = grouped.get(g.scholarIdNumber) ?? [];
      list.push({ grade: g.grade, units: g.units, excludeFromGwa: g.excludeFromGwa });
      grouped.set(g.scholarIdNumber, list);
    }
    gradesByPeriod.set(key, grouped);

    const overview = await fetchSubmissionOverview(periodRefOf(p));
    if (!overview.ok) return overview;
    for (const o of overview.rows) {
      submissions.set(`${o.schoolId}|${key}`, {
        status: o.status === "submitted" || o.status === "reopened" ? o.status : null, submittedAt: o.submittedAt, pendingRequests: o.pendingRequests,
      });
    }
  }

  onProgress?.("Building the spreadsheet…");
  const rows = buildScholarRows(
    scholars, reportPeriods,
    (pKey, scholarId) => gradesByPeriod.get(pKey)?.get(scholarId) ?? [],
    schoolId => ({ config: setups.get(schoolId)?.config ?? null, letters: setups.get(schoolId)?.letters ?? [] }),
  );
  const submissionFor = (schoolId: string, pKey: string) => submissions.get(`${schoolId}|${pKey}`);
  const sheets = buildReportSheets(
    rows, aggregateRows(rows, "school", submissionFor), aggregateRows(rows, "program", submissionFor), periods.length > 1,
  );

  const bytes = await buildXlsxBytes(sheets);
  const fileName = exportFileName(periods);
  downloadBlob(fileName, new Blob([bytes.slice().buffer], { type: XLSX_MIME }));
  return { ok: true, fileName, scholars: scholars.length, periods: periods.length, capped: found.capped };
}
