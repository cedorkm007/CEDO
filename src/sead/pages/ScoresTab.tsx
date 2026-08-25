import { useEffect, useState } from "react";
import { Search, Filter, Award, CheckCircle2, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchSubjects, fetchTopics, searchQuestScores, fetchSubjectProgressPage, type PassedFilter } from "../seadApi";
import type { QuestSubject, QuestTopic, ScoreRow } from "../types";
import { ListPagination } from "@/app/components/PaginatedList";

export function ScoresTab() {
  const [subjects, setSubjects] = useState<QuestSubject[]>([]);
  const [topics, setTopics] = useState<QuestTopic[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [scholarSearch, setScholarSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [scholarCount, setScholarCount] = useState(0);
  const [avgPct, setAvgPct] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [progressRows, setProgressRows] = useState<{ scholarIdNumber: string; scholarName: string; topicCount: number; subjectPercentage: number; passed: boolean }[]>([]);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressPassedCount, setProgressPassedCount] = useState(0);
  const [progressNotPassedCount, setProgressNotPassedCount] = useState(0);
  const [progressPassingMin, setProgressPassingMin] = useState(75);
  const [progressPassingMax, setProgressPassingMax] = useState(100);
  const [progressLoading, setProgressLoading] = useState(false);
  const [passedFilter, setPassedFilter] = useState<PassedFilter>("all");
  const [progressPage, setProgressPage] = useState(1);
  const PROGRESS_PAGE_SIZE = 10;

  async function loadProgressPage(subject: string, filter: PassedFilter, page: number) {
    setProgressLoading(true);
    const result = await fetchSubjectProgressPage(subject, filter, page, PROGRESS_PAGE_SIZE);
    setProgressRows(result.rows);
    setProgressTotal(result.totalCount);
    setProgressPassedCount(result.passedCount);
    setProgressNotPassedCount(result.notPassedCount);
    setProgressPassingMin(result.passingRateMin);
    setProgressPassingMax(result.passingRateMax);
    setProgressLoading(false);
  }

  function changePassedFilter(next: PassedFilter) {
    setPassedFilter(next);
    setProgressPage(1);
    if (subjectId) void loadProgressPage(subjectId, next, 1);
  }

  function changeProgressPage(nextPage: number) {
    setProgressPage(nextPage);
    if (subjectId) void loadProgressPage(subjectId, passedFilter, nextPage);
  }

  useEffect(() => { fetchSubjects().then(setSubjects); }, []);
  useEffect(() => {
    setTopicId("");
    if (subjectId) fetchTopics(subjectId).then(setTopics); else setTopics([]);

    setPassedFilter("all");
    setProgressPage(1);
    if (subjectId) {
      void loadProgressPage(subjectId, "all", 1);
    } else {
      setProgressRows([]);
      setProgressTotal(0);
      setProgressPassedCount(0);
      setProgressNotPassedCount(0);
    }
  }, [subjectId]);

  const [page, setPage] = useState(1);
  const pageSize = 10;

  async function loadScores(requestedPage: number) {
    setLoading(true);
    const result = await searchQuestScores({
      subjectId: subjectId || undefined, topicId: topicId || undefined,
      scholarSearch: scholarSearch || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    }, requestedPage, pageSize);
    setRows(result.rows);
    setTotalCount(result.totalCount);
    setScholarCount(result.distinctScholarCount);
    setAvgPct(result.totalCount > 0 ? result.avgPercentage : null);
    setLoading(false);
  }

  function runFilter() {
    setPage(1);
    void loadScores(1);
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    void loadScores(nextPage);
  }

  useEffect(() => { void loadScores(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <div>
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-[#062444] font-bold text-[12.5px]"><Filter size={14} /> Filters</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">All Subjects</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={topicId} onChange={e => setTopicId(e.target.value)} disabled={!subjectId} className="border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50">
            <option value="">All Topics</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-2 border border-[#062444]/15 rounded-lg px-3 py-2">
            <Search size={14} className="text-slate-400" />
            <input value={scholarSearch} onChange={e => setScholarSearch(e.target.value)} placeholder="Scholar name or ID"
              className="w-full text-sm outline-none" />
          </div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none" />
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={runFilter} className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            Apply Filters
          </button>
        </div>
      </div>

      {subjectId && (() => {
        const subject = subjects.find(s => s.id === subjectId);
        const progressTotalPages = Math.max(1, Math.ceil(progressTotal / PROGRESS_PAGE_SIZE));
        const safeProgressPage = Math.min(progressPage, progressTotalPages);
        return (
          <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2 text-[#062444] font-bold text-[12.5px]">
                <Award size={14} className="text-[#F3BC00]" /> Passing Rate Progress
                {subject && <span className="font-normal text-slate-400">— {subject.name} ({progressPassingMin}%–{progressPassingMax}%)</span>}
              </div>
              {subject?.certificateFilename && (
                <span className="text-[11px] font-semibold text-green-700 bg-green-100 rounded-full px-2.5 py-1 flex items-center gap-1">Certificate attached</span>
              )}
            </div>

            <div className="flex items-center gap-1 bg-[#f8fafd] border border-[#e6ecf5] rounded-lg p-1 mb-3 w-fit">
              {([
                ["all", `All (${progressPassedCount + progressNotPassedCount})`],
                ["passed", `Passed (${progressPassedCount})`],
                ["not_passed", `Not Passed (${progressNotPassedCount})`],
              ] as const).map(([value, label]) => (
                <button key={value} onClick={() => changePassedFilter(value)}
                  className={`text-[12px] font-semibold px-3 py-1.5 rounded-md ${passedFilter === value ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-white"}`}>
                  {label}
                </button>
              ))}
            </div>

            {progressLoading ? (
              <p className="text-sm text-slate-400 text-center py-4">Loading…</p>
            ) : progressRows.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">
                {passedFilter === "all" ? "No scholar has attempted any topic in this subject yet." : `No scholars match "${passedFilter === "passed" ? "Passed" : "Not Passed"}" yet.`}
              </p>
            ) : (
              <>
                <div className="border border-[#f0f3f8] rounded-lg divide-y divide-[#f0f3f8]">
                  {progressRows.map(p => (
                    <div key={p.scholarIdNumber} className="flex items-center justify-between px-3 py-2 text-[12.5px]">
                      <div>
                        <span className="font-semibold text-[#062444]">{p.scholarName}</span>
                        <span className="text-slate-400 ml-1.5">({p.scholarIdNumber})</span>
                        <span className="text-slate-400 ml-1.5">· {p.topicCount} topic{p.topicCount === 1 ? "" : "s"} taken</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#062444]">{p.subjectPercentage.toFixed(1)}%</span>
                        {p.passed ? (
                          <span className="flex items-center gap-1 text-green-600 font-semibold"><CheckCircle2 size={13} /> Passed</span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400"><XCircle size={13} /> Not yet</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[11.5px] text-slate-500">
                    Showing {(safeProgressPage - 1) * PROGRESS_PAGE_SIZE + 1}–{Math.min(safeProgressPage * PROGRESS_PAGE_SIZE, progressTotal)} of {progressTotal}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => changeProgressPage(Math.max(1, safeProgressPage - 1))} disabled={safeProgressPage <= 1}
                      className="flex items-center gap-1 text-[12px] font-semibold text-[#062444] disabled:text-slate-300">
                      <ChevronLeft size={13} /> Prev
                    </button>
                    <span className="text-[11.5px] text-slate-500">Page {safeProgressPage} of {progressTotalPages}</span>
                    <button onClick={() => changeProgressPage(Math.min(progressTotalPages, safeProgressPage + 1))} disabled={safeProgressPage >= progressTotalPages}
                      className="flex items-center gap-1 text-[12px] font-semibold text-[#062444] disabled:text-slate-300">
                      Next <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Results" value={String(totalCount)} />
        <StatCard label="Scholars" value={String(scholarCount)} />
        <StatCard label="Average" value={avgPct === null ? "—" : String(avgPct) + "%"} />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3">Scholar</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Quest</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No results for these filters.</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#062444]">{r.scholarName}</div>
                    <div className="text-[11.5px] text-slate-400">{r.scholarIdNumber}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.subjectName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.topicName ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.questName}</td>
                  <td className="px-4 py-3 font-semibold text-[#062444]">{r.score ?? "—"}{r.maxScore ? ` / ${r.maxScore}` : ""}</td>
                  <td className="px-4 py-3 text-slate-500">{r.dateTaken ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ListPagination page={safePage} totalPages={totalPages} onPageChange={changePage} filteredCount={totalCount} pageSize={pageSize} itemLabel="attempt records" />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] px-5 py-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#0088cc] mb-1">{label}</p>
      <p className="text-xl font-extrabold text-[#062444]">{value}</p>
    </div>
  );
}
