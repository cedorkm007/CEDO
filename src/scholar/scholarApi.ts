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
  const { data, error } = await supabase
    .from("scholar_quest_scores")
    .select("*")
    .eq("scholar_id_number", scholarIdNumber)
    .order("date_taken", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
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
