import { useEffect, useState } from "react";
import { ListChecks, SlidersHorizontal, MessageSquareText, Clock, CheckCircle2, XCircle } from "lucide-react";
import { fetchSurveys, fetchSurveyQuestions, fetchSurveyQuestionResults, fetchSurveyGatingRoster } from "../../seadApi";
import { SurveyResultsChart } from "../../components/SurveyResultsChart";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";
import { fetchSurveyList, type SurveyListItem } from "@/mysurveys/mySurveysApi";
import { SurveyResultsPanel } from "@/mysurveys/results/SurveyResultsPanel";
import { fetchSurveyOutline } from "../../surveyEditorApi";
import { groupBySection, type OutlineQuestion, type OutlineSection } from "@/lib/surveyBuilder";
import { activityCounts, filterRoster, triggerLabel, RECONSIDERATION, TRIGGER_LABELS } from "@/lib/surveyResults";
import type { Survey, SurveySource, SurveyQuestion, SurveyChoiceResult, SurveyLikertResult, SurveyOpenEndedResult, GatingRosterEntry, GatingRosterStatus } from "../../types";

export function SurveyResultsSubtab() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingSurveys, setLoadingSurveys] = useState(true);
  const [selectedSurveyId, setSelectedSurveyId] = useState("");
  // Surveys built in "My Surveys" appear here as their own datasets. The server only
  // returns the ones the person owns or that were shared with them (the same rule as
  // My Surveys itself), so this list is never wider than what they could already open.
  const [mySurveys, setMySurveys] = useState<SurveyListItem[]>([]);

  useEffect(() => {
    (async () => {
      setLoadingSurveys(true);
      const [legacy, mine, shared] = await Promise.all([fetchSurveys(), fetchSurveyList("mine"), fetchSurveyList("shared")]);
      setSurveys(legacy);
      setMySurveys([...(mine.ok ? mine.surveys : []), ...(shared.ok ? shared.surveys : [])].filter(s => s.status !== "draft"));
      setLoadingSurveys(false);
    })();
  }, []);

  const mySurveyId = selectedSurveyId.startsWith("my:") ? selectedSurveyId.slice(3) : "";
  const selectedSurvey = surveys.find(s => s.id === selectedSurveyId) ?? null;
  const selectedMySurvey = mySurveys.find(s => s.id === mySurveyId) ?? null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Survey</label>
        <select value={selectedSurveyId} onChange={e => setSelectedSurveyId(e.target.value)} disabled={loadingSurveys}
          className="w-full max-w-md border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white">
          <option value="">{loadingSurveys ? "Loading surveys…" : "Select a survey…"}</option>
          {mySurveys.length > 0 ? (
            <>
              <optgroup label="Activity surveys">
                {surveys.map(s => (
                  <option key={s.id} value={s.id}>{s.title} — {s.activityName}</option>
                ))}
              </optgroup>
              <optgroup label="My Surveys (yours or shared with you)">
                {mySurveys.map(s => (
                  <option key={s.id} value={`my:${s.id}`}>{s.title} — {s.myRole === "owner" ? "yours" : `shared by ${s.ownerName}`} ({s.responseCount} response{s.responseCount === 1 ? "" : "s"})</option>
                ))}
              </optgroup>
            </>
          ) : (
            surveys.map(s => (
              <option key={s.id} value={s.id}>{s.title} — {s.activityName}</option>
            ))
          )}
        </select>
      </div>

      {selectedSurvey && <SurveyResultsView survey={selectedSurvey} />}
      {selectedMySurvey && (
        <div className="space-y-3">
          <p className="text-[12px] text-slate-500">
            From <span className="font-semibold text-[#062444]">My Surveys</span> — charts update as responses come in. Only the survey's owner and the people it is shared with can see them.
          </p>
          <SurveyResultsPanel surveyId={selectedMySurvey.id} />
        </div>
      )}
    </div>
  );
}

type ResultQuestion = SurveyQuestion & Partial<Pick<OutlineQuestion, "sectionId" | "removed" | "removedReason" | "version" | "isOptional">>;

function SurveyResultsView({ survey }: { survey: Survey }) {
  const [questions, setQuestions] = useState<ResultQuestion[]>([]);
  const [sections, setSections] = useState<OutlineSection[]>([]);
  const [loading, setLoading] = useState(true);

  // A quest-sourced survey isn't attendance-gated at all — a scholar just
  // takes the Quest freely — so the gating roster concept doesn't apply.
  const isQuestSourced = survey.activityType === "quest";
  // "" = all activities combined
  const [activityId, setActivityId] = useState("");
  const [trigger, setTrigger] = useState("");
  // all reconsideration requests are one line: their answers are picked by how they were asked
  const resultsActivity = activityId && activityId !== RECONSIDERATION ? activityId : null;
  const resultsTrigger = activityId === RECONSIDERATION ? RECONSIDERATION : trigger || null;
  const [roster, setRoster] = useState<GatingRosterEntry[] | null>(null);
  useEffect(() => {
    setActivityId("");
    setTrigger("");
    setRoster(null);
    if (isQuestSourced) return;
    let cancelled = false;
    void fetchSurveyGatingRoster(survey.id).then(r => { if (!cancelled) setRoster(r); });
    return () => { cancelled = true; };
  }, [survey.id, isQuestSourced]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // with sections and removed questions; before the database update, the plain list as before
      const outline = isQuestSourced ? null : await fetchSurveyOutline(survey.id, true);
      if (outline && outline.ok) {
        setSections(outline.outline.sections);
        setQuestions(outline.outline.questions as ResultQuestion[]);
      } else {
        setSections([]);
        setQuestions(await fetchSurveyQuestions(survey));
      }
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [survey.id]);

  let lastTopicName: string | null = null;
  const groups = groupBySection(sections, questions.map(q => ({ ...q, sectionId: q.sectionId ?? null })));

  return (
    <div className="space-y-4">
      {!isQuestSourced && (
        <>
          <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
            <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5" htmlFor="survey-trigger">How it was asked</label>
            <select id="survey-trigger" value={trigger} onChange={e => setTrigger(e.target.value)} className="w-full max-w-md border border-[#062444]/15 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-[#0088cc]">
              <option value="">Any way</option>
              {Object.entries(TRIGGER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <ActivityFilter survey={survey} roster={filterRoster(roster ?? [], "", trigger)} value={activityId} onChange={setActivityId} />
          <GatingRosterSection key={`${survey.id}:${activityId}:${trigger}`} roster={roster === null ? null : filterRoster(roster, activityId, trigger)} showActivity={activityId === RECONSIDERATION || (!activityId && (survey.activities.length > 1 || survey.triggers?.reconsideration === true))} />
        </>
      )}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading questions…</div>
      ) : questions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">This survey has no questions yet.</div>
      ) : (
        groups.filter(g => g.questions.length > 0).map(g => (
          <div key={g.section?.id ?? "none"} className="space-y-4">
            {sections.length > 0 && (
              <div className="pt-1">
                <h2 className="text-[13.5px] font-bold text-[#062444]">{g.section ? `${g.section.title}${g.section.removed ? " (section removed)" : ""}` : "Not in a section"}</h2>
                {g.section?.description && <p className="text-[12px] text-slate-500">{g.section.description}</p>}
              </div>
            )}
            {g.questions.map(q => {
              const showTopicHeading = isQuestSourced && q.topicName !== lastTopicName;
              lastTopicName = q.topicName ?? lastTopicName;
              return (
                <div key={q.id}>
                  {showTopicHeading && (
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-5 mb-1.5 first:mt-0">{q.topicName}</p>
                  )}
                  {(q.removed || (q.version ?? 1) > 1) && (
                    <p className="mb-1 text-[11.5px] font-semibold text-amber-800">
                      {q.removed ? (q.removedReason === "changed" ? `Earlier version (version ${q.version}) — the question was changed` : "Removed from the survey — its answers are kept") : `Version ${q.version} — answers to earlier versions are listed separately`}
                    </p>
                  )}
                  <QuestionResultCard key={`${q.id}:${activityId}:${trigger}`} question={q} source={survey.activityType} activityId={resultsActivity} trigger={resultsTrigger} />
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

/** Choose one activity, or all combined; with the number of scholars completed / pending / declined / released in each. */
function ActivityFilter({ survey, roster, value, onChange }: { survey: Survey; roster: GatingRosterEntry[]; value: string; onChange: (id: string) => void }) {
  const rows = activityCounts(survey.activities, roster);
  if (rows.length < 2) return null;
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500 mb-2">By activity</p>
      <div className="max-h-64 overflow-auto rounded-lg border border-[#e6ecf5]">
        <table className="w-full min-w-[420px] text-[12.5px]">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Activity</th><th className="px-3 py-2 text-right">Completed</th><th className="px-3 py-2 text-right">Pending</th><th className="px-3 py-2 text-right">Declined</th><th className="px-3 py-2 text-right">Released</th>
            </tr>
          </thead>
          <tbody>
            {[{ id: "", name: "All activities combined", detached: false, completed: roster.filter(r => r.status === "completed").length, in_progress: roster.filter(r => r.status === "in_progress").length, declined: roster.filter(r => r.status === "declined").length, released: roster.filter(r => r.status === "released").length }, ...rows].map(a => (
              <tr key={a.id || "all"} className={`border-t border-[#f0f3f8] ${value === a.id ? "bg-[#eef3fb]" : ""}`}>
                <td className="px-3 py-1.5">
                  <button type="button" onClick={() => onChange(a.id)} aria-pressed={value === a.id} className="text-left font-semibold text-[#062444] hover:underline">{a.name}</button>
                  {a.detached && <span className="ml-1.5 text-[11px] text-slate-500">(detached)</span>}
                </td>
                <td className="px-3 py-1.5 text-right">{a.completed}</td><td className="px-3 py-1.5 text-right">{a.in_progress}</td><td className="px-3 py-1.5 text-right">{a.declined}</td><td className="px-3 py-1.5 text-right">{a.released}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-slate-500">Choose an activity to see only its list and answers. "Released" = given their credit without answering (the survey was turned off or the activity detached).</p>
    </div>
  );
}

const STATUS_META: Record<GatingRosterStatus, { label: string; badgeClass: string; icon: React.ReactNode }> = {
  in_progress: { label: "Pending Survey", badgeClass: "text-amber-700 bg-amber-100", icon: <Clock size={11} /> },
  completed: { label: "Completed", badgeClass: "text-green-700 bg-green-100", icon: <CheckCircle2 size={11} /> },
  declined: { label: "Declined", badgeClass: "text-slate-500 bg-slate-100", icon: <XCircle size={11} /> },
  released: { label: "Released", badgeClass: "text-blue-700 bg-blue-100", icon: <CheckCircle2 size={11} /> },
};

/**
 * Every scholar whose time-out/voucher scan was ever gated by this survey,
 * with their current status — lets staff see who hasn't finished (or
 * hasn't even opened) the survey yet, separately from the per-question
 * answer breakdowns below. Empty for a survey nothing has gated yet
 * (never attached to an activity with a live scan, or no scans so far).
 */
function GatingRosterSection({ roster: loaded, showActivity }: { roster: GatingRosterEntry[] | null; showActivity: boolean }) {
  const roster = loaded ?? [];
  const loading = loaded === null;
  const [statusFilter, setStatusFilter] = useState<GatingRosterStatus | null>(null);

  const counts = {
    in_progress: roster.filter(r => r.status === "in_progress").length,
    completed: roster.filter(r => r.status === "completed").length,
    declined: roster.filter(r => r.status === "declined").length,
    released: roster.filter(r => r.status === "released").length,
  };

  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } = usePaginatedList(roster, {
    searchKeys: ["scholarIdNumber", "scholarName"],
    filterFn: statusFilter ? r => r.status === statusFilter : undefined,
  });

  if (loading) return <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading who was asked…</div>;
  if (roster.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-1">Who was asked</p>
        <p className="text-[13px] text-slate-400">No scholar to show for this choice yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400 mb-3">Who was asked</p>
      <div className="grid grid-cols-2 gap-3 mb-4 sm:grid-cols-4">
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
              {showActivity && <th className="px-3 py-2">Activity</th>}
              <th className="px-3 py-2">Asked by</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredCount === 0 ? (
              <tr><td colSpan={showActivity ? 5 : 4} className="px-3 py-6 text-center text-slate-400">No scholars match.</td></tr>
            ) : (
              paged.map(r => (
                <tr key={`${r.scholarIdNumber}:${r.activityId ?? ""}`} className="border-t border-[#f0f3f8]">
                  <td className="px-3 py-2 text-[#062444] font-medium">{r.scholarIdNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{r.scholarName}</td>
                  {showActivity && <td className="px-3 py-2 text-slate-600">{r.activityName}</td>}
                  <td className="px-3 py-2 text-slate-600">{triggerLabel(r.trigger)}</td>
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

function QuestionResultCard({ question, source, activityId, trigger }: { question: SurveyQuestion; source: SurveySource; activityId: string | null; trigger: string | null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choiceResults, setChoiceResults] = useState<SurveyChoiceResult[] | null>(null);
  const [likertResult, setLikertResult] = useState<SurveyLikertResult | null>(null);
  const [openEndedResult, setOpenEndedResult] = useState<SurveyOpenEndedResult | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      const result = await fetchSurveyQuestionResults(question.id, question.questionType, source, activityId, trigger);
      if (!result.ok) {
        setError(result.error || "Failed to load results.");
      } else {
        setChoiceResults(result.choiceResults ?? null);
        setLikertResult(result.likertResult ?? null);
        setOpenEndedResult(result.openEndedResult ?? null);
      }
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [question.id, source, activityId, trigger]);

  const n = question.questionType === "multiple_choice"
    ? (choiceResults ?? []).reduce((sum, c) => sum + c.count, 0)
    : question.questionType === "open_ended"
    ? (openEndedResult?.texts ?? []).length
    : likertResult?.n ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-[14.5px] font-semibold text-[#062444] leading-relaxed">{question.questionText}</p>
        <span className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2.5 py-1">
          {question.questionType === "likert" ? <><SlidersHorizontal size={11} /> Likert</>
            : question.questionType === "open_ended" ? <><MessageSquareText size={11} /> Open-Ended</>
            : <><ListChecks size={11} /> Multiple Choice</>}
        </span>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading results…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : n === 0 ? (
        <p className="text-[13px] text-slate-400">No responses yet.</p>
      ) : question.questionType === "open_ended" ? (
        <ul className="space-y-1.5">
          {(openEndedResult?.texts ?? []).map((t, i) => (
            <li key={i} className="text-[13px] text-[#062444] bg-white border border-[#e6ecf5] rounded-lg px-3 py-1.5">{t}</li>
          ))}
        </ul>
      ) : question.questionType === "multiple_choice" ? (
        <div className="space-y-3">
          <SurveyResultsChart bars={(choiceResults ?? []).map(c => ({ label: c.isOther ? `${c.choiceText} (write-in)` : c.removed ? `${c.choiceText} (${c.removedReason === "changed" ? "earlier wording" : "removed"})` : c.choiceText, count: c.count }))} />
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
