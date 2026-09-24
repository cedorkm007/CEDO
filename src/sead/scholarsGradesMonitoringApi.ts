// ─────────────────────────────────────────────────────────────
// src/sead/scholarsGradesMonitoringApi.ts
// Thin RPC wrappers for the "Scholars' Grades Monitoring" staff tool —
// gated by the "scholars_grades_monitoring" tag (src/app/staffToolTags.ts).
// See supabase_migration_scholars_grades_monitoring.sql for the RPCs.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

export interface GradingPeriod {
  schoolYear: string;
  semester: string;
}

export async function fetchCurrentGradingPeriod(): Promise<GradingPeriod> {
  const { data, error } = await supabase.rpc("get_current_grading_period").maybeSingle();
  if (error || !data) return { schoolYear: "", semester: "" };
  const row = data as Record<string, unknown>;
  return { schoolYear: String(row.current_school_year ?? ""), semester: String(row.current_semester ?? "") };
}

export async function setCurrentGradingPeriod(period: GradingPeriod): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_current_grading_period", { p_school_year: period.schoolYear, p_semester: period.semester });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface SchoolCompletionRow {
  schoolId: string;
  schoolName: string;
  totalScholars: number;
  completeScholars: number;
  percentComplete: number;
}

export async function fetchSchoolsCompletion(period: GradingPeriod): Promise<SchoolCompletionRow[]> {
  const { data, error } = await supabase.rpc("scholars_grades_monitoring_schools", { p_school_year: period.schoolYear, p_semester: period.semester });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    schoolId: String(r.school_id), schoolName: String(r.school_name),
    totalScholars: Number(r.total_scholars ?? 0), completeScholars: Number(r.complete_scholars ?? 0),
    percentComplete: Number(r.percent_complete ?? 0),
  }));
}

export interface ProgramCompletionRow {
  program: string;
  totalScholars: number;
  completeScholars: number;
  percentComplete: number;
}

export async function fetchProgramsCompletion(schoolId: string, period: GradingPeriod): Promise<ProgramCompletionRow[]> {
  const { data, error } = await supabase.rpc("scholars_grades_monitoring_programs", { p_school_id: schoolId, p_school_year: period.schoolYear, p_semester: period.semester });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    program: String(r.program), totalScholars: Number(r.total_scholars ?? 0),
    completeScholars: Number(r.complete_scholars ?? 0), percentComplete: Number(r.percent_complete ?? 0),
  }));
}

export interface MonitoringScholarRow {
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  schoolName: string;
  program: string;
}

export async function fetchMonitoringScholars(filters: { search?: string; schoolId?: string; program?: string }): Promise<MonitoringScholarRow[]> {
  const { data, error } = await supabase.rpc("scholars_grades_monitoring_scholars", {
    p_search: filters.search || null, p_school_id: filters.schoolId || null, p_program: filters.program || null,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name ?? ""),
    lastName: String(r.last_name ?? ""), middleName: String(r.middle_name ?? ""),
    schoolName: String(r.school_name ?? ""), program: String(r.program ?? ""),
  }));
}

export interface GradingConfig {
  scaleMin: number;
  scaleMax: number;
  direction: "lower_is_better" | "higher_is_better";
  usesLetterGrades: boolean;
}

export interface LetterGrade {
  letter: string;
  numericValue: number | null;
}

export async function fetchScholarGradingConfigForStaff(scholarIdNumber: string): Promise<GradingConfig | null> {
  const { data, error } = await supabase.rpc("get_scholar_grading_config_for_staff", { p_scholar_id_number: scholarIdNumber }).maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    scaleMin: Number(row.scale_min ?? 1), scaleMax: Number(row.scale_max ?? 5),
    direction: (row.direction as GradingConfig["direction"]) ?? "lower_is_better",
    usesLetterGrades: !!row.uses_letter_grades,
  };
}

export async function fetchScholarLetterGradesForStaff(scholarIdNumber: string): Promise<LetterGrade[]> {
  const { data, error } = await supabase.rpc("get_scholar_letter_grades_for_staff", { p_scholar_id_number: scholarIdNumber });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ letter: String(r.letter), numericValue: r.numeric_value == null ? null : Number(r.numeric_value) }));
}

/** Staff already has full SELECT on scholar_subjects_grades via RLS — no RPC needed for this read. */
export async function fetchScholarGradesForStaff(scholarIdNumber: string) {
  const { data, error } = await supabase
    .from("scholar_subjects_grades")
    .select("*")
    .eq("scholar_id_number", scholarIdNumber)
    .order("school_year", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    id: String(r.id), scholarIdNumber: String(r.scholar_id_number),
    schoolYear: String(r.school_year ?? ""), semester: String(r.semester ?? ""),
    subjectCode: String(r.subject_code ?? ""), subject: String(r.subject ?? ""),
    grade: r.grade == null ? "" : String(r.grade), remarks: String(r.remarks ?? ""),
  }));
}
