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
 * Logs a school in with its USERNAME (set by IT) or its login EMAIL — the school name no longer signs anyone in.
 * Supabase Auth itself only understands email + password, so this first resolves the matching login email via the
 * `resolve_school_login_email` RPC, then signs in with it. Mirrors scholarSignIn() in src/scholar/scholarApi.ts.
 * The RPC's parameter is still called p_school_name so the call shape didn't change when usernames were added.
 */
export async function schoolSignIn(usernameOrEmail: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: email, error: rpcError } = await supabase.rpc("resolve_school_login_email", { p_school_name: usernameOrEmail });
  if (rpcError || !email) return { ok: false, error: "We couldn't find a school account with that username or email." };

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) return { ok: false, error: "Incorrect username or password." };
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
    retentionThreshold: data.retention_threshold == null ? null : Number(data.retention_threshold),
  };
}

export async function fetchLetterGrades(schoolId: string): Promise<LetterGrade[]> {
  const { data, error } = await supabase.from("school_letter_grades").select("letter, numeric_value").eq("school_id", schoolId).order("letter");
  if (error || !data) return [];
  return data.map(r => ({ letter: String(r.letter), numericValue: r.numeric_value == null ? null : Number(r.numeric_value) }));
}

export async function saveGradingConfig(config: GradingConfig): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("upsert_school_grading_config", {
    p_scale_min: config.scaleMin, p_scale_max: config.scaleMax, p_direction: config.direction, p_uses_letter_grades: config.usesLetterGrades, p_retention_threshold: config.retentionThreshold ?? null,
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
    .neq("status", "Removed") // removed scholars cannot be graded; they are not counted or listed
    .order("last_name");
  if (error || !data) return [];
  return data.map(r => ({
    scholarIdNumber: String(r.scholar_id_number), firstName: String(r.first_name ?? ""),
    lastName: String(r.last_name ?? ""), middleName: String(r.middle_name ?? ""),
    yearLevel: String(r.year_level ?? ""), course: String(r.course ?? ""),
  }));
}

function toSubjectGrade(r: Record<string, unknown>): SchoolSubjectGrade {
  return {
    id: String(r.id), scholarIdNumber: String(r.scholar_id_number),
    schoolYear: String(r.school_year ?? ""), semester: String(r.semester ?? ""),
    subjectCode: String(r.subject_code ?? ""), subject: String(r.subject ?? ""),
    grade: r.grade == null ? "" : String(r.grade),
    units: r.units == null ? null : Number(r.units),
    excludeFromGwa: !!r.exclude_from_gwa,
  };
}

export type GradesResult = { ok: true; rows: SchoolSubjectGrade[] } | { ok: false; error: string };

/** Same read as fetchScholarGrades, but a failed read is reported instead of looking like "no grades". Used by the grade-entry screen so a save can be confirmed against what the database really holds. */
export async function fetchScholarGradesChecked(scholarIdNumber: string, period: GradingPeriod): Promise<GradesResult> {
  const { data, error } = await supabase
    .from("scholar_subjects_grades")
    .select("*")
    .eq("scholar_id_number", scholarIdNumber)
    .eq("school_year", period.schoolYear)
    .eq("semester", period.semester)
    .order("created_at");
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map(r => toSubjectGrade(r as Record<string, unknown>)) };
}

export async function fetchScholarGrades(scholarIdNumber: string, period: GradingPeriod): Promise<SchoolSubjectGrade[]> {
  const result = await fetchScholarGradesChecked(scholarIdNumber, period);
  return result.ok ? result.rows : [];
}

/** Every subject/grade row of the given scholars for one period, in pages — PostgREST returns at most 1000 rows per request and a school can easily have more (hundreds of scholars x several subjects). */
export async function fetchGradesForScholars(scholarIds: string[], period: GradingPeriod): Promise<GradesResult> {
  const PAGE = 1000;
  const ID_CHUNK = 200;
  const rows: SchoolSubjectGrade[] = [];
  for (let i = 0; i < scholarIds.length; i += ID_CHUNK) {
    const ids = scholarIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("scholar_subjects_grades")
        .select("*")
        .in("scholar_id_number", ids)
        .eq("school_year", period.schoolYear)
        .eq("semester", period.semester)
        .order("created_at")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return { ok: false, error: error.message };
      rows.push(...(data ?? []).map(r => toSubjectGrade(r as Record<string, unknown>)));
      if (!data || data.length < PAGE) break;
    }
  }
  return { ok: true, rows };
}

/** Really deletes saved subject rows (the school's own RLS policy allows it). Checks how many rows the database says it removed, so a "0 rows deleted" outcome is not reported as success. */
export async function deleteGradeRows(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  if (ids.length === 0) return { ok: true };
  const { data, error } = await supabase.from("scholar_subjects_grades").delete().in("id", ids).select("id");
  if (error) return { ok: false, error: error.message };
  if ((data?.length ?? 0) !== ids.length) return { ok: false, error: "Some subjects could not be removed — they may not belong to your school." };
  return { ok: true };
}

export interface UpsertGradeInput {
  id?: string | null;
  scholarIdNumber: string;
  schoolYear: string;
  semester: string;
  subjectCode: string;
  subject: string;
  grade: string;
  /** Leave out (or null) to keep whatever units are already stored. */
  units?: number | null;
  /** Leave out (or null) to keep the stored flag; a new subject starts as false. */
  excludeFromGwa?: boolean | null;
}

export async function upsertGrade(input: UpsertGradeInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.rpc("upsert_scholar_subject_grade", {
    p_id: input.id || null, p_scholar_id_number: input.scholarIdNumber, p_school_year: input.schoolYear,
    p_semester: input.semester, p_subject_code: input.subjectCode, p_subject: input.subject, p_grade: input.grade,
    p_units: input.units ?? null, p_exclude_from_gwa: input.excludeFromGwa ?? null,
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
    p_rows: rows.map(r => ({ id: r.id || null, scholarIdNumber: r.scholarIdNumber, schoolYear: r.schoolYear, semester: r.semester, subjectCode: r.subjectCode, subject: r.subject, grade: r.grade, units: r.units ?? null, excludeFromGwa: r.excludeFromGwa ?? null })),
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

/** The username CEDO gave this school account (null for older accounts that sign in by school name, or if it can't be read). Shown in the account menu so the school can see which login it is using. */
export async function fetchSchoolAccountUsername(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("school_accounts").select("username").eq("id", user.id).maybeSingle();
  if (error || !data || !data.username) return null;
  return String(data.username);
}

/**
 * Changes the signed-in school's password. The current password is checked first (by signing in again with it), so a
 * session left open on a shared computer cannot be used to lock the school out of its own account.
 */
export async function changeSchoolPassword(currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "You are not signed in. Please sign in again." };
  const check = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (check.error) return { ok: false, error: "The current password is not correct." };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** "Forgot password": tells the CEDO IT administrator this school cannot sign in. The reply never says whether the login exists, so the form cannot be used to find out which schools have accounts. */
export async function requestSchoolPasswordReset(login: string): Promise<{ ok: boolean }> {
  const { error } = await supabase.rpc("request_school_password_reset", { p_login: login.trim() });
  return { ok: !error };
}
