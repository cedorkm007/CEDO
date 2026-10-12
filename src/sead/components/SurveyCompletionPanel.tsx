import { useEffect, useState } from "react";
import { ClipboardCheck, CheckCircle2, XCircle, MinusCircle, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { fetchSubjectCompletionStatus, type CompletionStatusFilter, type SubjectCompletionRow } from "../seadApi";
import type { QuestSubject } from "../types";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";

type SurveyFilter = Extract<CompletionStatusFilter, "all" | "answered" | "completed" | "not_completed">;

/**
 * Scores & Progress → for a SURVEY-type subject (answers go to Research Project Monitoring → Survey Results and are never
 * scored). The Passed / Not Passed split does not apply to a survey, so this panel lists who answered it instead:
 * Answered (submitted at least one topic), Completed (answered every topic of the survey) and Not Completed (everyone else). Backed by
 * subject_completion_status (supabase_migration_quest_survey_completion.sql), same RPC as the Completion Status tab.
 */
export function SurveyCompletionPanel({ subject }: { subject: QuestSubject }) {
  const [filter, setFilter] = useState<SurveyFilter>("all");
  const [yearLevel, setYearLevel] = useState("");
  const [school, setSchool] = useState("");
  const [debouncedSchool, setDebouncedSchool] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<SubjectCompletionRow[]>([]);
  const [completed, setCompleted] = useState(0);
  const [partial, setPartial] = useState(0);
  const [notAnswered, setNotAnswered] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSchool(school.trim()), 350);
    return () => clearTimeout(t);
  }, [school]);

  // A different subject or filter starts again from the first page.
  useEffect(() => { setPage(1); }, [subject.id, filter, yearLevel, debouncedSchool, pageSize]);
  useEffect(() => { setFilter("all"); }, [subject.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSubjectCompletionStatus(subject.id, filter, page, pageSize, yearLevel, debouncedSchool).then(result => {
      if (cancelled) return;
      setRows(result.rows);
      setCompleted(result.completedCount);
      setPartial(result.didNotCompleteCount);
      setNotAnswered(result.notAttemptedCount);
      const counts = { all: result.completedCount + result.didNotCompleteCount + result.notAttemptedCount, answered: result.completedCount + result.didNotCompleteCount, completed: result.completedCount, not_completed: result.didNotCompleteCount + result.notAttemptedCount };
      setTotalCount(counts[filter]);
      setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [subject.id, filter, page, pageSize, yearLevel, debouncedSchool, retry]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4 mb-4">
      <div className="flex items-center gap-2 mb-1 text-[#062444] font-bold text-[13px]">
        <ClipboardCheck size={15} className="text-[#F3BC00]" aria-hidden="true" /> Survey Completion
        <span className="font-normal text-slate-600">— {subject.name}</span>
      </div>
      <p className="text-[13px] text-slate-600 mb-3">
        This subject is a survey, so it is not scored. <strong>Answered</strong> means a scholar submitted at least one topic; <strong>Completed</strong> means they answered every topic. The answers themselves are in Research Project Monitoring → Survey Results.
      </p>

      {error && (
        <p role="alert" className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-red-700">
          <AlertTriangle size={13} aria-hidden="true" /> {error}
          <button onClick={() => setRetry(n => n + 1)} className="underline font-semibold ml-1">Retry</button>
        </p>
      )}

      <div role="group" aria-label="Survey completion filter" className="flex items-center gap-1 bg-[#f8fafd] border border-[#e6ecf5] rounded-lg p-1 mb-3 w-fit max-w-full flex-wrap">
        {([
          ["all", `All (${completed + partial + notAnswered})`],
          ["answered", `Answered (${completed + partial})`],
          ["completed", `Completed (${completed})`],
          ["not_completed", `Not Completed (${partial + notAnswered})`],
        ] as const).map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}
            className={`text-[13px] font-semibold px-3 py-1.5 rounded-md ${filter === value ? "bg-[#062444] text-white" : "text-slate-600 hover:bg-white"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={yearLevel} onChange={e => setYearLevel(e.target.value)} aria-label="Year level"
          className="border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none">
          <option value="">All Year Levels</option>
          {FORMATION_YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <input value={school} onChange={e => setSchool(e.target.value)} placeholder="Search school…" aria-label="Search school"
          className="border border-[#062444]/15 rounded-lg px-3 py-2 text-[13px] outline-none" />
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-600 text-center py-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-slate-600 text-center py-4">
          {filter === "answered" ? "No scholar has answered this survey yet." : filter === "completed" ? "No scholar has completed this survey yet." : filter === "not_completed" ? "Every scholar has completed this survey." : "No scholars match these filters."}
        </p>
      ) : (
        <>
          <ul className="border border-[#f0f3f8] rounded-lg divide-y divide-[#f0f3f8]">
            {rows.map(r => (
              <li key={r.scholarIdNumber} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <div>
                  <span className="font-semibold text-[#062444]">{r.scholarName}</span>
                  <span className="text-slate-600 ml-1.5">({r.scholarIdNumber})</span>
                  {(r.yearLevel || r.school) && <span className="text-slate-600 ml-1.5">· {[r.yearLevel, r.school].filter(Boolean).join(", ")}</span>}
                </div>
                {r.status === "completed" ? (
                  <span className="flex items-center gap-1 text-green-700 font-semibold"><CheckCircle2 size={13} aria-hidden="true" /> Completed</span>
                ) : r.status === "did_not_complete" ? (
                  <span className="flex items-center gap-1 text-amber-800 font-semibold"><MinusCircle size={13} aria-hidden="true" /> Partly answered ({r.topicsAttempted}/{r.totalTopics} topics)</span>
                ) : (
                  <span className="flex items-center gap-1 text-slate-600"><XCircle size={13} aria-hidden="true" /> Not answered</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-slate-600">
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, totalCount)} of {totalCount}
              </span>
              <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Rows per page"
                className="border border-[#062444]/15 rounded-lg px-2 py-1 text-[13px] outline-none">
                <option value={10}>10 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}
                className="flex items-center gap-1 text-[13px] font-semibold text-[#062444] disabled:text-slate-400">
                <ChevronLeft size={13} aria-hidden="true" /> Prev
              </button>
              <span className="text-[13px] text-slate-600">Page {safePage} of {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
                className="flex items-center gap-1 text-[13px] font-semibold text-[#062444] disabled:text-slate-400">
                Next <ChevronRight size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
