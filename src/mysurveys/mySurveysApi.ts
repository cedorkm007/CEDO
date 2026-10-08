import { supabase } from "@/lib/supabase";

export type SurveyStatus = "draft" | "open" | "closed";
export type SurveyRole = "owner" | "editor" | "viewer";

/** One row of the My Surveys / Shared with me list (see list_my_surveys in supabase_migration_my_surveys_core.sql). */
export interface SurveyListItem {
  id: string;
  title: string;
  status: SurveyStatus;
  publicSlug: string | null;
  ownerId: string;
  ownerName: string;
  myRole: SurveyRole;
  responseCount: number;
  lastEditedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyHeader {
  id: string;
  ownerId: string;
  title: string;
  status: SurveyStatus;
  revision: number;
  lastEditedByName: string;
  updatedAt: string;
  myRole: SurveyRole;
}

export type SurveyScope = "mine" | "shared";

function rowToListItem(r: Record<string, unknown>): SurveyListItem {
  return {
    id: r.id as string,
    title: r.title as string,
    status: r.status as SurveyStatus,
    publicSlug: (r.public_slug as string | null) ?? null,
    ownerId: r.owner_id as string,
    ownerName: (r.owner_name as string | null) ?? "Unknown staff",
    myRole: r.my_role as SurveyRole,
    responseCount: Number(r.response_count ?? 0),
    lastEditedByName: (r.last_edited_by_name as string | null) ?? "",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Surveys the signed-in staff member owns ("mine") or that others have shared with them ("shared"). Permissions are enforced by RLS, not here. */
export async function fetchSurveyList(scope: SurveyScope): Promise<{ ok: true; surveys: SurveyListItem[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("list_my_surveys", { p_scope: scope });
  if (error) return { ok: false, error: error.message };
  return { ok: true, surveys: ((data ?? []) as Record<string, unknown>[]).map(rowToListItem) };
}

export async function createSurvey(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ownerId = await currentUserId();
  if (!ownerId) return { ok: false, error: "Not signed in." };
  const { data, error } = await supabase.from("my_surveys")
    .insert({ owner_id: ownerId, last_edited_by: ownerId })
    .select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create survey." };
  return { ok: true, id: data.id as string };
}

export async function duplicateSurvey(id: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("duplicate_my_survey", { p_survey_id: id });
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to duplicate survey." };
  return { ok: true, id: data as string };
}

/** Owner-only: enforced by the "owner deletes survey" policy. A delete RLS refuses affects zero rows without an error, so the row count is checked explicitly. */
export async function deleteSurvey(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from("my_surveys").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Only the owner can delete this survey." };
  return { ok: true };
}

export async function fetchSurveyHeader(id: string): Promise<SurveyHeader | null> {
  const { data, error } = await supabase.from("my_surveys")
    .select("id, owner_id, title, status, revision, last_edited_by, updated_at").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const [{ data: role }, { data: editor }] = await Promise.all([
    supabase.rpc("my_survey_role", { p_survey_id: id }),
    data.last_edited_by
      ? supabase.from("users").select("first_name, last_name").eq("id", data.last_edited_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const lastEditedByName = editor ? `${editor.first_name ?? ""} ${editor.last_name ?? ""}`.trim() : "";
  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    title: data.title as string,
    status: data.status as SurveyStatus,
    revision: data.revision as number,
    lastEditedByName,
    updatedAt: data.updated_at as string,
    myRole: ((role as SurveyRole | null) ?? "viewer"),
  };
}

export async function renameSurvey(id: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from("my_surveys").update({ title }).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "You don't have permission to edit this survey." };
  return { ok: true };
}
