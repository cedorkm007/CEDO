import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useRealtimeRefresh } from "@/app/useRealtimeRefresh";
import { SurveyStatusBadge } from "../components/SurveyStatusBadge";
import { fetchSurveyResults, groupQuestions, type SurveyResults } from "./resultsApi";
import { CountColumns, StatTile } from "./resultCharts";
import { QuestionResultCard } from "./QuestionResultCard";

// Realtime does the live updating; this slower poll is only a safety net (a dropped
// connection must not leave a chart silently stale).
const FALLBACK_POLL_MS = 30000;
const REALTIME_THROTTLE_MS = 3000;

function formatWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

/**
 * Charts for one survey's responses -- one card per question, a summary, and
 * responses per day. Used in two places that share this exact component:
 *   - My Surveys > View Responses (anyone with access to the survey)
 *   - the Research Project Monitoring tool > Survey Results, where each of
 *     the person's surveys appears as its own dataset
 * Access is decided by the server (the owner and people it is shared with);
 * this component only shows what get_my_survey_results returns.
 *
 * Updates itself: Postgres changes on the survey's responses trigger a refetch
 * (throttled), with a slow poll as a safety net.
 */
export function SurveyResultsPanel({ surveyId, showTitle = false }: { surveyId: string; showTitle?: boolean }) {
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const res = await fetchSurveyResults(surveyId);
    if (res.ok) {
      hasData.current = true;
      setResults(res.results);
      setError("");
      setUpdatedAt(new Date());
    } else if (!hasData.current) {
      setError(res.error); // keep showing the last good data if a later refresh fails
    }
    setLoading(false);
    setRefreshing(false);
  }, [surveyId]);

  useEffect(() => {
    hasData.current = false;
    setResults(null); setError(""); setLoading(true);
    void load();
  }, [load]);

  useRealtimeRefresh("my_survey_responses", () => void load(), true, { filter: `survey_id=eq.${surveyId}`, throttleMs: REALTIME_THROTTLE_MS });
  useEffect(() => {
    const id = window.setInterval(() => void load(), FALLBACK_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const groups = useMemo(() => groupQuestions(results?.questions ?? []), [results]);

  if (loading) return <div className="rounded-2xl border border-[#e6ecf5] bg-white p-6 text-center text-[13px] text-slate-400"><Loader2 size={16} className="mx-auto mb-2 animate-spin" />Loading results…</div>;
  if (error || !results) return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-[13px] text-red-700">{error || "Couldn't load the results."}</div>;

  const { survey } = results;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#e6ecf5] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {showTitle && <h2 className="truncate text-[15px] font-bold text-[#062444]">{survey.title}</h2>}
            <SurveyStatusBadge status={survey.status} />
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
            <span className="flex items-center gap-1.5" role="status" aria-live="polite">
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
              Live{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString()}` : ""}
            </span>
            <button onClick={() => void load()} disabled={refreshing} aria-label="Refresh results" className="rounded-md p-1.5 text-slate-400 hover:bg-[#f0f3f8] disabled:opacity-50">
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Responses" value={String(survey.responseCount)} />
          <StatTile label="First response" value={formatWhen(survey.firstResponseAt)} />
          <StatTile label="Latest response" value={formatWhen(survey.lastResponseAt)} />
        </div>
      </div>

      {survey.responseCount === 0 ? (
        <div className="rounded-2xl bg-[#f7f9fc] py-12 text-center text-slate-400">
          <p className="text-[13.5px] font-medium">No responses yet.</p>
          <p className="text-[12.5px]">Charts appear here automatically as people answer.</p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl border border-[#e6ecf5] bg-white p-4" aria-label="Responses per day">
            <h3 className="mb-2 text-[13px] font-bold text-[#062444]">Responses per day</h3>
            <CountColumns
              label="Responses"
              items={results.timeline.map(t => ({
                label: new Date(`${t.day}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                count: t.count,
              }))}
              height={180}
            />
            <p className="mt-1 text-[10.5px] text-slate-400">Days are in your time zone ({results.timezone}).</p>
          </section>

          {groups.map((g, i) => <QuestionResultCard key={g.key} group={g} number={i + 1} />)}
        </>
      )}
    </div>
  );
}
