import { supabase } from "@/lib/supabase";

export interface PresentationSession {
  id: string;
  presentationId: string;
  joinCode: string;
  status: "active" | "ended";
  currentSlideId: string | null;
  showResults: boolean;
  votingLocked: boolean;
}

export async function startPresentationSession(presentationId: string): Promise<{ ok: true; sessionId: string; joinCode: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("start_presentation_session", { p_presentation_id: presentationId });
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to start the session." };
  return { ok: true, sessionId: data.sessionId as string, joinCode: data.joinCode as string };
}

export async function endPresentationSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("end_presentation_session", { p_session_id: sessionId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setPresentationSessionSlide(sessionId: string, slideId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_presentation_session_slide", { p_session_id: sessionId, p_slide_id: slideId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setPresentationSessionState(sessionId: string, patch: { showResults?: boolean; votingLocked?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("set_presentation_session_state", {
    p_session_id: sessionId,
    p_show_results: patch.showResults ?? null,
    p_voting_locked: patch.votingLocked ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function resetSlideResponses(sessionId: string, slideId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("reset_slide_responses", { p_session_id: sessionId, p_slide_id: slideId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

function rowToSession(r: Record<string, unknown>): PresentationSession {
  return {
    id: r.id as string,
    presentationId: r.presentation_id as string,
    joinCode: r.join_code as string,
    status: r.status as "active" | "ended",
    currentSlideId: (r.current_slide_id as string | null) ?? null,
    showResults: r.show_results as boolean,
    votingLocked: r.voting_locked as boolean,
  };
}

/** The presenter's own read of their session's live state -- used right after starting/toggling so the presenter UI reflects the DB immediately, distinct from the audience's poll-based get_presentation_session_state RPC. */
export async function fetchPresentationSession(sessionId: string): Promise<PresentationSession | null> {
  const { data, error } = await supabase.from("presentation_sessions").select("*").eq("id", sessionId).single();
  if (error || !data) return null;
  return rowToSession(data);
}

export interface PresentationResponseRow {
  id: string;
  slideId: string;
  deviceId: string;
  response: { words?: string[]; selectedIndexes?: number[]; order?: number[] };
  hidden: boolean;
  createdAt: string;
}

/** Every (non-hidden-aware -- Phase 5 filters that) response for one slide of one session, for the presenter's own live results view. Owner-scoped by RLS, not by this query. */
export async function fetchSlideResponses(sessionId: string, slideId: string): Promise<PresentationResponseRow[]> {
  const { data, error } = await supabase.from("presentation_responses")
    .select("*").eq("session_id", sessionId).eq("slide_id", slideId);
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
