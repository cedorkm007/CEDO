import { supabase } from "@/lib/supabase";
import type { ScholarshipStatus } from "./types";

export interface DailyRecord {
  id: string;
  scholarIdNumber: string;
  name: string;
  course: string;
  yearLevel: string;
  school: string;
  status: ScholarshipStatus;
  dateVisited: string; // ISO date
  consultedByName: string;
  failedSubjects: string;
  findings: string;
  staffRecommendations: string;
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
    consultedByName: String(r.consulted_by_name ?? ""),
    failedSubjects: String(r.failed_subjects ?? ""),
    findings: String(r.findings ?? ""),
    staffRecommendations: String(r.staff_recommendations ?? ""),
    createdAt: String(r.created_at ?? ""),
  };
}

/** One row per counseling visit, joined with the scholar's name/course/year/school and the consulting staff's display name — see scholar_counseling_daily_records() (supabase_migration_scholar_counseling.sql). */
export async function fetchDailyRecords(search: string = ""): Promise<DailyRecord[]> {
  const { data, error } = await supabase.rpc("scholar_counseling_daily_records", { p_search: search.trim() });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToDailyRecord);
}

export interface NewDailyRecordInput {
  scholarIdNumber: string;
  status: ScholarshipStatus;
  dateVisited: string; // YYYY-MM-DD
  failedSubjects: string;
  findings: string;
  staffRecommendations: string;
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
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
