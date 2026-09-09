import { useEffect, useState } from "react";
import { ListChecks, SlidersHorizontal, Clock, CheckCircle2, XCircle } from "lucide-react";
import { fetchSurveys, fetchSurveyQuestions, fetchSurveyQuestionResults, fetchSurveyGatingRoster } from "../../seadApi";
import { SurveyResultsChart } from "../../components/SurveyResultsChart";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";
import type { Survey, SurveySource, SurveyQuestion, SurveyChoiceResult, SurveyLikertResult, GatingRosterEntry, GatingRosterStatus } from "../../types";

export function SurveyResultsSubtab() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState(true);
  const [selectedSurveyId, setSelectedSurveyId] = useState("");

  useEffect(() => {
    (async () => {
      setLoadingSurveys(true);
      setSurveys(await fetchSurveys());
      setLoadingSurveys(false);
    })();
  }, []);

  const selectedSurvey = surveys.find(s => s.id === selectedSurveyId) ?? null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Survey</label>
        <select value={selectedSurveyId} onChange={e => setSelectedSurveyId(e.target.value)} disabled={loadingSurveys}
          className="w-full max-w-md border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
          <option value="">{loadingSurveys ? "Loading surveys…" : "Select a survey…"}</option>
          {surveys.map(s => (
            <option key={s.id} value={s.id}>{s.title} — {s.activityName}</option>
          ))}
        </select>
      </div>

      {selectedSurvey && <SurveyResultsView survey={selectedSurvey} />}
    </div>
  );
}

function SurveyResultsView({ survey }: { survey: Survey }) {
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setQuestions(await fetchSurveyQuestions(survey));
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [survey.id]);

  // A quest-sourced survey isn't attendance-gated at all — a scholar just
  // takes the Quest freely — so the gating roster concept doesn't apply.
  const isQuestSourced = survey.activityType === "quest";
  let lastTopicName: string | null = null;

  return (
    <div className="space-y-4">
      {!isQuestSourced && <GatingRosterSection surveyId={survey.id} />}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading questions…</div>
      ) : questions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">This survey has no questions yet.</div>
      ) : (
        questions.map(q => {
          const showTopicHeading = isQuestSourced && q.topicName !== lastTopicName;
          lastTopicName = q.topicName ?? lastTopicName;
          return (
            <div key={q.id}>
              {showTopicHeading && (
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-5 mb-1.5 first:mt-0">{q.topicName}</p>
              )}
              <QuestionResultCard question={q} source={survey.activityType} />
            </div>
          );
        })
      )}
    </div>
  );
}

const STATUS_META: Record<GatingRosterStatus, { label: string; badgeClass: string; icon: React.ReactNode }> = {
  in_progress: { label: "Pending Survey", badgeClass: "text-amber-700 bg-amber-100", icon: <Clock size={11} /> },
  completed: { label: "Completed", badgeClass: "text-green-700 bg-green-100", icon: <CheckCircle2 size={11} /> },
  declined: { label: "Declined", badgeClass: "text-slate-500 bg-slate-100", icon: <XCircle size={11} /> },
};

/**
 * Every scholar whose time-out/voucher scan was ever gated by this survey,
 * with their current status — lets staff see who hasn't finished (or
 * hasn't even opened) the survey yet, separately from the per-question
 * answer breakdowns below. Empty for a survey nothing has gated yet
 * (never attached to an activity with a live scan, or no scans so far).
 */
function GatingRosterSection({ surveyId }: { surveyId: string }) {
  const [roster, setRoster] = useState<GatingRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<GatingRosterStatus | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setStatusFilter(null);
      setRoster(await fetchSurveyGatingRoster(surveyId));
      setLoading(false);
    })();
  }, [surveyId]);

  const counts = {
    in_progress: roster.filter(r => r.status === "in_progress").length,
    completed: roster.filter(r => r.status === "completed").length,
    declined: roster.filter(r => r.status === "declined").length,
  };

  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } = usePaginatedList(roster, {
    searchKeys: ["scholarIdNumber", "scholarName"],
    filterFn: statusFilter ? r => r.status === statusFilter : undefined,
  });

  if (loading) return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading gating status…</div>;
  if (roster.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-1">Attendance Gating Status</p>
        <p className="text-[13px] text-slate-400">No scholar has had a scan gated by this survey yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-3">Attendance Gating Status</p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {(Object.keys(STATUS_META) as GatingRosterStatus[]).map(s => (
          <button key={s} onClick={() => setStatusFilter(prev => prev === s ? null : s)}
            className={`rounded-xl p-3 text-center border transition ${statusFilter === s ? "border-[#062444] bg-[#eef3fb]" : "border-[#e6ecf5] hover:bg-[#f8fafd]"}`}>
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">{STATUS_META[s].label}</p>
            <p className="text-lg font-extrabold text-[#062444]">{counts[s]}</p>
          </button>
        ))}
      </div>

      <ListSearchBox value={search} onChange={setSearch} placeholder="Search by scholar ID or name…" />

      <div className="mt-3 border border-[#e6ecf5] rounded-lg overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-slate-400 text-[11px] font-bold uppercase tracking-wide">
              <th className="px-3 py-2">Scholar ID</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredCount === 0 ? (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">No scholars match.</td></tr>
            ) : (
              paged.map(r => (
                <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8]">
                  <td className="px-3 py-2 text-[#062444] font-medium">{r.scholarIdNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{r.scholarName}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${STATUS_META[r.status].badgeClass}`}>
                      {STATUS_META[r.status].icon} {STATUS_META[r.status].label}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filteredCount > 0 && (
        <div className="mt-1">
          <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={filteredCount} pageSize={pageSize} />
        </div>
      )}
    </div>
  );
}

function QuestionResultCard({ question, source }: { question: SurveyQuestion; source: SurveySource }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choiceResults, setChoiceResults] = useState<SurveyChoiceResult[] | null>(null);
  const [likertResult, setLikertResult] = useState<SurveyLikertResult | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      const result = await fetchSurveyQuestionResults(question.id, question.questionType, source);
      if (!result.ok) {
        setError(result.error || "Failed to load results.");
      } else {
        setChoiceResults(result.choiceResults ?? null);
        setLikertResult(result.likertResult ?? null);
      }
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [question.id, source]);

  const n = question.questionType === "multiple_choice"
    ? (choiceResults ?? []).reduce((sum, c) => sum + c.count, 0)
    : likertResult?.n ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[14.5px] font-semibold text-[#062444] leading-relaxed">{question.questionText}</p>
        <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2.5 py-1">
          {question.questionType === "likert" ? <><SlidersHorizontal size={11} /> Likert</> : <><ListChecks size={11} /> Multiple Choice</>}
        </span>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading results…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : n === 0 ? (
        <p className="text-[13px] text-slate-400">No responses yet.</p>
      ) : question.questionType === "multiple_choice" ? (
        <div className="space-y-3">
          <SurveyResultsChart bars={(choiceResults ?? []).map(c => ({ label: c.isOther ? `${c.choiceText} (write-in)` : c.choiceText, count: c.count }))} />
          {(choiceResults ?? []).filter(c => c.isOther && c.otherTexts && c.otherTexts.length > 0).map(c => (
            <div key={c.choiceId} className="bg-[#f8fafd] rounded-xl p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">"{c.choiceText}" write-in answers</p>
              <ul className="space-y-1.5">
                {c.otherTexts!.map((t, i) => (
                  <li key={i} className="text-[13px] text-[#062444] bg-white border border-[#e6ecf5] rounded-lg px-3 py-1.5">{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : likertResult ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <StatTile label="n" value={String(likertResult.n)} />
            <StatTile label="Mean" value={likertResult.mean !== null ? likertResult.mean.toFixed(2) : "—"} />
            <StatTile label="Median" value={likertResult.median !== null ? likertResult.median.toFixed(2) : "—"} />
            <StatTile label="Std Dev" value={likertResult.stddev !== null ? likertResult.stddev.toFixed(2) : "—"} />
          </div>
          <p className="text-[11px] text-slate-400">
            Scale {question.likertScaleMin}–{question.likertScaleMax}: "{question.likertMinLabel}" to "{question.likertMaxLabel}"
          </p>
          <SurveyResultsChart bars={likertResult.distribution.map(d => ({ label: `${d.value} (${d.percentage}%)`, count: d.count }))} />
        </div>
      ) : null}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f8fafd] rounded-xl p-3 text-center">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <p className="text-lg font-extrabold text-[#062444]">{value}</p>
    </div>
  );
}
