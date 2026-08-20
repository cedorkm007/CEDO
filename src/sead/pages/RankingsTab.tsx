import { useEffect, useState } from "react";
import { Trophy, ChevronLeft, ChevronRight, Medal } from "lucide-react";
import { fetchSubjects, fetchSubjectRankings, fetchDistinctYearLevels, type RankingRow } from "../seadApi";
import { fetchDistinctSchools } from "../formationApi";
import { CLUSTERS, namedBarangaysInCluster, NUMBERED_BARANGAYS, type ClusterCode } from "@/lib/cdoBarangays";
import type { QuestSubject } from "../types";
import { ListPagination } from "@/app/components/PaginatedList";

const TOP_N_OPTIONS = [10, 50, 100];

const medalColor = (rank: number) => rank === 1 ? "text-[#F3BC00]" : rank === 2 ? "text-slate-400" : rank === 3 ? "text-amber-700" : "text-slate-300";

/**
 * "Rankings" — click a subject to see its top scorers (via
 * scholar_subject_progress, the same aggregate used for the passing-rate
 * feature), filterable by top N, year level, school, or cluster/barangay.
 */
export function RankingsTab() {
  const [subjects, setSubjects] = useState<QuestSubject[]>([]);
  const [selected, setSelected] = useState<QuestSubject | null>(null);
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState<RankingRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [topN, setTopN] = useState<number | "all">(10);
  const [yearLevel, setYearLevel] = useState("");
  const [school, setSchool] = useState("");
  const [locationMode, setLocationMode] = useState<"none" | "cluster" | "barangay">("none");
  const [cluster, setCluster] = useState<ClusterCode>("A");
  const [barangay, setBarangay] = useState("");

  const [yearLevels, setYearLevels] = useState<string[]>([]);
  const [schools, setSchools] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [s, yl, sc] = await Promise.all([fetchSubjects(), fetchDistinctYearLevels(), fetchDistinctSchools()]);
      setSubjects(s);
      setYearLevels(yl);
      setSchools(sc);
      setLoading(false);
    })();
  }, []);

  async function loadRankings() {
    if (!selected) return;
    setRowsLoading(true);
    const clusterBarangays = locationMode === "cluster" ? (cluster === "G" ? [...namedBarangaysInCluster("G"), ...NUMBERED_BARANGAYS] : namedBarangaysInCluster(cluster)) : undefined;
    const result = await fetchSubjectRankings(selected.id, {
      topN: topN === "all" ? undefined : topN,
      yearLevel: yearLevel || undefined,
      school: school || undefined,
      barangay: locationMode === "barangay" && barangay ? barangay : undefined,
      barangayIn: clusterBarangays,
    });
    setRows(result);
    setRowsLoading(false);
  }

  useEffect(() => {
    if (selected) loadRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, topN, yearLevel, school, locationMode, cluster, barangay]);

  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [rows]);

  if (selected) {
    return (
      <div>
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-[12.5px] font-semibold text-slate-400 hover:text-[#062444] mb-4">
          <ChevronLeft size={14} /> Back to Subjects
        </button>
        <h3 className="text-[15px] font-extrabold text-[#062444] mb-4">{selected.name} — Top Scorers</h3>

        <div className="flex flex-wrap items-end gap-3 mb-5">
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Show</label>
            <select value={topN} onChange={e => setTopN(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 bg-white">
              {TOP_N_OPTIONS.map(n => <option key={n} value={n}>Top {n}</option>)}
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Year Level</label>
            <select value={yearLevel} onChange={e => setYearLevel(e.target.value)}
              className="text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 bg-white">
              <option value="">All</option>
              {yearLevels.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">School</label>
            <select value={school} onChange={e => setSchool(e.target.value)}
              className="text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 bg-white max-w-[180px]">
              <option value="">All</option>
              {schools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10.5px] font-semibold text-slate-400 mb-1">Location</label>
            <div className="flex items-center gap-1">
              <select value={locationMode} onChange={e => setLocationMode(e.target.value as typeof locationMode)}
                className="text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 bg-white">
                <option value="none">All</option>
                <option value="cluster">By Cluster</option>
                <option value="barangay">By Barangay</option>
              </select>
              {locationMode === "cluster" && (
                <select value={cluster} onChange={e => setCluster(e.target.value as ClusterCode)}
                  className="text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 bg-white">
                  {CLUSTERS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              )}
              {locationMode === "barangay" && (
                <input value={barangay} onChange={e => setBarangay(e.target.value)} placeholder="Barangay name"
                  className="text-[12.5px] border border-[#e6ecf5] rounded-lg px-2.5 py-1.5 bg-white w-32" />
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Scholar</th>
                <th className="px-4 py-3">School</th>
                <th className="px-4 py-3">Year Level</th>
                <th className="px-4 py-3">Score</th>
              </tr>
            </thead>
            <tbody>
              {rowsLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No scorers match this filter yet.</td></tr>
              ) : (
                pagedRows.map(r => (
                  <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 font-bold ${medalColor(r.rank)}`}>
                        {r.rank <= 3 ? <Medal size={14} /> : null} #{r.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-[#062444]">{r.scholarName} <span className="text-slate-400 font-normal">({r.scholarIdNumber})</span></td>
                    <td className="px-4 py-3 text-slate-500">{r.school || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.yearLevel || "—"}</td>
                    <td className="px-4 py-3 font-bold text-[#062444]">{r.subjectPercentage.toFixed(1)}%</td>
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

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">Pick a subject to see its top scorers.</p>
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : subjects.length === 0 ? (
        <p className="text-sm text-slate-400">No quest subjects have been set up yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {subjects.map(s => (
            <button key={s.id} onClick={() => setSelected(s)}
              className="flex items-center justify-between gap-2 bg-white border border-[#e6ecf5] hover:border-[#0088cc]/40 hover:shadow-[0_2px_10px_rgba(6,36,68,0.06)] rounded-xl px-4 py-3.5 text-left transition-all">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[#062444] truncate">
                <Trophy size={14} className="text-[#F3BC00] shrink-0" /> {s.name}
              </span>
              <ChevronRight size={14} className="text-[#0088cc] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
