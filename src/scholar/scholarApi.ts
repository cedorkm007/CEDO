// ─────────────────────────────────────────────────────────────
// src/scholar/scholarApi.ts
// Auth + data access for the Scholar Portal. Uses the SAME Supabase client
// / project as the staff app (src/lib/supabase.ts) — different tables
// (public.scholars, public.scholar_*), same Supabase Auth system.
// ─────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { ScholarProfile, SubjectGrade, QuestScore } from "./types";

export interface ExistingScholarLoginInput {
  mode: "name" | "id";
  firstName?: string;
  lastName?: string;
  middleInitial?: string;
  birthday?: string; // YYYY-MM-DD
  scholarIdNumber?: string;
  password: string;
}

/**
 * Logs an existing scholar in. The login screen identifies the scholar by
 * either (name + birthday) or (Scholar ID number) — Supabase Auth itself
 * only understands email + password, so we first resolve the email via the
 * `resolve_scholar_login_email` RPC (see supabase_migration_scholar_portal.sql),
 * then sign in with it.
 */
export async function scholarSignIn(input: ExistingScholarLoginInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: email, error: rpcError } = await supabase.rpc("resolve_scholar_login_email", {
    p_first_name: input.mode === "name" ? (input.firstName ?? null) : null,
    p_last_name: input.mode === "name" ? (input.lastName ?? null) : null,
    p_middle_initial: input.mode === "name" ? (input.middleInitial ?? null) : null,
    p_birthday: input.mode === "name" ? (input.birthday ?? null) : null,
    p_scholar_id_number: input.mode === "id" ? (input.scholarIdNumber ?? null) : null,
  });

  if (rpcError || !email) {
    return { ok: false, error: "We couldn't find a scholar account matching those details." };
  }

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password: input.password });
  if (authError) {
    return { ok: false, error: "Incorrect details or password." };
  }
  return { ok: true };
}

export async function scholarSignOut(): Promise<void> {
  await supabase.auth.signOut();
}

function rowToProfile(r: Record<string, unknown>): ScholarProfile {
  return {
    id: String(r.id),
    scholarIdNumber: String(r.scholar_id_number ?? ""),
    firstName: String(r.first_name ?? ""),
    lastName: String(r.last_name ?? ""),
    middleName: String(r.middle_name ?? ""),
    birthday: String(r.birthday ?? ""),
    email: String(r.email ?? ""),
    contactNo: String(r.contact_no ?? ""),
    school: String(r.school ?? ""),
    course: String(r.course ?? ""),
    yearLevel: String(r.year_level ?? ""),
    civilStatus: String(r.civil_status ?? ""),
    address: String(r.address ?? ""),
    houseUnitNo: String(r.house_unit_no ?? ""),
    street: String(r.street ?? ""),
    barangay: String(r.barangay ?? ""),
    cityMunicipality: String(r.city_municipality ?? ""),
    provinceRegion: String(r.province_region ?? ""),
    country: String(r.country ?? ""),
    zipCode: String(r.zip_code ?? ""),
    status: (r.status as ScholarProfile["status"]) ?? "active",
  };
}

/** Fetches the currently signed-in scholar's own profile (RLS: own row only). */
export async function fetchCurrentScholarProfile(): Promise<ScholarProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("scholars").select("*").eq("id", user.id).maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as Record<string, unknown>);
}

export async function fetchSubjectsAndGrades(scholarIdNumber: string): Promise<SubjectGrade[]> {
  const { data, error } = await supabase
    .from("scholar_subjects_grades")
    .select("*")
    .eq("scholar_id_number", scholarIdNumber)
    .order("school_year", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    id: String(r.id),
    scholarIdNumber: String(r.scholar_id_number),
    schoolYear: String(r.school_year ?? ""),
    semester: String(r.semester ?? ""),
    subject: String(r.subject ?? ""),
    grade: String(r.grade ?? ""),
    remarks: String(r.remarks ?? ""),
  }));
}

export async function fetchQuestScores(scholarIdNumber: string): Promise<QuestScore[]> {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("scholar_quest_scores")
      .select("*")
      .eq("scholar_id_number", scholarIdNumber)
      .order("date_taken", { ascending: false })
      .order("id")
      .range(from, from + pageSize - 1);
    if (error || !data) return [];
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < pageSize) break;
  }
  return rows.map(r => ({
    id: String(r.id),
    scholarIdNumber: String(r.scholar_id_number),
    questName: String(r.quest_name ?? ""),
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    dateTaken: r.date_taken == null ? null : String(r.date_taken),
    remarks: String(r.remarks ?? ""),
  }));
}

/** Scholar self-service: update ONLY civil status + contact number on their own row. */
export interface OwnProfileEditableFields {
  civilStatus: string;
  contactNo: string;
  houseUnitNo: string;
  street: string;
  barangay: string;
  cityMunicipality: string;
  provinceRegion: string;
  country: string;
  zipCode: string;
}

export async function updateOwnContactInfo(fields: OwnProfileEditableFields): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("update_own_scholar_contact", {
    p_civil_status: fields.civilStatus,
    p_contact_no: fields.contactNo,
    p_house_unit_no: fields.houseUnitNo,
    p_street: fields.street,
    p_barangay: fields.barangay,
    p_city_municipality: fields.cityMunicipality,
    p_province_region: fields.provinceRegion,
    p_country: fields.country,
    p_zip_code: fields.zipCode,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Scholar redeems a time-in/time-out/voucher code, either scanned via QR or typed manually.
 *  All validation (already redeemed, invalid code, caller must be a scholar) happens inside
 *  the redeem_attendance_code() database function — this is a thin wrapper around it.
 *  `surveyPending`/`surveyId` are set when this was a time_out or voucher scan on an activity
 *  with a survey attached that this scholar hasn't completed yet — the attendance/voucher is
 *  recorded but held at status='pending_survey' until the survey is finished (see
 *  SurveyResponseModal). time_in is never gated. */
export async function redeemAttendanceCode(code: string): Promise<{ ok: boolean; error?: string; kind?: string; activityName?: string; surveyPending?: boolean; surveyId?: string }> {
  const { data, error } = await supabase.rpc("redeem_attendance_code", { p_code: code.trim() });
  if (error) return { ok: false, error: error.message };
  return { ok: true, kind: data?.kind, activityName: data?.activityName, surveyPending: data?.surveyPending, surveyId: data?.surveyId };
}

// ── Survey response (attendance-gating) ──────────────────────

export interface SurveyResponseChoice {
  id: string;
  choiceText: string;
}
export interface SurveyResponseQuestion {
  id: string;
  questionType: "multiple_choice" | "likert";
  questionText: string;
  sortOrder: number;
  likertScaleMin: number | null;
  likertScaleMax: number | null;
  likertMinLabel: string | null;
  likertMaxLabel: string | null;
  choices: SurveyResponseChoice[];
}
export interface SurveyResponseAnswer {
  questionId: string;
  choiceId: string | null;
  likertValue: number | null;
}

/** Starts a new survey response, or resumes an in-progress one — idempotent, safe to call both right after a gated scan and from the "resume your survey" dashboard banner. */
export async function startOrResumeSurveyResponse(surveyId: string): Promise<{
  ok: boolean; error?: string; responseId?: string; questions?: SurveyResponseQuestion[]; answers?: SurveyResponseAnswer[];
}> {
  const { data, error } = await supabase.rpc("start_or_resume_survey_response", { p_survey_id: surveyId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, responseId: data?.responseId, questions: data?.questions ?? [], answers: data?.answers ?? [] };
}

/** Saves one question's answer — its own round trip, so an answered question survives the scholar closing the app before finishing the survey. */
export async function submitSurveyAnswer(input: {
  responseId: string; questionId: string; choiceId?: string; likertValue?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("submit_survey_answer", {
    p_response_id: input.responseId, p_question_id: input.questionId,
    p_choice_id: input.choiceId ?? null, p_likert_value: input.likertValue ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Finalizes the survey response — requires every question answered, then flips any of this scholar's attendance/voucher rows that were held pending on this survey to 'present'. */
export async function submitSurveyResponse(responseId: string): Promise<{ ok: boolean; error?: string; finalizedCount?: number; activityName?: string }> {
  const { data, error } = await supabase.rpc("submit_survey_response", { p_response_id: responseId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, finalizedCount: data?.finalizedCount, activityName: data?.activityName };
}

export interface PendingSurvey {
  surveyId: string;
  surveyTitle: string;
  activityName: string;
}

/** Every survey this scholar has an attendance/voucher scan held open on (status='pending_survey') — powers the dashboard's "resume your survey" banner. Permitted by the scholar's own existing RLS read access to attendance_records, so no new RPC is needed for this read. */
export async function fetchMyPendingSurveys(): Promise<PendingSurvey[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("pending_survey_id, session_id, attendance_sessions(sdp_activities(name), formation_activities(name), sdp_activity_id, formation_activity_id)")
    .eq("status", "pending_survey");
  if (error || !data) return [];

  const surveyIds = [...new Set(data.map(r => r.pending_survey_id).filter((id): id is string => !!id))];
  if (surveyIds.length === 0) return [];
  const { data: surveys } = await supabase.from("research_surveys").select("id, title").in("id", surveyIds);
  const titleMap = new Map((surveys ?? []).map(s => [s.id, s.title]));

  return data
    .filter(r => r.pending_survey_id)
    .map(r => {
      // Supabase's nested-relation typing can't express "one of these two
      // is present" precisely, so this is read defensively rather than typed strictly.
      const session = r.attendance_sessions as unknown as { sdp_activities?: { name: string } | null; formation_activities?: { name: string } | null } | null;
      const activityName = session?.sdp_activities?.name ?? session?.formation_activities?.name ?? "the activity";
      return { surveyId: r.pending_survey_id as string, surveyTitle: titleMap.get(r.pending_survey_id as string) ?? "Survey", activityName };
    });
}

export interface AttendanceFinalizedNotification {
  notificationId: string;
  activityName: string;
}

/** Unread "your attendance/voucher was finalized" notices — finalization can happen in a later session than the scan (the scholar resumed the survey from the dashboard banner), so this covers that case separately from the immediate in-app confirmation shown right after a successful submitSurveyResponse. */
export async function fetchAttendanceFinalizedNotifications(): Promise<AttendanceFinalizedNotification[]> {
  const { data, error } = await supabase
    .from("scholar_attendance_finalized_notifications")
    .select("id, session_id, attendance_sessions(sdp_activities(name), formation_activities(name))")
    .is("read_at", null);
  if (error || !data) return [];
  return data.map(n => {
    const session = n.attendance_sessions as unknown as { sdp_activities?: { name: string } | null; formation_activities?: { name: string } | null } | null;
    return { notificationId: n.id, activityName: session?.sdp_activities?.name ?? session?.formation_activities?.name ?? "the activity" };
  });
}

export async function markAttendanceFinalizedNotificationsRead(notificationIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("scholar_attendance_finalized_notifications").update({ read_at: new Date().toISOString() }).in("id", notificationIds);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Scholar self-service password change — re-verifies the current password first. */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "Not signed in." };

  const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verifyError) return { ok: false, error: "Current password is incorrect." };

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}

export interface PasswordResetRequestInput {
  scholarId: string; // optional — caller may pass ""
  lastName: string;
  firstName: string;
  middleInitial: string;
  school: string;
  yearLevel: string;
}

/**
 * Submits a manual password-reset request for a scholar who can't log in
 * (the real forgot-password flow isn't functional yet) — recorded by the
 * scholar-password-reset-request Edge Function as a row in a staff-managed
 * Google Sheet for someone to verify and reset by hand. Deliberately
 * callable while signed out (the function is deployed with
 * --no-verify-jwt) — there's no session to invoke this with otherwise.
 */
export async function requestScholarPasswordReset(input: PasswordResetRequestInput): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("scholar-password-reset-request", { body: input });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = await context.clone().json();
        if (parsed?.error) message = parsed.error;
      } catch { /* not JSON */ }
    }
    return { ok: false, error: message };
  }
  const payload = data as { error?: string } | null;
  if (payload?.error) return { ok: false, error: payload.error };
  return { ok: true };
}
