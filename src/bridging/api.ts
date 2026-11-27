// Everything the Bridging screens ask of the Bridging database. It is a SEPARATE Supabase project from the rest of the CEDO website:
// nothing here can reach scholar or staff data, and nothing here is imported by the other portals.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { accountEmail, authMessage, cleanUsername, type NoticeSettings, type School } from "./logic";

const URL = (import.meta.env.VITE_BRIDGING_SUPABASE_URL as string | undefined)?.trim() ?? "";
const KEY = (import.meta.env.VITE_BRIDGING_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";
/** false until the two settings are added in Vercel (or .env). */
export const configured = URL !== "" && KEY !== "";

// its own sign-in memory: a student signing in here does not sign anyone out of the other portals
export const db: SupabaseClient = createClient(URL || "http://not-configured.invalid", KEY || "not-configured", { auth: { storageKey: "bridging-auth" } });

export type Result = { ok: true } | { ok: false; error: string };

export interface Options {
  schools: School[];
  subjects: { key: string; name: string }[];
  notice: { version: number; en: string; ceb: string };
  settings: NoticeSettings;
}
export interface Me {
  role: "student" | "teacher";
  status: "active" | "pending" | "declined" | "deactivated";
  username: string; lastName: string; firstName: string; middleName: string;
  schoolId: string | null; schoolName: string; schoolListed: boolean; level: string | null; contactEmail: string | null;
  levels: string[]; subjects: string[];
  teacher: { id: string | null; status: string; name: string } | null;
  openRequests: string[];
  needsConsent: boolean;
}

const friendly = (message: string) =>
  /failed to fetch|network/i.test(message) ? "Couldn't reach the server. Check your connection and try again." : message;

async function call(fn: string, args?: Record<string, unknown>): Promise<Result> {
  const { error } = await db.rpc(fn, args);
  return error ? { ok: false, error: friendly(error.message) } : { ok: true };
}

export async function fetchOptions(): Promise<Options | null> {
  const { data, error } = await db.rpc("bridging_options");
  return error || !data ? null : (data as Options);
}
export async function fetchTeachers(schoolId: string, level: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db.rpc("bridging_teachers", { p_school_id: schoolId, p_level: level });
  return error || !data ? [] : (data as { id: string; name: string }[]);
}
/** undefined: could not be read. null: signed in but registration not finished. */
export async function fetchMe(): Promise<Me | null | undefined> {
  const { data, error } = await db.rpc("bridging_me");
  return error ? undefined : ((data as Me | null) ?? null);
}

export async function signIn(username: string, password: string): Promise<Result> {
  const { error } = await db.auth.signInWithPassword({ email: accountEmail(username), password });
  return error ? { ok: false, error: authMessage(error) } : { ok: true };
}
/** Registers through the server function "bridging-register" (public sign-up is off), then signs in. duplicate: the same name is already registered. */
export async function register(username: string, password: string, details: unknown, captchaToken: string): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  const { data, error } = await db.functions.invoke("bridging-register", { body: { username: cleanUsername(username), password, details, captchaToken } });
  if (error) {
    // the function's own message is in the response body
    const said = await (error as { context?: Response }).context?.json?.().catch(() => null) as { error?: string } | null;
    return { ok: false, error: said?.error ?? "Couldn't reach the registration service. Check your connection and try again." };
  }
  const answer = data as { ok?: boolean; duplicate?: boolean; error?: string };
  if (answer.error) return { ok: false, error: answer.error };
  if (answer.duplicate) return { ok: true, duplicate: true };
  const signedIn = await signIn(username, password);
  return signedIn.ok === false ? { ok: false, error: "Your account was created. Go back and sign in with your username and password." } : { ok: true, duplicate: false };
}
export const signOut = async () => { await db.auth.signOut(); };

export const acceptNotice = (consent: unknown) => call("bridging_accept_notice", { p_consent: consent });
export const updateProfile = (p: unknown) => call("bridging_update_profile", { p });
export const chooseTeacher = (teacher: unknown) => call("bridging_choose_teacher", { p_teacher: teacher });
export const sendRequest = (kind: "school_change" | "delete_account", details: Record<string, unknown>) => call("bridging_request", { p_kind: kind, p_details: details });
export const cancelRequest = (kind: "school_change" | "delete_account") => call("bridging_cancel_request", { p_kind: kind });
export const forgotPassword = (username: string) => call("bridging_forgot_password", { p_username: username });
export async function changePassword(password: string): Promise<Result> {
  const { error } = await db.auth.updateUser({ password });
  return error ? { ok: false, error: /same|different/i.test(error.message) ? "Choose a password different from your current one." : authMessage(error) } : { ok: true };
}
