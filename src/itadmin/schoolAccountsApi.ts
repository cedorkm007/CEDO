import { supabase } from "@/lib/supabase";

export interface SchoolOption {
  id: string;
  name: string;
}

/** Every row in the schools lookup table (backfilled from scholars.school — see supabase_migration_scholars_grades_monitoring.sql), for the "Add School Account" school picker. */
export async function fetchSchoolsList(): Promise<SchoolOption[]> {
  const { data, error } = await supabase.from("schools").select("id, name").order("name");
  if (error || !data) return [];
  return data.map(r => ({ id: r.id, name: r.name }));
}

const USERNAME_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
export const SCHOOL_PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;

/** Returns an error message, or null if OK. Mirrors the rules enforced by it-create-school-account and the school_accounts check constraint -- this copy is only for instant feedback, the server is the real gate. */
export function validateSchoolUsername(username: string): string | null {
  if (!username) return "Enter a username.";
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(username)) return "Use lowercase letters and numbers only, with single dots, dashes, or underscores between them (e.g. capitol.university).";
  return null;
}

export function validateSchoolPassword(password: string): string | null {
  if (password.length < SCHOOL_PASSWORD_MIN) return `Password must be at least ${SCHOOL_PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  return null;
}

export async function createSchoolAccount(schoolId: string, username: string, password: string): Promise<{ ok: boolean; error?: string; schoolName?: string; username?: string }> {
  const { data, error } = await supabase.functions.invoke("it-create-school-account", { body: { schoolId, username, password } });
  if (error) {
    // supabase-js reports any 4xx/5xx as the generic "Edge Function returned a
    // non-2xx status code"; the real reason ("username already taken", ...)
    // is in the raw response body, same unwrapping as seadApi.ts's
    // invokeEdgeFunction.
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = await context.clone().json();
        if (parsed?.error) message = parsed.error;
      } catch { /* body wasn't JSON -- keep the generic message */ }
    }
    return { ok: false, error: message };
  }
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, schoolName: data?.schoolName, username: data?.username };
}

export interface SchoolAccountListItem {
  id: string;
  schoolId: string;
  schoolName: string;
  email: string;
  /** Null for accounts created before usernames existed -- those sign in by school name. */
  username: string | null;
}

export async function fetchSchoolAccountsList(): Promise<SchoolAccountListItem[]> {
  // select("*") instead of naming the username column keeps this list
  // loading even if the username migration hasn't been applied yet.
  const { data, error } = await supabase
    .from("school_accounts")
    .select("*, schools(name)")
    .order("email");
  if (error || !data) return [];
  return (data as unknown as { id: string; school_id: string; email: string; username?: string | null; schools: { name: string } | null }[]).map(r => ({
    id: r.id, schoolId: r.school_id, schoolName: r.schools?.name ?? "(Unknown school)", email: r.email, username: r.username ?? null,
  }));
}

export async function deleteSchoolAccount(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("it-delete-school-account", { body: { id } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}

export async function resetSchoolPassword(id: string): Promise<{ ok: boolean; error?: string; name?: string }> {
  const { data, error } = await supabase.functions.invoke("it-reset-school-password", { body: { id } });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, name: data?.name };
}
