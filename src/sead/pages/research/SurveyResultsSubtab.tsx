import { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, SlidersHorizontal, MessageSquareText, Clock, CheckCircle2, XCircle, Trash2, Eye, EyeOff } from "lucide-react";
import { createLivePoller, createTickGate, LIVE_INTERVAL_MS, LIVE_MIN_RELOAD_GAP_MS } from "@/lib/liveUpdates";
import { useTabActive } from "@/lib/keepAlive";
import { fetchSurveys, fetchSurveyQuestions, fetchSurveyQuestionResults, fetchSurveyGatingRoster } from "../../seadApi";
import { SurveyResultsChart } from "../../components/SurveyResultsChart";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";
import { fetchSurveyList, type SurveyListItem } from "@/mysurveys/mySurveysApi";
import { SurveyResultsPanel } from "@/mysurveys/results/SurveyResultsPanel";
import { fetchSurveyOutline } from "../../surveyEditorApi";
import { DeleteResponseDialog } from "../../components/survey/DeleteResponseDialog";
import { DeletedResponses } from "../../components/survey/DeletedResponses";
import { groupBySection, type OutlineQuestion, type OutlineSection } from "@/lib/surveyBuilder";
import { activityCounts, filterRoster, triggerLabel, rosterSignature, readHiddenSections, writeHiddenSections, RECONSIDERATION, TRIGGER_LABELS } from "@/lib/surveyResults";
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

      {selectedSurvey && <SurveyResultsView key={selectedSurvey.id} survey={selectedSurvey} />}
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

  // ── Live results ──
  // While this screen is being looked at, the list is asked for every ~10 seconds. When it changed, the charts are read
  // again where they are (at most every 15 seconds while answers keep coming), without clearing the screen.
  const tabActive = useTabActive();
  const [version, setVersion] = useState(0);        // goes up when something changed: charts, questions and deleted list are read again
  const [nudge, setNudge] = useState(0);            // goes up after a delete or a restore: ask for the list right away
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);
  const signature = useRef<string | null>(null);
  const gate = useRef<ReturnType<typeof createTickGate> | null>(null);
  if (!gate.current) gate.current = createTickGate({ gapMs: LIVE_MIN_RELOAD_GAP_MS.staff, fire: () => setVersion(v => v + 1) });
  useEffect(() => () => gate.current?.cancel(), []);
  const reload = () => { setVersion(v => v + 1); setNudge(n => n + 1); };

  useEffect(() => {
    if (!tabActive) return;
    let stopped = false;
    const poller = createLivePoller({
      // a Question Bank survey has no list to watch, so its charts are simply read again every 30 seconds
      baseMs: isQuestSourced ? 30_000 : LIVE_INTERVAL_MS.staff,
      initialStamp: signature.current,
      isHidden: () => document.hidden,
      onChange: () => gate.current!.trigger(),
      fetchStamp: async () => {
        if (isQuestSourced) { setCheckedAt(new Date()); return { ok: true, stamp: String(Date.now()) }; }
        const rows = await fetchSurveyGatingRoster(survey.id);
        if (stopped) return { ok: false, fatal: false };
        if (!rows) { setOffline(true); setRoster(r => r ?? []); return { ok: false, fatal: false }; }
        const stamp = rosterSignature(rows);
        const changed = stamp !== signature.current;
        setRoster(r => (changed || r === null ? rows : r));
        signature.current = stamp;
        setOffline(false);
        setCheckedAt(new Date());
        return { ok: true, stamp };
      },
    });
    const wake = () => { if (!document.hidden) poller.pollNow(); };
    poller.start();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => { stopped = true; poller.stop(); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); window.removeEventListener("online", wake); };
  }, [survey.id, isQuestSourced, tabActive, nudge]);

  const loadedOnce = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (loadedOnce.current && isQuestSourced) return;
      // with sections and removed questions; before the database update, the plain list as before
      const outline = isQuestSourced ? null : await fetchSurveyOutline(survey.id, true);
      if (cancelled) return;
      if (outline && outline.ok) {
        setSections(outline.outline.sections);
        setQuestions(outline.outline.questions as ResultQuestion[]);
      } else if (!loadedOnce.current) {
        const plain = await fetchSurveyQuestions(survey);
        if (cancelled) return;
        setQuestions(plain);
      }
      loadedOnce.current = true;
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey.id, version]);

  // ── Show / hide the results, per section (per topic for a Question Bank survey) ──
  const [hidden, setHidden] = useState<string[]>(() => readHiddenSections(survey.id));
  const changeHidden = (next: string[]) => { setHidden(next); writeHiddenSections(survey.id, next); };
  const groups = useMemo(() => {
    if (isQuestSourced) {
      const topics = [...new Set(questions.map(q => q.topicName ?? ""))];
      return topics.map(name => ({ key: `topic:${name}`, title: name || "Results", description: "", questions: questions.filter(q => (q.topicName ?? "") === name) }));
    }
    return groupBySection(sections, questions.map(q => ({ ...q, sectionId: q.sectionId ?? null })))
      .filter(g => g.questions.length > 0)
      .map(g => ({
        key: g.section?.id ?? "none",
        title: g.section ? `${g.section.title}${g.section.removed ? " (section removed)" : ""}` : sections.length > 0 ? "Not in a section" : "Results",
        description: g.section?.description ?? "",
        questions: g.questions as ResultQuestion[],
      }));
  }, [sections, questions, isQuestSourced]);

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-[12px] text-slate-500">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${offline ? "bg-amber-500" : "bg-green-500"}`} />
        {offline ? <span role="status">Couldn't refresh just now — trying again. What you see may be a little old.</span>
          : <span>Live: new responses appear by themselves{checkedAt ? ` · checked ${checkedAt.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila" })}` : ""}</span>}
      </p>
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
          <GatingRosterSection key={`${survey.id}:${activityId}:${trigger}`} surveyId={survey.id} onChanged={reload} roster={roster === null ? null : filterRoster(roster, activityId, trigger)} showActivity={activityId === RECONSIDERATION || (!activityId && (survey.activities.length > 1 || survey.triggers?.reconsideration === true))} />
          <DeletedResponses key={survey.id} surveyId={survey.id} version={version} onRestored={reload} />
        </>
      )}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">Loading questions…</div>
      ) : questions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-6 text-center text-[13px] text-slate-400">This survey has no questions yet.</div>
      ) : (
        <>
          {groups.length > 1 && (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => changeHidden([])} className={TOGGLE_CLASS}><Eye size={13} aria-hidden="true" /> Show all results</button>
              <button type="button" onClick={() => changeHidden(groups.map(g => g.key))} className={TOGGLE_CLASS}><EyeOff size={13} aria-hidden="true" /> Hide all results</button>
            </div>
          )}
          {groups.map(g => {
            const isHidden = hidden.includes(g.key);
            return (
              <section key={g.key} aria-label={g.title} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="min-w-0">
                    <h2 className="text-[13.5px] font-bold text-[#062444]">{g.title}</h2>
                    {g.description && <p className="text-[12px] text-slate-500">{g.description}</p>}
                    {isHidden && <p className="text-[12px] text-slate-500">Results hidden ({g.questions.length} question{g.questions.length === 1 ? "" : "s"}).</p>}
                  </div>
                  <button type="button" onClick={() => changeHidden(isHidden ? hidden.filter(k => k !== g.key) : [...hidden, g.key])} aria-expanded={!isHidden} className={TOGGLE_CLASS}>
                    {isHidden ? <><Eye size={13} aria-hidden="true" /> Show results</> : <><EyeOff size={13} aria-hidden="true" /> Hide results</>}
                  </button>
                </div>
                {!isHidden && g.questions.map(q => (
                  <div key={q.id}>
                    {(q.removed || (q.version ?? 1) > 1) && (
                      <p className="mb-1 text-[11.5px] font-semibold text-amber-800">
                        {q.removed ? (q.removedReason === "changed" ? `Earlier version (version ${q.version}) — the question was changed` : "Removed from the survey — its answers are kept") : `Version ${q.version} — answers to earlier versions are listed separately`}
                      </p>
                    )}
                    <QuestionResultCard key={`${q.id}:${activityId}:${trigger}`} version={version} question={q} source={survey.activityType} activityId={resultsActivity} trigger={resultsTrigger} />
                  </div>
                ))}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

const TOGGLE_CLASS = "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#062444]/20 bg-white px-3 py-1.5 text-[12px] font-semibold text-[#062444] hover:bg-[#f7f9fc]";

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
function GatingRosterSection({ roster: loaded, showActivity, surveyId, onChanged }: { roster: GatingRosterEntry[] | null; showActivity: boolean; surveyId: string; onChanged: () => void }) {
  const [deleting, setDeleting] = useState<GatingRosterEntry | null>(null);
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
              <th className="px-3 py-2 text-right">Delete</th>
            </tr>
          </thead>
          <tbody>
            {filteredCount === 0 ? (
              <tr><td colSpan={showActivity ? 6 : 5} className="px-3 py-6 text-center text-slate-400">No scholars match.</td></tr>
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
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setDeleting(r)} aria-label={`Delete the response of ${r.scholarName}`} title="Delete response"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
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
      {deleting && <DeleteResponseDialog surveyId={surveyId} row={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); onChanged(); }} />}
    </div>
  );
}

function QuestionResultCard({ question, source, activityId, trigger, version }: { question: SurveyQuestion; source: SurveySource; activityId: string | null; trigger: string | null; version: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choiceResults, setChoiceResults] = useState<SurveyChoiceResult[] | null>(null);
  const [likertResult, setLikertResult] = useState<SurveyLikertResult | null>(null);
  const [openEndedResult, setOpenEndedResult] = useState<SurveyOpenEndedResult | null>(null);

  const shown = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchSurveyQuestionResults(question.id, question.questionType, source, activityId, trigger);
      if (cancelled) return;
      if (!result.ok) {
        if (shown.current === null) setError(result.error || "Failed to load results.");   // a failed refresh keeps the chart on screen
      } else {
        const next = JSON.stringify(result);
        if (next !== shown.current) {                      // unchanged results do not redraw the chart
          shown.current = next;
          setChoiceResults(result.choiceResults ?? null);
          setLikertResult(result.likertResult ?? null);
          setOpenEndedResult(result.openEndedResult ?? null);
        }
        setError("");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [question.id, question.questionType, source, activityId, trigger, version]);

  const choiceBars = useMemo(() => (choiceResults ?? []).map(c => ({ label: c.isOther ? `${c.choiceText} (write-in)` : c.removed ? `${c.choiceText} (${c.removedReason === "changed" ? "earlier wording" : "removed"})` : c.choiceText, count: c.count })), [choiceResults]);
  const likertBars = useMemo(() => (likertResult?.distribution ?? []).map(d => ({ label: `${d.value} (${d.percentage}%)`, count: d.count })), [likertResult]);

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
          <SurveyResultsChart bars={choiceBars} />
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
          <SurveyResultsChart bars={likertBars} />
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
