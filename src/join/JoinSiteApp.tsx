import { useEffect, useRef, useState } from "react";
import { LogIn, MonitorPlay, XCircle } from "lucide-react";
import { joinPresentationSession, getSessionState, type SessionState } from "./joinApi";
import { WordCloudVote } from "./components/WordCloudVote";
import { MultipleChoiceVote } from "./components/MultipleChoiceVote";
import { RankingVote } from "./components/RankingVote";

const POLL_INTERVAL_MS = 2000;

/**
 * Root of the public, no-login audience app (mounted at /join, see
 * src/main.tsx) -- Phase 4 of "My Presentations". Entirely separate from
 * every other top-level app in this project (no accounts, same idea as
 * KaubanApp.tsx): a person scans the presenter's QR or types the 6-digit
 * code, then sees only the current slide's question and voting controls,
 * following the presenter automatically via polling (there's no
 * precedent in this schema for authorizing an anonymous realtime
 * subscription -- see the migration's own note on this tradeoff).
 */
export function JoinSiteApp() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const pollRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const sessionId = session?.sessionId;
    if (!sessionId) return;
    // Merge into the existing session rather than replacing it wholesale --
    // get_presentation_session_state's own return shape (by design, since
    // it's also the audience's per-poll payload, kept minimal) omits
    // sessionId/presentationTitle, which join_presentation_session did set;
    // overwriting the whole object on every poll tick was wiping those out
    // after the first tick, silently breaking every submitResponse call
    // afterward (its p_session_id ended up undefined -- caught live-testing
    // this phase).
    pollRef.current = window.setInterval(async () => {
      const next = await getSessionState(sessionId);
      setSession(prev => {
        if (!prev) return prev;
        if (!next.found) return { ...prev, status: "ended" };
        return { ...prev, status: next.status, showResults: next.showResults, votingLocked: next.votingLocked, slide: next.slide };
      });
    }, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [session?.sessionId]);

  async function handleJoin() {
    const trimmed = code.trim();
    if (trimmed.length !== 6) { setJoinError("Enter the 6-digit code."); return; }
    setJoining(true);
    setJoinError("");
    const result = await joinPresentationSession(trimmed);
    setJoining(false);
    if (!result.found) { setJoinError("That code isn't active. Double-check it with the presenter."); return; }
    setSession(result);
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#062444] flex flex-col items-center justify-center p-6">
        <MonitorPlay size={40} className="text-[#F3BC00] mb-4" />
        <h1 className="text-white text-xl font-bold mb-1">Join a Presentation</h1>
        <p className="text-white/60 text-[13px] mb-6">Enter the code shown on screen</p>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={e => e.key === "Enter" && handleJoin()}
          placeholder="000000" inputMode="numeric"
          className="w-full max-w-[220px] text-center text-[28px] font-bold tracking-[0.3em] bg-white/10 border border-white/30 text-white rounded-xl px-4 py-3 outline-none focus:border-[#F3BC00] mb-4"
        />
        <button
          onClick={handleJoin} disabled={joining}
          className="flex items-center gap-2 bg-[#F3BC00] text-[#062444] font-semibold rounded-xl px-6 py-2.5 disabled:opacity-60"
        >
          <LogIn size={16} /> {joining ? "Joining…" : "Join"}
        </button>
        {joinError && <p className="text-red-300 text-[12.5px] mt-4 text-center max-w-xs">{joinError}</p>}
      </div>
    );
  }

  if (session.status === "ended") {
    return (
      <div className="min-h-screen bg-[#062444] flex flex-col items-center justify-center p-6 text-center">
        <XCircle size={40} className="text-white/40 mb-4" />
        <h1 className="text-white text-lg font-bold mb-1">This session has ended</h1>
        <p className="text-white/60 text-[13px]">{session.presentationTitle ?? "The presenter has stopped presenting."}</p>
      </div>
    );
  }

  const slide = session.slide;

  return (
    <div className="min-h-screen bg-[#f7f9fc] flex flex-col">
      <div className="bg-[#062444] px-5 py-3 shrink-0">
        <p className="text-white/50 text-[10.5px] font-bold uppercase tracking-wide truncate">{session.presentationTitle}</p>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        {!slide ? (
          <p className="text-slate-400 text-[13.5px] text-center">Waiting for the presenter to show a question…</p>
        ) : slide.type === "title" ? (
          <div className="text-center max-w-sm">
            <h2 className="text-xl font-bold text-[#062444] mb-2 break-words">{(slide.settings.heading as string) ?? ""}</h2>
            {(slide.settings.subheading as string) && <p className="text-[13.5px] text-slate-500 break-words">{slide.settings.subheading as string}</p>}
          </div>
        ) : slide.type === "word_cloud" ? (
          <WordCloudVote key={slide.id} sessionId={session.sessionId!} settings={slide.settings} votingLocked={!!session.votingLocked} />
        ) : slide.type === "multiple_choice" ? (
          <MultipleChoiceVote key={slide.id} sessionId={session.sessionId!} settings={slide.settings} votingLocked={!!session.votingLocked} />
        ) : (
          <RankingVote key={slide.id} sessionId={session.sessionId!} settings={slide.settings} votingLocked={!!session.votingLocked} />
        )}
      </div>
    </div>
  );
}
