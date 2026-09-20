import { useEffect, useState } from "react";
import { Search, ClipboardPlus } from "lucide-react";
import { fetchDailyRecords, type DailyRecord } from "../scholarCounselingApi";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import type { ScholarshipStatus } from "../types";
import { AddDailyRecordModal } from "../components/AddDailyRecordModal";
import { ScholarProfilePreviewModal } from "../components/ScholarProfilePreviewModal";

const STATUS_BADGE_CLASSES: Record<ScholarshipStatus, string> = {
  "Regular": "bg-green-100 text-green-700",
  "Probationary": "bg-red-100 text-red-600",
  "On leave": "bg-amber-100 text-amber-700",
  "Reconsidered": "bg-blue-100 text-blue-700",
  "Removed": "bg-slate-200 text-slate-600",
};

function formatDateVisited(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * "Daily Records" — the Scholar Counseling Tool's first subtab: a log of
 * counseling visits (who was seen, when, their status at the time, what
 * was found, and what was recommended). "View" opens the same
 * comprehensive scholar profile popup used elsewhere in the app.
 */
export function ScholarCounselingTab() {
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [viewingScholar, setViewingScholar] = useState<ScholarInformationRow | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setRecords(await fetchDailyRecords(search));
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleView(scholarIdNumber: string) {
    setViewingId(scholarIdNumber);
    const info = await fetchScholarInformationByIdNumber(scholarIdNumber);
    setViewingId(null);
    if (info) setViewingScholar(info);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[13px] font-semibold rounded-lg px-4 py-2.5">
          <ClipboardPlus size={15} className="text-[#F3BC00]" /> Add Daily Record
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3 whitespace-nowrap">Name</th>
              <th className="px-4 py-3 whitespace-nowrap">Course</th>
              <th className="px-4 py-3 whitespace-nowrap">Year</th>
              <th className="px-4 py-3 whitespace-nowrap">School</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Information</th>
              <th className="px-4 py-3 whitespace-nowrap">Date Visited</th>
              <th className="px-4 py-3 text-center whitespace-nowrap">Status</th>
              <th className="px-4 py-3 whitespace-nowrap">Consulted By</th>
              <th className="px-4 py-3 whitespace-nowrap">Failed Subject(s)</th>
              <th className="px-4 py-3 whitespace-nowrap">Findings</th>
              <th className="px-4 py-3 whitespace-nowrap">Staff Recommendations</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">No daily records yet.</td></tr>
            ) : (
              records.map(r => (
                <tr key={r.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 font-medium text-[#062444] whitespace-nowrap">{r.name}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate" title={r.course || undefined}>{r.course || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.yearLevel || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate" title={r.school || undefined}>{r.school || "—"}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <button onClick={() => handleView(r.scholarIdNumber)} disabled={viewingId === r.scholarIdNumber}
                      className="text-[12.5px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50">
                      {viewingId === r.scholarIdNumber ? "Loading…" : "View"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateVisited(r.dateVisited)}</td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${STATUS_BADGE_CLASSES[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.consultedByName || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate" title={r.failedSubjects || undefined}>{r.failedSubjects || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate" title={r.findings || undefined}>{r.findings || "—"}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate" title={r.staffRecommendations || undefined}>{r.staffRecommendations || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <AddDailyRecordModal onClose={() => setShowAdd(false)} onCreated={load} />}
      {viewingScholar && <ScholarProfilePreviewModal scholar={viewingScholar} onClose={() => setViewingScholar(null)} />}
    </div>
  );
}
