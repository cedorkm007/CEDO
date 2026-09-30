import { supabase } from "@/lib/supabase";
import type { PresentationResponseRow } from "./presentationSessionApi";

export interface PresentationSessionSummary {
  id: string;
  joinCode: string;
  status: "active" | "ended";
  createdAt: string;
  endedAt: string | null;
}

/** Every session (active or ended) ever run for a presentation, most recent first -- the "reopen and view past results" list. Owner-scoped by RLS, not by this query. */
export async function fetchSessionsForPresentation(presentationId: string): Promise<PresentationSessionSummary[]> {
  const { data, error } = await supabase.from("presentation_sessions")
    .select("id, join_code, status, created_at, ended_at")
    .eq("presentation_id", presentationId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id as string,
    joinCode: r.join_code as string,
    status: r.status as "active" | "ended",
    createdAt: r.created_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
  }));
}

/** Every response across every slide of one session -- used for the full-session results review and CSV export (fetchSlideResponses in presentationSessionApi.ts only loads one slide at a time, for the live present view). */
export async function fetchAllResponsesForSession(sessionId: string): Promise<PresentationResponseRow[]> {
  const { data, error } = await supabase.from("presentation_responses").select("*").eq("session_id", sessionId);
  if (error || !data) return [];
  return data.map(r => ({
    id: r.id as string,
    slideId: r.slide_id as string,
    deviceId: r.device_id as string,
    response: r.response as PresentationResponseRow["response"],
    hidden: r.hidden as boolean,
    createdAt: r.created_at as string,
  }));
}

export async function setResponseHidden(responseId: string, hidden: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_response_hidden", { p_response_id: responseId, p_hidden: hidden });
  return error ? { ok: false, error: error.message } : { ok: true };
}
