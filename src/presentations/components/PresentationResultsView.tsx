import { useEffect, useState } from "react";
import { ArrowLeft, Download, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import type { PresentationItem } from "../presentationsApi";
import type { PresentationSlide, TitleSlideSettings, WordCloudSettings, MultipleChoiceSettings, RankingSettings } from "../slidesApi";
import type { PresentationResponseRow } from "../presentationSessionApi";
import { fetchSessionsForPresentation, fetchAllResponsesForSession, setResponseHidden, type PresentationSessionSummary } from "../resultsApi";
import { downloadSessionResultsCsv } from "../csvExport";
import { WordCloudResults, MultipleChoiceResults, RankingResults } from "./SlideResults";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Phase 5's "saved results" requirement: reopen a presentation later and
 * browse any past session's results, slide by slide, plus export the
 * whole session to CSV. Reuses the same result-rendering components as
 * the live PresentModeView (src/presentations/components/SlideResults.tsx)
 * so a session's numbers look identical whether viewed live or after the
 * fact, and reuses the same word-cloud moderation (hide/unhide) for
 * after-the-fact cleanup.
 */
export function PresentationResultsView({ presentation, slides, onClose }: { presentation: PresentationItem; slides: PresentationSlide[]; onClose: () => void }) {
  const [sessions, setSessions] = useState<PresentationSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [responsesBySlide, setResponsesBySlide] = useState<Map<string, PresentationResponseRow[]>>(new Map());
  const [slideIndex, setSlideIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  const votableSlides = slides.filter(s => s.type !== "title");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const list = await fetchSessionsForPresentation(presentation.id);
      setSessions(list);
      setSelectedSessionId(list[0]?.id ?? null);
      setLoading(false);
    })();
  }, [presentation.id]);

  useEffect(() => {
    if (!selectedSessionId) { setResponsesBySlide(new Map()); return; }
    void (async () => {
      const all = await fetchAllResponsesForSession(selectedSessionId);
      const map = new Map<string, PresentationResponseRow[]>();
      for (const row of all) {
        const bucket = map.get(row.slideId) ?? [];
        bucket.push(row);
        map.set(row.slideId, bucket);
      }
      setResponsesBySlide(map);
      setSlideIndex(0);
    })();
  }, [selectedSessionId]);

  async function handleToggleHidden(responseId: string, hidden: boolean) {
    setResponsesBySlide(prev => {
      const next = new Map(prev);
      for (const [slideId, rows] of next) {
        if (rows.some(r => r.id === responseId)) {
          next.set(slideId, rows.map(r => r.id === responseId ? { ...r, hidden } : r));
        }
      }
      return next;
    });
    await setResponseHidden(responseId, hidden);
  }

  function handleExport() {
    downloadSessionResultsCsv(presentation.title, slides, responsesBySlide);
  }

  const currentSlide = votableSlides[slideIndex] as PresentationSlide | undefined;
  const currentResponses = currentSlide ? responsesBySlide.get(currentSlide.id) ?? [] : [];

  return (
    <div className="fixed inset-0 z-[100] bg-[#f7f9fc] flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-[#e6ecf5] shrink-0">
        <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:bg-[#f0f3f8]" aria-label="Back to editor">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-[15px] font-bold text-[#062444] flex-1 truncate">{presentation.title} — Results</h1>
        <button
          onClick={handleExport} disabled={sessions.length === 0}
          className="flex items-center gap-1.5 bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2 hover:bg-[#0a3a6b] disabled:opacity-40"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-14">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400 text-[13.5px]">This presentation has never been presented yet.</p>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-[200px] shrink-0 border-r border-[#e6ecf5] bg-white overflow-y-auto p-3 space-y-1.5">
            <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide px-1 mb-1">Sessions</p>
            {sessions.map(s => (
              <button
                key={s.id} onClick={() => setSelectedSessionId(s.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 text-[12px] ${selectedSessionId === s.id ? "bg-[#062444] text-white" : "hover:bg-[#f7f9fc] text-[#062444]"}`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <Calendar size={11} className={selectedSessionId === s.id ? "text-[#F3BC00]" : "text-slate-400"} /> {formatDateTime(s.createdAt)}
                </div>
                <div className={`text-[10.5px] mt-0.5 ${selectedSessionId === s.id ? "text-white/60" : "text-slate-400"}`}>
                  Code {s.joinCode} · {s.status === "active" ? "Active" : "Ended"}
                </div>
              </button>
            ))}
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            {votableSlides.length === 0 ? (
              <div className="flex-1 flex items-center justify-center"><p className="text-slate-400 text-[13.5px]">No votable slides in this presentation.</p></div>
            ) : (
              <>
                <div className="flex-1 flex items-center justify-center p-8 min-h-0">
                  <div className="w-full max-w-2xl bg-white rounded-2xl border border-[#e6ecf5] p-10 max-h-full overflow-y-auto flex flex-col items-center text-center">
                    {currentSlide && (
                      <>
                        <h2 className="text-2xl font-bold text-[#062444] mb-2 break-words">
                          {(currentSlide.settings as WordCloudSettings | MultipleChoiceSettings | RankingSettings).question || "Untitled question"}
                        </h2>
                        <p className="text-[12px] text-slate-400 mb-6">{currentResponses.length} response{currentResponses.length === 1 ? "" : "s"}</p>
                        {currentSlide.type === "word_cloud" ? (
                          <WordCloudResults responses={currentResponses} moderatable onToggleHidden={handleToggleHidden} />
                        ) : currentSlide.type === "multiple_choice" ? (
                          <MultipleChoiceResults responses={currentResponses} settings={currentSlide.settings as MultipleChoiceSettings} />
                        ) : (
                          <RankingResults responses={currentResponses} settings={currentSlide.settings as RankingSettings} />
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 px-5 py-4 shrink-0">
                  <button onClick={() => setSlideIndex(i => Math.max(0, i - 1))} disabled={slideIndex === 0} className="p-2 rounded-lg border border-[#e6ecf5] text-slate-500 disabled:opacity-30" aria-label="Previous slide">
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-slate-500 text-[12.5px] font-semibold px-2">{slideIndex + 1} / {votableSlides.length}</span>
                  <button onClick={() => setSlideIndex(i => Math.min(votableSlides.length - 1, i + 1))} disabled={slideIndex >= votableSlides.length - 1} className="p-2 rounded-lg border border-[#e6ecf5] text-slate-500 disabled:opacity-30" aria-label="Next slide">
                    <ChevronRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
