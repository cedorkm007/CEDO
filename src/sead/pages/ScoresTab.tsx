import { useEffect, useState } from "react";
import { Search, Filter, Award, CheckCircle2, XCircle } from "lucide-react";
import { fetchSubjects, fetchTopics, fetchScores, fetchSubjectProgress, type SubjectProgressRow } from "../seadApi";
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
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<SubjectProgressRow[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);

  useEffect(() => { fetchSubjects().then(setSubjects); }, []);
  useEffect(() => {
    setTopicId("");
    if (subjectId) fetchTopics(subjectId).then(setTopics); else setTopics([]);

    if (subjectId) {
      setProgressLoading(true);
      fetchSubjectProgress(subjectId).then(p => { setProgress(p); setProgressLoading(false); });
    } else {
      setProgress([]);
    }
  }, [subjectId]);

  async function runFilter() {
    setLoading(true);
    setRows(await fetchScores({ subjectId: subjectId || undefined, topicId: topicId || undefined, scholarSearch: scholarSearch || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }));
    setLoading(false);
  }

  useEffect(() => { runFilter(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const avgPct = rows.length
    ? Math.round((rows.reduce((sum, r) => sum + (r.maxScore ? (r.score ?? 0) / r.maxScore : 0), 0) / rows.filter(r => r.maxScore).length) * 100) || 0
    : 0;

  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [rows]);

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
        const passedCount = progress.filter(p => p.passed).length;
        return (
          <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-[#062444] font-bold text-[12.5px]">
                <Award size={14} className="text-[#F3BC00]" /> Passing Rate Progress
                {subject && <span className="font-normal text-slate-400">— {subject.name} ({subject.passingRateMin}%–{subject.passingRateMax}%)</span>}
              </div>
              {progress.length > 0 && (
                <span className="text-[12px] font-semibold text-slate-500">{passedCount} of {progress.length} scholar{progress.length === 1 ? "" : "s"} passed</span>
              )}
              {subject?.certificateFilename && (
                <span className="text-[11px] font-semibold text-green-700 bg-green-100 rounded-full px-2.5 py-1 flex items-center gap-1">Certificate attached</span>
              )}
            </div>

            {progressLoading ? (
              <p className="text-sm text-slate-400 text-center py-4">Loading…</p>
            ) : progress.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No scholar has attempted any topic in this subject yet.</p>
            ) : (
              <div className="max-h-52 overflow-y-auto border border-[#f0f3f8] rounded-lg divide-y divide-[#f0f3f8]">
                {progress.map(p => (
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
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Results" value={String(rows.length)} />
        <StatCard label="Scholars" value={String(new Set(rows.map(r => r.scholarIdNumber)).size)} />
        <StatCard label="Average" value={rows.length ? `${avgPct}%` : "—"} />
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
              pagedRows.map(r => (
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
      <ListPagination page={safePage} totalPages={totalPages} onPageChange={setPage} filteredCount={rows.length} pageSize={pageSize} />
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
