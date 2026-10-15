// ─────────────────────────────────────────────────────────────
// src/sead/renewalReportApi.ts
// The renewal dashboard and the Excel export. The numbers come from the database (renewal_dashboard, renewal_export_data, see
// supabase_migration_renewal_p7_reports.sql); every export is logged there. The workbook is built in the browser with the project's own small
// .xlsx writer (loaded only when someone presses the button).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { attachCsrNumbers, buildReportSheets, exportFileName, exportFilterArgs, isFiltered, parseDashboard, parseExportData, type DashboardData, type ExportFilter } from "@/lib/renewalReport";

export async function fetchRenewalDashboard(schoolYear: string, term: string): Promise<{ ok: true; data: DashboardData } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_dashboard", { p_school_year: schoolYear, p_term: term });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the dashboard." };
  return { ok: true, data: parseDashboard(data) };
}

/** Builds the Excel file for a term and downloads it. */
export async function downloadRenewalExcel(schoolYear: string, term: string, dash: DashboardData, filter: ExportFilter): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_export_data", { p_school_year: schoolYear, p_term: term, ...exportFilterArgs(filter) });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't prepare the export." };
  // The certificate numbers come from a separate call, so the report still works when the certificate file (Phase 8) is not installed.
  const csr = await supabase.rpc("renewal_export_csr", { p_school_year: schoolYear, p_term: term });
  const parsed = attachCsrNumbers(parseExportData(data), csr.error ? null : csr.data);
  const sheets = buildReportSheets(dash, parsed, filter);
  const { buildXlsxBytes, XLSX_MIME } = await import("@/mysurveys/results/xlsxWriter");
  const bytes = await buildXlsxBytes(sheets);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url; a.download = exportFileName(dash.termLabel, new Date(), isFiltered(filter));
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ok: true, rows: parsed.applications.length + parsed.notApplied.length };
}
