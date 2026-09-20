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
