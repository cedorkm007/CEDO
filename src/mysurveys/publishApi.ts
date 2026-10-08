import { supabase } from "@/lib/supabase";
import type { SurveyRole, SurveyStatus } from "./surveyTypes";

export interface PublishInfo {
  status: SurveyStatus;
  publicSlug: string | null;
  publishedAt: string | null;
  thankYouMessage: string;
  oneResponsePerDevice: boolean;
  /** ISO timestamp or null. */
  closesAt: string | null;
  responseLimit: number | null;
  responseCount: number;
  closesAtPassed: boolean;
  limitReached: boolean;
  role: SurveyRole;
  revision: number;
}

export interface SurveySettings {
  thankYouMessage: string;
  oneResponsePerDevice: boolean;
  closesAt: string | null;
  responseLimit: number | null;
}

/** Result of a staff action that changes the survey (settings, publish, close). */
export type ActionResult =
  | { ok: true; revision: number; publicSlug?: string }
  | { ok: false; conflict: true; revision: number; updatedAt: string; editedByName: string }
  | { ok: false; conflict: false; problems: string[] }
  | { ok: false; conflict: false; error: string };

/** The public address respondents use. */
export function publicSurveyUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
}

export async function getPublishInfo(surveyId: string): Promise<PublishInfo | null> {
  const { data, error } = await supabase.rpc("get_my_survey_publish_info", { p_survey_id: surveyId });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    status: d.status as SurveyStatus,
    publicSlug: (d.publicSlug as string | null) ?? null,
    publishedAt: (d.publishedAt as string | null) ?? null,
    thankYouMessage: (d.thankYouMessage as string) ?? "",
    oneResponsePerDevice: Boolean(d.oneResponsePerDevice),
    closesAt: (d.closesAt as string | null) ?? null,
    responseLimit: (d.responseLimit as number | null) ?? null,
    responseCount: Number(d.responseCount ?? 0),
    closesAtPassed: Boolean(d.closesAtPassed),
    limitReached: Boolean(d.limitReached),
    role: ((d.role as SurveyRole | null) ?? "viewer"),
    revision: d.revision as number,
  };
}

function toResult(data: unknown, error: { message: string } | null): ActionResult {
  if (error) return { ok: false, conflict: false, error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok === true) return { ok: true, revision: r.revision as number, publicSlug: (r.publicSlug as string | undefined) };
  if (r.conflict) {
    return { ok: false, conflict: true, revision: r.revision as number, updatedAt: r.updatedAt as string, editedByName: (r.editedByName as string | null) ?? "" };
  }
  if (Array.isArray(r.problems)) return { ok: false, conflict: false, problems: r.problems as string[] };
  return { ok: false, conflict: false, error: "Something went wrong." };
}

export async function saveSettings(surveyId: string, expectedRevision: number, settings: SurveySettings): Promise<ActionResult> {
  const { data, error } = await supabase.rpc("save_my_survey_settings", {
    p_survey_id: surveyId, p_expected_revision: expectedRevision, p_settings: settings,
  });
  return toResult(data, error);
}

/** "open" publishes (or reopens); the server refuses with a list of problems if the survey isn't ready. */
export async function setSurveyStatus(surveyId: string, expectedRevision: number, status: "open" | "closed"): Promise<ActionResult> {
  const { data, error } = await supabase.rpc("set_my_survey_status", {
    p_survey_id: surveyId, p_expected_revision: expectedRevision, p_status: status,
  });
  return toResult(data, error);
}
