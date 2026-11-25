import { supabase } from "@/lib/supabase";
import type { ScholarshipStatus } from "./types";
import type { BulkRowInput, BulkRowResult } from "@/lib/bulkDailyRecords";
import type { DraftValues, StoredDraft } from "@/lib/recordPopup";

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
  /** how many times the findings / recommendations were edited after the visit (0 = never) — supabase_migration_daily_records_edit.sql */
  editCount: number;
  lastEditedAt: string | null;
  editedByName: string;
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
    editCount: Number(r.edit_count ?? 0),
    lastEditedAt: r.last_edited_at == null ? null : String(r.last_edited_at),
    editedByName: String(r.edited_by_name ?? ""),
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

// ── Editing the findings and the staff recommendations after the visit (supabase_migration_daily_records_edit.sql) ──

export type UpdateRecordResult =
  | { ok: true; changed: boolean; editCount: number; lastEditedAt: string | null; editedByName: string }
  | { ok: false; conflict: true; editCount: number }
  | { ok: false; conflict?: false; error: string; missing: boolean };

/** Saves the new findings and recommendations of ONE record (only its writer; the database refuses anybody else). `expectedEditCount` is the version that was open: if the record was changed since, nothing is saved (`conflict`). */
export async function updateDailyRecord(id: string, findings: string, staffRecommendations: string, reason: string, expectedEditCount: number): Promise<UpdateRecordResult> {
  const { data, error } = await supabase.rpc("counseling_update_daily_record", {
    p_id: id, p_findings: findings.trim(), p_staff_recommendations: staffRecommendations.trim(), p_reason: reason.trim(), p_expected_edit_count: expectedEditCount,
  });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.conflict) return { ok: false, conflict: true, editCount: Number(r.edit_count ?? 0) };
  return {
    ok: true, changed: !!r.changed, editCount: Number(r.edit_count ?? 0),
    lastEditedAt: r.last_edited_at == null ? null : String(r.last_edited_at), editedByName: r.edited_by_name == null ? "" : String(r.edited_by_name),
  };
}

export interface RecordEdit {
  editNo: number; editedAt: string; editedByName: string; reason: string;
  oldFindings: string; newFindings: string; oldStaffRecommendations: string; newStaffRecommendations: string;
}

/** Every edit of one record, newest first. */
export async function fetchRecordHistory(id: string): Promise<{ ok: true; edits: RecordEdit[] } | { ok: false; error: string; missing: boolean }> {
  const { data, error } = await supabase.rpc("counseling_record_history", { p_id: id });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  return {
    ok: true,
    edits: ((data ?? []) as Record<string, unknown>[]).map(r => ({
      editNo: Number(r.edit_no), editedAt: String(r.edited_at ?? ""), editedByName: String(r.edited_by_name ?? ""), reason: String(r.reason ?? ""),
      oldFindings: String(r.old_findings ?? ""), newFindings: String(r.new_findings ?? ""),
      oldStaffRecommendations: String(r.old_staff_recommendations ?? ""), newStaffRecommendations: String(r.new_staff_recommendations ?? ""),
    })),
  };
}

/** ONE record, as the list shows it (the latest saved text). */
export async function fetchDailyRecordById(id: string): Promise<DailyRecord | null> {
  const { data, error } = await supabase.rpc("counseling_daily_record_get", { p_id: id });
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  return error || !row ? null : rowToDailyRecord(row);
}

/** The signed-in staff member's id (to show the Edit button only on their own records). */
export async function fetchMyUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ── The larger record pop-up: saved drafts, quick phrases, the scholar summary (supabase_migration_daily_records_popup.sql) ──

/** What the database kept as a draft of this staff member (null: none, or the database update has not been run yet). */
export async function fetchServerDraft(key: string): Promise<StoredDraft | null> {
  const { data, error } = await supabase.rpc("counseling_draft_get", { p_key: key });
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (error || !row) return null;
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
  const values: DraftValues = {};
  for (const [k, v] of Object.entries(payload)) if (typeof v === "string" || typeof v === "boolean") values[k] = v;
  return { values, savedAt: String(row.saved_at ?? ""), base: row.base_edit_count == null ? null : Number(row.base_edit_count) };
}

export async function saveServerDraft(key: string, values: DraftValues, base: number | null): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("counseling_draft_save", { p_key: key, p_payload: values, p_base: base });
  return error ? { ok: false, error: error.message } : { ok: true, savedAt: String(data ?? new Date().toISOString()) };
}

export async function discardServerDraft(key: string): Promise<void> {
  await supabase.rpc("counseling_draft_discard", { p_key: key });
}

export interface QuickPhrase { id: string; phrase: string }
/** The shared quick phrases (null: not available — the database update has not been run yet). */
export async function fetchQuickPhrases(): Promise<QuickPhrase[] | null> {
  const { data, error } = await supabase.rpc("counseling_phrases_list");
  if (error || !data) return null;
  return (data as Record<string, unknown>[]).map(r => ({ id: String(r.id), phrase: String(r.phrase ?? "") }));
}
export async function saveQuickPhrase(id: string | null, phrase: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("counseling_phrase_save", { p_id: id, p_phrase: phrase });
  return error ? { ok: false, error: error.message } : { ok: true };
}
export async function deleteQuickPhrase(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("counseling_phrase_delete", { p_id: id });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface ContextVisit { id: string; dateVisited: string; visitType: string; consultant: string; findings: string; staffRecommendations: string; editCount: number }
export interface RecordContext {
  scholar: { name: string; scholarIdNumber: string; school: string; program: string; yearLevel: string; status: string };
  renewal: { stage: string; term: string; schoolYear: string } | null;
  failedSubjects: { subject: string; grade: string }[];
  incSubjects: { subject: string; grade: string }[];
  openInc: { subject: string; deadline: string | null }[];
  visits: ContextVisit[];
  visitsTotal: number;
}

const subjectList = (v: unknown): { subject: string; grade: string }[] =>
  (Array.isArray(v) ? v : []).map(x => { const o = (x ?? {}) as Record<string, unknown>; return { subject: String(o.subject ?? o.subject_code ?? o.code ?? ""), grade: o.grade == null ? "" : String(o.grade) }; }).filter(x => x.subject !== "");

/** The scholar's summary for the left side of the pop-up: details, renewal stage, failed / INC subjects and the previous visits (20 at a time; `excludeId` leaves out the record that is open). */
export async function fetchRecordContext(scholarIdNumber: string, excludeId: string | null, offset = 0): Promise<{ ok: true; ctx: RecordContext } | { ok: false; error: string; missing: boolean }> {
  const { data, error } = await supabase.rpc("counseling_record_context", { p_scholar_id: scholarIdNumber, p_exclude: excludeId, p_limit: 20, p_offset: offset });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const d = (data ?? {}) as Record<string, unknown>, s = (d.scholar ?? {}) as Record<string, unknown>, rn = d.renewal as Record<string, unknown> | null;
  return {
    ok: true,
    ctx: {
      scholar: { name: String(s.name ?? ""), scholarIdNumber: String(s.scholar_id_number ?? scholarIdNumber), school: String(s.school ?? ""), program: String(s.program ?? ""), yearLevel: String(s.year_level ?? ""), status: String(s.status ?? "") },
      renewal: rn ? { stage: String(rn.stage ?? ""), term: String(rn.term ?? ""), schoolYear: String(rn.school_year ?? "") } : null,
      failedSubjects: subjectList(d.failed_subjects), incSubjects: subjectList(d.inc_subjects),
      openInc: ((d.open_inc ?? []) as Record<string, unknown>[]).map(i => ({ subject: String(i.subject ?? ""), deadline: i.deadline == null ? null : String(i.deadline).slice(0, 10) })),
      visits: ((d.visits ?? []) as Record<string, unknown>[]).map(v => ({
        id: String(v.id), dateVisited: String(v.date_visited ?? "").slice(0, 10), visitType: String(v.visit_type ?? ""), consultant: String(v.consultant ?? ""),
        findings: String(v.findings ?? ""), staffRecommendations: String(v.staff_recommendations ?? ""), editCount: Number(v.edit_count ?? 0),
      })),
      visitsTotal: Number(d.visits_total ?? 0),
    },
  };
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

export interface ProbationPageRow extends ProbationRow {
  temporary: boolean; nextDeadline: string | null; openIncCount: number; passedIncCount: number; hasStudyPlan: boolean;
}
export interface ProbationPageFilters { search: string; attention: string[]; kind: string }

/** ONE PAGE of the probationary scholars with the TRUE total (a summary of the current and previous term only; the documents come when a row is opened). `missing: true` = the database update has not been run yet. */
export async function fetchProbationMonitoringPage(f: ProbationPageFilters, sort: { key: "name" | "deadline"; dir: "asc" | "desc" }, page: number, pageSize = 50): Promise<{ ok: true; rows: ProbationPageRow[]; total: number } | PageFailed> {
  const { data, error } = await supabase.rpc("scholar_probation_monitoring_page", {
    p_search: f.search.trim(), p_attention: f.attention.length ? f.attention : null, p_kind: f.kind || null,
    p_sort: sort.key, p_dir: sort.dir, p_limit: pageSize, p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true, total: rows.length ? Number(rows[0].total_count ?? 0) : 0,
    rows: rows.map(r => ({
      ...rowToProbationRow(r), temporary: !!r.temporary, nextDeadline: r.next_deadline == null ? null : String(r.next_deadline).slice(0, 10),
      openIncCount: Number(r.open_inc_count ?? 0), passedIncCount: Number(r.passed_inc_count ?? 0), hasStudyPlan: !!r.has_study_plan,
    })),
  };
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
