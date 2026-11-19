import { supabase } from "@/lib/supabase";
import type { ScholarshipStatus } from "./types";
import type { BulkRowInput, BulkRowResult } from "@/lib/bulkDailyRecords";

export type VisitType = "Office" | "KSB Client" | "Home Visit";
export const VISIT_TYPES: VisitType[] = ["Office", "KSB Client", "Home Visit"];

export interface DailyRecord {
  id: string;
  scholarIdNumber: string;
  name: string;
  course: string;
  yearLevel: string;
  school: string;
  status: ScholarshipStatus;
  dateVisited: string; // ISO date
  consultedById: string | null;
  consultedByName: string;
  failedSubjects: string;
  findings: string;
  staffRecommendations: string;
  visitType: VisitType;
  createdAt: string;
}

function rowToDailyRecord(r: Record<string, unknown>): DailyRecord {
  return {
    id: String(r.id),
    scholarIdNumber: String(r.scholar_id_number),
    name: String(r.name ?? ""),
    course: String(r.course ?? ""),
    yearLevel: String(r.year_level ?? ""),
    school: String(r.school ?? ""),
    status: r.status as ScholarshipStatus,
    dateVisited: String(r.date_visited ?? ""),
    consultedById: r.consulted_by_id == null ? null : String(r.consulted_by_id),
    consultedByName: String(r.consulted_by_name ?? ""),
    failedSubjects: String(r.failed_subjects ?? ""),
    findings: String(r.findings ?? ""),
    staffRecommendations: String(r.staff_recommendations ?? ""),
    visitType: (r.visit_type as VisitType) ?? "Office",
    createdAt: String(r.created_at ?? ""),
  };
}

/** One row per counseling visit, joined with the scholar's name/course/year/school and the consulting staff's display name — see scholar_counseling_daily_records() (supabase_migration_scholar_counseling.sql). */
export async function fetchDailyRecords(search: string = ""): Promise<DailyRecord[]> {
  const { data, error } = await supabase.rpc("scholar_counseling_daily_records", { p_search: search.trim() });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToDailyRecord);
}

/** What the Daily Records list is narrowed by (all sent to the database: supabase_migration_consultation_daily_records_paging.sql). */
export interface DailyRecordFilters {
  search: string;
  /** YYYY-MM-DD, "" = no limit */ from: string; to: string;
  visitTypes: string[]; statuses: string[]; consultantIds: string[];
}
export interface DailyRecordSort { key: "date" | "name"; dir: "asc" | "desc" }
export const DAILY_RECORDS_PAGE_SIZE = 50;

type PageFailed = { ok: false; error: string; missing: boolean };
const isMissingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
function pageArgs(f: DailyRecordFilters, sort: DailyRecordSort, limit: number, offset: number, logExport: boolean) {
  return {
    p_search: f.search.trim(), p_from: f.from || null, p_to: f.to || null,
    p_visit_types: f.visitTypes.length ? f.visitTypes : null, p_statuses: f.statuses.length ? f.statuses : null, p_consultants: f.consultantIds.length ? f.consultantIds : null,
    p_sort: sort.key, p_dir: sort.dir, p_limit: limit, p_offset: offset, p_log_export: logExport,
  };
}

/** ONE PAGE of the Daily Records with the TRUE total (never cut off at 1,000). `missing: true` = the database update has not been run yet. */
export async function fetchDailyRecordsPage(f: DailyRecordFilters, sort: DailyRecordSort, page: number, pageSize = DAILY_RECORDS_PAGE_SIZE): Promise<{ ok: true; rows: DailyRecord[]; total: number } | PageFailed> {
  const { data, error } = await supabase.rpc("scholar_counseling_daily_records_page", pageArgs(f, sort, pageSize, (Math.max(1, page) - 1) * pageSize, false));
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const rows = (data ?? []) as Record<string, unknown>[];
  return { ok: true, rows: rows.map(rowToDailyRecord), total: rows.length ? Number(rows[0].total_count ?? 0) : 0 };
}

/** EVERY record that matches the filters, read page after page (500 at a time) for the Export; the export is written to the export log when it starts. */
export async function fetchAllDailyRecordsForExport(f: DailyRecordFilters, sort: DailyRecordSort, onProgress?: (done: number, total: number) => void): Promise<{ ok: true; rows: DailyRecord[] } | PageFailed> {
  const PAGE = 500;
  const all: DailyRecord[] = [];
  let total = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("scholar_counseling_daily_records_page", pageArgs(f, sort, PAGE, offset, offset === 0));
    if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) break;
    total = Number(rows[0].total_count ?? total);
    all.push(...rows.map(rowToDailyRecord));
    onProgress?.(all.length, total);
    if (rows.length < PAGE || all.length >= total) break;
  }
  return { ok: true, rows: all };
}

/** The staff who have logged visits, for the Consultant filter. */
export async function fetchDailyRecordConsultants(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.rpc("scholar_counseling_consultants");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ id: String(r.id), name: String(r.name ?? "") }));
}

export interface NewDailyRecordInput {
  scholarIdNumber: string;
  status: ScholarshipStatus;
  dateVisited: string; // YYYY-MM-DD
  failedSubjects: string;
  findings: string;
  staffRecommendations: string;
  visitType: VisitType;
}

/** consultedBy is deliberately not a parameter here — create_scholar_counseling_record() always sets it from auth.uid() server-side. */
export async function createDailyRecord(input: NewDailyRecordInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("create_scholar_counseling_record", {
    p_scholar_id_number: input.scholarIdNumber,
    p_status: input.status,
    p_date_visited: input.dateVisited,
    p_failed_subjects: input.failedSubjects,
    p_findings: input.findings,
    p_staff_recommendations: input.staffRecommendations,
    p_visit_type: input.visitType,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Bulk Add of past Daily Records (supabase_migration_consultation_bulk_records.sql). The rows are sent 200 at a time. With `dryRun` nothing is saved: the answer says, row by row, what the database would do
 * (add it, skip it as already recorded, or refuse it and why). `missing: true` = the database update has not been run yet. The key of the result is the row number of the spreadsheet.
 */
export async function checkOrAddBulkRecords(
  items: { rowNumber: number; input: BulkRowInput }[], dryRun: boolean, onProgress?: (done: number, total: number) => void,
): Promise<{ ok: true; results: Map<number, BulkRowResult> } | { ok: false; error: string; missing: boolean }> {
  const results = new Map<number, BulkRowResult>();
  const CHUNK = 200;
  for (let from = 0; from < items.length; from += CHUNK) {
    const part = items.slice(from, from + CHUNK);
    const { data, error } = await supabase.rpc("counseling_bulk_records", { p_rows: part.map(p => p.input), p_dry_run: dryRun });
    if (error) {
      const missing = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message ?? "");
      return { ok: false, error: missing ? "Bulk adding needs the latest database update. Please ask the IT admin to run it." : error.message, missing };
    }
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const target = part[Number(r.i) - 1];
      if (!target) continue;
      results.set(target.rowNumber, {
        i: Number(r.i), ok: !!r.ok, duplicate: !!r.duplicate, error: r.error == null ? null : String(r.error), scholarId: r.scholar_id == null ? null : String(r.scholar_id),
        name: r.name == null ? null : String(r.name), status: r.status == null ? null : String(r.status), visitType: r.visit_type == null ? null : String(r.visit_type), date: r.date == null ? null : String(r.date).slice(0, 10),
      });
    }
    onProgress?.(Math.min(from + CHUNK, items.length), items.length);
  }
  return { ok: true, results };
}

/** Every Daily Record ever logged for one scholar — the "Counseling History" summary — reuses the same RPC as the Daily Records list, since scholar_id_number is an exact match against p_search. */
export async function fetchCounselingHistoryForScholar(scholarIdNumber: string): Promise<DailyRecord[]> {
  return fetchDailyRecords(scholarIdNumber);
}

// ── Probationary Monitoring ──────────────────────────────────

export interface ProbationRow {
  scholarIdNumber: string;
  name: string;
  course: string;
  yearLevel: string;
  school: string;
  studyPlan: string;
  academicContractUpdate: string;
}

function rowToProbationRow(r: Record<string, unknown>): ProbationRow {
  return {
    scholarIdNumber: String(r.scholar_id_number),
    name: String(r.name ?? ""),
    course: String(r.course ?? ""),
    yearLevel: String(r.year_level ?? ""),
    school: String(r.school ?? ""),
    studyPlan: String(r.study_plan ?? ""),
    academicContractUpdate: String(r.academic_contract_update ?? ""),
  };
}

/** Every currently-Probationary scholar, with their current Study Plan / Academic Contract Update note if one exists — see scholar_probation_monitoring_list() (supabase_migration_scholar_probation_monitoring.sql). */
export async function fetchProbationMonitoringList(search: string = ""): Promise<ProbationRow[]> {
  const { data, error } = await supabase.rpc("scholar_probation_monitoring_list", { p_search: search.trim() });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToProbationRow);
}

/** Upserts one scholar's Study Plan / Academic Contract Update — current value only, no history (see the migration's header comment). */
export async function saveProbationNotes(
  scholarIdNumber: string, studyPlan: string, academicContractUpdate: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("upsert_scholar_probation_notes", {
    p_scholar_id_number: scholarIdNumber,
    p_study_plan: studyPlan,
    p_academic_contract_update: academicContractUpdate,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
