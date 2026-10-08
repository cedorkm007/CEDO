import { supabase } from "@/lib/supabase";

export type ShareRole = "editor" | "viewer";

export interface StaffMatch {
  id: string;
  name: string;
  email: string;
  /** Set when this person already has access (so the dialog can say so). */
  accessRole: ShareRole | null;
}

export interface AccessEntry {
  userId: string;
  name: string;
  email: string;
  role: "owner" | ShareRole;
}

type Row = Record<string, unknown>;

function displayName(r: Row): string {
  const full = `${(r.first_name as string | null) ?? ""} ${(r.last_name as string | null) ?? ""}`.trim();
  return full || (r.username as string | null) || (r.email as string | null) || "Unknown staff";
}

/**
 * Staff search for the Share dialog. Owner-only on the server
 * (search_staff_for_survey_share): needs 2+ characters, never returns the owner,
 * and reports who already has access.
 */
export async function searchStaff(surveyId: string, query: string): Promise<{ ok: true; matches: StaffMatch[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("search_staff_for_survey_share", { p_survey_id: surveyId, p_query: query });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    matches: ((data ?? []) as Row[]).map(r => ({
      id: r.id as string,
      name: displayName(r),
      email: (r.email as string | null) ?? "",
      accessRole: (r.access_role as ShareRole | null) ?? null,
    })),
  };
}

/** The owner first, then everyone the survey is shared with. */
export async function listAccess(surveyId: string): Promise<{ ok: true; people: AccessEntry[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("list_my_survey_access", { p_survey_id: surveyId });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    people: ((data ?? []) as Row[]).map(r => ({
      userId: r.user_id as string,
      name: displayName(r),
      email: (r.email as string | null) ?? "",
      role: r.access_role as AccessEntry["role"],
    })),
  };
}

/** Add a person, or change their role. */
export async function setShare(surveyId: string, userId: string, role: ShareRole): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_my_survey_share", { p_survey_id: surveyId, p_user_id: userId, p_role: role });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The owner removes anyone; anyone else may only remove themself ("leave"). */
export async function removeShare(surveyId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("remove_my_survey_share", { p_survey_id: surveyId, p_user_id: userId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export const ROLE_LABELS: Record<"owner" | ShareRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
export const ROLE_HELP: Record<ShareRole, string> = {
  editor: "Can edit questions and settings, publish or close the survey, and view responses.",
  viewer: "Can view the survey and its responses, but can't change anything.",
};
