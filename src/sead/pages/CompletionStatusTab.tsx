import { useEffect, useState } from "react";
import { Filter, CheckCircle2, XCircle, MinusCircle, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { fetchSubjects, fetchSubjectCompletionStatus, type CompletionStatusFilter, type SubjectCompletionRow } from "../seadApi";
import type { QuestSubject } from "../types";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";

/**
 * New quest monitoring tasks, Task 2. Per subject: which scholars
 * completed every topic at least once (regardless of score), which
 * attempted some but not all, and which never attempted any — a
 * distinct concept from the Scores & Progress tab's pass/fail split
 * (that one is score-threshold-based; this one is pure attempt-count).
 * Backed by subject_completion_status RPC
 * (supabase_migration_subject_completion_status_rpc.sql) via
 * fetchSubjectCompletionStatus() in seadApi.ts. Same filter/pagination
 * conventions as ScoresTab.tsx's own Passing Rate Progress panel (Year
 * Level applies immediately, School is 350ms-debounced, page size
 * offers 10/50/100) for UI consistency across Quest Monitoring's
 * sub-tabs.
 */
export function CompletionStatusTab() {
  const [subjects, setSubjects] = useState<QuestSubject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [statusFilter, setStatusFilter] = useState<CompletionStatusFilter>("all");
  const [yearLevel, setYearLevel] = useState("");
  const [school, setSchool] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<SubjectCompletionRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [didNotCompleteCount, setDidNotCompleteCount] = useState(0);
  const [notAttemptedCount, setNotAttemptedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchSubjects().then(setSubjects); }, []);

  useEffect(() => {
    setStatusFilter("all");
    setPage(1);
    if (subjectId) {
      void load(subjectId, "all", 1);
    } else {
      setRows([]); setTotalCount(0); setCompletedCount(0); setDidNotCompleteCount(0); setNotAttemptedCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId]);

  // School is free text, debounced 350ms — same convention as
  // ScoresTab.tsx's own progressSchool filter, so a query isn't fired on
  // every keystroke.
  useEffect(() => {
    if (!subjectId) return;
    const t = setTimeout(() => {
      setPage(1);
      void load(subjectId, statusFilter, 1, pageSize, yearLevel, school);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school]);

  async function load(
    subject: string, status: CompletionStatusFilter, requestedPage: number,
    size: number = pageSize, yl: string = yearLevel, sc: string = school,
  ) {
    setLoading(true);
    const result = await fetchSubjectCompletionStatus(subject, status, requestedPage, size, yl, sc);
    setRows(result.rows);
    setTotalCount(result.totalCount);
    setCompletedCount(result.completedCount);
    setDidNotCompleteCount(result.didNotCompleteCount);
    setNotAttemptedCount(result.notAttemptedCount);
    setError(result.error);
    setLoading(false);
  }

  function changeStatusFilter(next: CompletionStatusFilter) {
    setStatusFilter(next);
    setPage(1);
    if (subjectId) void load(subjectId, next, 1);
  }

  function changeYearLevel(next: string) {
    setYearLevel(next);
    setPage(1);
    if (subjectId) void load(subjectId, statusFilter, 1, pageSize, next, school);
  }

  function changePageSize(next: number) {
    setPageSize(next);
    setPage(1);
    if (subjectId) void load(subjectId, statusFilter, 1, next);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    if (subjectId) void load(subjectId, statusFilter, nextPage);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <div>
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-[#062444] font-bold text-[12.5px]"><Filter size={14} /> Filters</div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)}
            className="border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">Select a Subject…</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={yearLevel} onChange={e => changeYearLevel(e.target.value)}
            className="border border-[#062444]/15 rounded-lg px-3 py-2 text-[12.5px] outline-none">
            <option value="">All Year Levels</option>
            {FORMATION_YEAR_LEVELS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <input value={school} onChange={e => setSchool(e.target.value)} placeholder="Search school…"
            className="border border-[#062444]/15 rounded-lg px-3 py-2 text-[12.5px] outline-none" />
        </div>
      </div>

      {!subjectId ? (
        <p className="text-sm text-slate-400 text-center py-8">Select a subject to see completion status.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
          {error && (
            <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-red-600">
              <AlertTriangle size={13} /> {error}
              <button onClick={() => load(subjectId, statusFilter, page)} className="underline font-semibold ml-1">Retry</button>
            </p>
          )}

          <div className="flex items-center gap-1 bg-[#f8fafd] border border-[#e6ecf5] rounded-lg p-1 mb-3 w-fit">
            {([
              ["all", `All (${completedCount + didNotCompleteCount + notAttemptedCount})`],
              ["completed", `Completed (${completedCount})`],
              ["did_not_complete", `Did Not Complete (${didNotCompleteCount})`],
              ["not_attempted", `Not Attempted (${notAttemptedCount})`],
            ] as const).map(([value, label]) => (
              <button key={value} onClick={() => changeStatusFilter(value)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-md ${statusFilter === value ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-white"}`}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-4">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No scholars match this filter yet.</p>
          ) : (
            <>
              <div className="border border-[#f0f3f8] rounded-lg divide-y divide-[#f0f3f8]">
                {rows.map(r => (
                  <div key={r.scholarIdNumber} className="flex items-center justify-between px-3 py-2 text-[12.5px]">
                    <div>
                      <span className="font-semibold text-[#062444]">{r.scholarName}</span>
                      <span className="text-slate-400 ml-1.5">({r.scholarIdNumber})</span>
                      {(r.yearLevel || r.school) && (
                        <span className="text-slate-400 ml-1.5">· {[r.yearLevel, r.school].filter(Boolean).join(", ")}</span>
                      )}
                      <span className="text-slate-400 ml-1.5">· {r.topicsAttempted}/{r.totalTopics} topics attempted</span>
                    </div>
                    {r.status === "completed" ? (
                      <span className="flex items-center gap-1 text-green-600 font-semibold"><CheckCircle2 size={13} /> Completed</span>
                    ) : r.status === "did_not_complete" ? (
                      <span className="flex items-center gap-1 text-amber-600 font-semibold"><XCircle size={13} /> Did Not Complete</span>
                    ) : (
                      <span className="flex items-center gap-1 text-slate-400"><MinusCircle size={13} /> Not Attempted</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-slate-500">
                    Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, totalCount)} of {totalCount}
                  </span>
                  <select value={pageSize} onChange={e => changePageSize(Number(e.target.value))}
                    className="border border-[#062444]/15 rounded-lg px-2 py-1 text-[11.5px] outline-none">
                    <option value={10}>10 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => changePage(Math.max(1, safePage - 1))} disabled={safePage <= 1}
                    className="flex items-center gap-1 text-[12px] font-semibold text-[#062444] disabled:text-slate-300">
                    <ChevronLeft size={13} /> Prev
                  </button>
                  <span className="text-[11.5px] text-slate-500">Page {safePage} of {totalPages}</span>
                  <button onClick={() => changePage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
                    className="flex items-center gap-1 text-[12px] font-semibold text-[#062444] disabled:text-slate-300">
                    Next <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
