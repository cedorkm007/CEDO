// ─────────────────────────────────────────────────────────────
// src/school/schoolApi.ts
// Auth + data access for the School Portal. Same Supabase client/project
// as the staff and scholar apps (src/lib/supabase.ts) — a different table
// (public.school_accounts / public.schools), same Supabase Auth system.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { SchoolProfile, GradingConfig, LetterGrade, SchoolScholarRow, SchoolSubjectGrade } from "./types";
import type { GradingPeriod } from "@/sead/scholarsGradesMonitoringApi";

/**
 * Logs a school in. Schools are identified by their exact school name
 * (public.schools.name is unique) — Supabase Auth itself only understands
 * email + password, so this first resolves the matching email via the
 * `resolve_school_login_email` RPC, then signs in with it. Mirrors
 * scholarSignIn() in src/scholar/scholarApi.ts.
 */
export async function schoolSignIn(schoolName: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: email, error: rpcError } = await supabase.rpc("resolve_school_login_email", { p_school_name: schoolName });
  if (rpcError || !email) return { ok: false, error: "We couldn't find a school account matching that name." };

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) return { ok: false, error: "Incorrect school name or password." };
  return { ok: true };
}

export async function schoolSignOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function fetchCurrentSchoolProfile(): Promise<SchoolProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: account, error } = await supabase.from("school_accounts").select("school_id").eq("id", user.id).maybeSingle();
  if (error || !account) return null;
  const { data: school } = await supabase.from("schools").select("name").eq("id", account.school_id).maybeSingle();
  return { schoolId: String(account.school_id), schoolName: String(school?.name ?? "") };
}

/** Schools read their own grading config directly (RLS-scoped to their own school_id) — the get_scholar_grading_config RPC resolves via a *scholar's* own row instead, so it doesn't apply here. */
export async function fetchGradingConfig(): Promise<GradingConfig | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: account } = await supabase.from("school_accounts").select("school_id").eq("id", user.id).maybeSingle();
  if (!account) return null;
  const { data, error } = await supabase.from("school_grading_configs").select("*").eq("school_id", account.school_id).maybeSingle();
  if (error || !data) return null;
  return {
    scaleMin: Number(data.scale_min ?? 1), scaleMax: Number(data.scale_max ?? 5),
    direction: (data.direction as GradingConfig["direction"]) ?? "lower_is_better",
    usesLetterGrades: !!data.uses_letter_grades,
  };
}

export async function fetchLetterGrades(schoolId: string): Promise<LetterGrade[]> {
  const { data, error } = await supabase.from("school_letter_grades").select("letter, numeric_value").eq("school_id", schoolId).order("letter");
  if (error || !data) return [];
  return data.map(r => ({ letter: String(r.letter), numericValue: r.numeric_value == null ? null : Number(r.numeric_value) }));
}

export async function saveGradingConfig(config: GradingConfig): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("upsert_school_grading_config", {
    p_scale_min: config.scaleMin, p_scale_max: config.scaleMax, p_direction: config.direction, p_uses_letter_grades: config.usesLetterGrades,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveLetterGrades(letters: LetterGrade[]): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_school_letter_grades", {
    p_letters: letters.map(l => ({ letter: l.letter, numericValue: l.numericValue })),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchOwnScholars(schoolId: string): Promise<SchoolScholarRow[]> {
  const { data, error } = await supabase
    .from("scholars")
    .select("scholar_id_number, first_name, last_name, middle_name, year_level, course")
    .eq("school_id", schoolId)
    .order("last_name");
  if (error || !data) return [];
  return data.map(r => ({
    scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name ?? ""),
    lastName: String(r.last_name ?? ""), middleName: String(r.middle_name ?? ""),
    yearLevel: String(r.year_level ?? ""), course: String(r.course ?? ""),
  }));
}

export async function fetchScholarGrades(scholarIdNumber: string, period: GradingPeriod): Promise<SchoolSubjectGrade[]> {
  const { data, error } = await supabase
    .from("scholar_subjects_grades")
    .select("*")
    .eq("scholar_id_number", scholarIdNumber)
    .eq("school_year", period.schoolYear)
    .eq("semester", period.semester);
  if (error || !data) return [];
  return data.map(r => ({
    id: String(r.id), scholarIdNumber: String(r.scholar_id_number),
    schoolYear: String(r.school_year ?? ""), semester: String(r.semester ?? ""),
    subjectCode: String(r.subject_code ?? ""), subject: String(r.subject ?? ""),
    grade: r.grade == null ? "" : String(r.grade),
  }));
}

export interface UpsertGradeInput {
  id?: string | null;
  scholarIdNumber: string;
  schoolYear: string;
  semester: string;
  subjectCode: string;
  subject: string;
  grade: string;
}

export async function upsertGrade(input: UpsertGradeInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.rpc("upsert_scholar_subject_grade", {
    p_id: input.id || null, p_scholar_id_number: input.scholarIdNumber, p_school_year: input.schoolYear,
    p_semester: input.semester, p_subject_code: input.subjectCode, p_subject: input.subject, p_grade: input.grade,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data as string };
}

export interface BulkGradeRowResult {
  rowIndex: number;
  ok: boolean;
  error: string | null;
  id: string | null;
}

export async function bulkUpsertGrades(rows: UpsertGradeInput[]): Promise<{ ok: boolean; error?: string; results?: BulkGradeRowResult[] }> {
  const { data, error } = await supabase.rpc("bulk_upsert_scholar_subject_grades", {
    p_rows: rows.map(r => ({ id: r.id || null, scholarIdNumber: r.scholarIdNumber, schoolYear: r.schoolYear, semester: r.semester, subjectCode: r.subjectCode, subject: r.subject, grade: r.grade })),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, results: (data as Record<string, unknown>[]).map(r => ({ rowIndex: Number(r.row_index), ok: !!r.ok, error: r.error == null ? null : String(r.error), id: r.id == null ? null : String(r.id) })) };
}

export async function fetchCurrentGradingPeriod(): Promise<GradingPeriod> {
  const { data, error } = await supabase.rpc("get_current_grading_period").maybeSingle();
  if (error || !data) return { schoolYear: "", semester: "" };
  const row = data as Record<string, unknown>;
  return { schoolYear: String(row.current_school_year ?? ""), semester: String(row.current_semester ?? "") };
}
