import { supabase } from "@/lib/supabase";

const DEVICE_ID_KEY = "cedo_presentations_device_id";

/** One id per browser, generated once and reused for every session this device joins -- the "one response per person per slide" mechanism the spec asks for. Not tied to any account; a cleared browser/private window is a new "person" by design, same tradeoff every anonymous-audience polling tool makes. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage unavailable (private mode, etc.) -- still works for this one page load, just won't remember across reloads
  }
}

export type SlideType = "title" | "word_cloud" | "multiple_choice" | "ranking";

export interface PublicSlide {
  id: string;
  type: SlideType;
  settings: Record<string, unknown>;
}

export interface SessionState {
  found: boolean;
  status?: "active" | "ended";
  presentationTitle?: string;
  sessionId?: string;
  showResults?: boolean;
  votingLocked?: boolean;
  slide?: PublicSlide | null;
}

export async function joinPresentationSession(joinCode: string): Promise<SessionState> {
  const { data, error } = await supabase.rpc("join_presentation_session", { p_join_code: joinCode });
  if (error || !data) return { found: false };
  return data as SessionState;
}

/** Polled every couple seconds while on the vote page -- the audience's "follow the presenter automatically" mechanism (see supabase_migration_presentations_sessions.sql's note on why this is polling, not an anon realtime subscription). */
export async function getSessionState(sessionId: string): Promise<SessionState> {
  const { data, error } = await supabase.rpc("get_presentation_session_state", { p_session_id: sessionId });
  if (error || !data) return { found: false };
  return data as SessionState;
}

export async function submitResponse(sessionId: string, response: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("submit_presentation_response", {
    p_session_id: sessionId, p_device_id: getDeviceId(), p_response: response,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Failed to submit." };
  return { ok: true };
}
