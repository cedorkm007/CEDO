import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { X, ChevronLeft, ChevronRight, Eye, EyeOff, Lock, Unlock, RotateCcw } from "lucide-react";
import { useRealtimeRefresh } from "@/app/useRealtimeRefresh";
import type { PresentationItem } from "../presentationsApi";
import type { PresentationSlide, TitleSlideSettings, WordCloudSettings, MultipleChoiceSettings, RankingSettings } from "../slidesApi";
import {
  startPresentationSession, endPresentationSession, setPresentationSessionSlide, setPresentationSessionState,
  resetSlideResponses, fetchPresentationSession, fetchSlideResponses, type PresentationSession, type PresentationResponseRow,
} from "../presentationSessionApi";
import { setResponseHidden } from "../resultsApi";
import { WordCloudResults, MultipleChoiceResults, RankingResults } from "./SlideResults";

function joinUrl(code: string): string {
  return `${window.location.origin}/join?code=${code}`;
}

function JoinQrCode({ joinCode }: { joinCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) void QRCode.toCanvas(canvasRef.current, joinUrl(joinCode), { width: 160, margin: 1, color: { dark: "#062444", light: "#ffffff" } });
  }, [joinCode]);
  return <canvas ref={canvasRef} className="rounded-lg" />;
}

export function PresentModeView({ presentation, slides, onClose }: { presentation: PresentationItem; slides: PresentationSlide[]; onClose: () => void }) {
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [responses, setResponses] = useState<PresentationResponseRow[]>([]);

  useEffect(() => {
    void (async () => {
      const started = await startPresentationSession(presentation.id);
      if (!started.ok) return;
      const full = await fetchPresentationSession(started.sessionId);
      if (!full) return;
      setSession(full);
      const idx = slides.findIndex(s => s.id === full.currentSlideId);
      setSlideIndex(idx >= 0 ? idx : 0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation.id]);

  const currentSlide = slides[slideIndex] as PresentationSlide | undefined;

  async function loadResponses() {
    if (!session || !currentSlide) return;
    setResponses(await fetchSlideResponses(session.id, currentSlide.id));
  }

  useEffect(() => { void loadResponses(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session?.id, currentSlide?.id]);
  // Scoped to this session only (not every concurrent presenter's), and
  // throttled -- an audience of up to ~1000 people voting on a word cloud
  // can submit in a tight burst right after the slide appears, and without
  // this a refetch-and-relayout per individual submission would lock up
  // this presenter's own tab instead of just showing the cloud update live.
  useRealtimeRefresh("presentation_responses", () => void loadResponses(), !!session, {
    filter: session ? `session_id=eq.${session.id}` : undefined,
    throttleMs: 600,
  });

  async function goToSlide(index: number) {
    if (!session || index < 0 || index >= slides.length) return;
    setSlideIndex(index);
    await setPresentationSessionSlide(session.id, slides[index].id);
  }

  async function toggleShowResults() {
    if (!session) return;
    const next = !session.showResults;
    setSession({ ...session, showResults: next });
    await setPresentationSessionState(session.id, { showResults: next });
  }

  async function toggleVotingLocked() {
    if (!session) return;
    const next = !session.votingLocked;
    setSession({ ...session, votingLocked: next });
    await setPresentationSessionState(session.id, { votingLocked: next });
  }

  async function handleResetVotes() {
    if (!session || !currentSlide) return;
    await resetSlideResponses(session.id, currentSlide.id);
    await loadResponses();
  }

  async function handleEndSession() {
    if (session) await endPresentationSession(session.id);
    onClose();
  }

  async function handleToggleHidden(responseId: string, hidden: boolean) {
    setResponses(rs => rs.map(r => r.id === responseId ? { ...r, hidden } : r));
    await setResponseHidden(responseId, hidden);
  }

  if (!session) {
    return (
      <div className="fixed inset-0 z-[200] bg-[#062444] flex items-center justify-center">
        <p className="text-white/60 text-[13px]">Starting session…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#062444] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-lg p-1.5"><JoinQrCode joinCode={session.joinCode} /></div>
          <div>
            <p className="text-[#F3BC00] text-[11px] font-bold uppercase tracking-wide">Join at {window.location.host}/join</p>
            <p className="text-white text-2xl font-bold tracking-[0.2em]">{session.joinCode}</p>
          </div>
        </div>
        <button onClick={handleEndSession} className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2">
          <X size={15} /> End Session
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-8 min-h-0">
        {!currentSlide ? (
          <p className="text-white/50">No slides in this presentation.</p>
        ) : (
          <div className="w-full max-w-3xl bg-white rounded-2xl p-10 max-h-full overflow-y-auto flex flex-col items-center text-center">
            {currentSlide.type === "title" ? (
              <>
                <h2 className="text-3xl font-bold text-[#062444] mb-3 break-words">{(currentSlide.settings as TitleSlideSettings).heading}</h2>
                {(currentSlide.settings as TitleSlideSettings).subheading && <p className="text-[15px] text-slate-500">{(currentSlide.settings as TitleSlideSettings).subheading}</p>}
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-[#062444] mb-2 break-words">
                  {(currentSlide.settings as WordCloudSettings | MultipleChoiceSettings | RankingSettings).question || "Untitled question"}
                </h2>
                <p className="text-[12px] text-slate-400 mb-6">{responses.length} response{responses.length === 1 ? "" : "s"}</p>
                {session.showResults && (
                  currentSlide.type === "word_cloud" ? <WordCloudResults responses={responses} moderatable onToggleHidden={handleToggleHidden} />
                  : currentSlide.type === "multiple_choice" ? <MultipleChoiceResults responses={responses} settings={currentSlide.settings as MultipleChoiceSettings} />
                  : <RankingResults responses={responses} settings={currentSlide.settings as RankingSettings} />
                )}
                {!session.showResults && <p className="text-slate-300 text-[13px]">Results are hidden</p>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-2 px-5 py-4 shrink-0 flex-wrap">
        <button onClick={() => void goToSlide(slideIndex - 1)} disabled={slideIndex === 0} className="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-30" aria-label="Previous slide">
          <ChevronLeft size={18} />
        </button>
        <span className="text-white/60 text-[12.5px] font-semibold px-2">{slideIndex + 1} / {slides.length}</span>
        <button onClick={() => void goToSlide(slideIndex + 1)} disabled={slideIndex >= slides.length - 1} className="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white disabled:opacity-30" aria-label="Next slide">
          <ChevronRight size={18} />
        </button>
        <div className="w-px h-6 bg-white/20 mx-1" />
        <button onClick={toggleShowResults} className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12px] font-semibold px-3 py-2.5">
          {session.showResults ? <EyeOff size={15} /> : <Eye size={15} />} {session.showResults ? "Hide Results" : "Show Results"}
        </button>
        <button onClick={toggleVotingLocked} className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12px] font-semibold px-3 py-2.5">
          {session.votingLocked ? <Unlock size={15} /> : <Lock size={15} />} {session.votingLocked ? "Unlock Voting" : "Lock Voting"}
        </button>
        <button onClick={() => void handleResetVotes()} className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12px] font-semibold px-3 py-2.5">
          <RotateCcw size={15} /> Reset Votes
        </button>
      </div>
    </div>
  );
}
