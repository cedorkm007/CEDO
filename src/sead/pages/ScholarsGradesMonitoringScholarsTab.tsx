import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "../components/Modal";
import { ScholarGradesTable } from "../components/ScholarGradesTable";
import {
  fetchMonitoringScholars, fetchScholarGradesForStaff, fetchScholarGradingConfigForStaff, fetchScholarLetterGradesForStaff,
  type MonitoringScholarRow, type LetterGrade,
} from "../scholarsGradesMonitoringApi";
import type { StaffGradeRow } from "../components/ScholarGradesTable";
import { periodKey, periodTitle } from "@/lib/academicPeriods";
import type { GradingPeriod } from "../scholarsGradesMonitoringApi";

function displayName(row: MonitoringScholarRow): string {
  const mi = row.middleName.trim() ? `${row.middleName.trim()[0]}.` : "";
  return [`${row.lastName},`, row.firstName, mi].filter(Boolean).join(" ");
}

export function ScholarsGradesMonitoringScholarsTab({ period }: { period: GradingPeriod }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<MonitoringScholarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<MonitoringScholarRow | null>(null);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      fetchMonitoringScholars({ search: search.trim() }).then(r => { setRows(r); setLoading(false); });
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  return (
    <div>
      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or Scholar ID…"
          className="w-full border border-[#062444]/15 rounded-lg pl-9 pr-3 py-2 text-[13px] outline-none focus:border-[#0088cc]"
        />
      </div>

      <div className="bg-white border border-[#e6ecf5] rounded-xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-[#f7f9fc]">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">Scholar ID</th>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">Name</th>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">School</th>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">Program</th>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">Grades</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-[13px]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-[13px]">No scholars found.</td></tr>
            ) : rows.map(r => (
              <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc]">
                <td className="px-4 py-2.5 text-slate-700">{r.scholarIdNumber}</td>
                <td className="px-4 py-2.5 font-semibold text-[#062444]">{displayName(r)}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.schoolName}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.program}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => setViewing(r)} className="text-[#0088cc] font-semibold hover:underline">View Grades</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && <ScholarGradesModal scholar={viewing} period={period} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Shows the period chosen at the top of the page by default; "Show all periods" lists every semester on record for the scholar. */
function ScholarGradesModal({ scholar, period, onClose }: { scholar: MonitoringScholarRow; period: GradingPeriod; onClose: () => void }) {
  const [grades, setGrades] = useState<StaffGradeRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [letterGrades, setLetterGrades] = useState<LetterGrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchScholarGradesForStaff(scholar.scholarIdNumber),
      fetchScholarGradingConfigForStaff(scholar.scholarIdNumber),
      fetchScholarLetterGradesForStaff(scholar.scholarIdNumber),
    ]).then(([g, config, letters]) => {
      setGrades(g);
      setLetterGrades(config?.usesLetterGrades ? letters : []);
      setLoading(false);
    });
  }, [scholar.scholarIdNumber]);

  const wantedKey = period.schoolYear ? periodKey(period.schoolYear, period.semester) : "";
  const inPeriod = useMemo(() => grades.filter(g => periodKey(g.schoolYear, g.semester) === wantedKey), [grades, wantedKey]);
  const shown = showAll || !wantedKey ? grades : inPeriod;

  return (
    <Modal title={`${displayName(scholar)} — Grades`} onClose={onClose} elevated>
      {loading ? (
        <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>
      ) : (
        <>
          {wantedKey && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-[12.5px] text-slate-600">{showAll ? "Showing every period on record" : `Showing ${periodTitle(period)}`}</p>
              <button onClick={() => setShowAll(v => !v)} className="text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80">
                {showAll ? "Show only the selected period" : "Show all periods"}
              </button>
            </div>
          )}
          {!showAll && wantedKey && inPeriod.length === 0 && grades.length > 0 && (
            <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Nothing is recorded for this scholar in {periodTitle(period)}, but other periods have grades — use "Show all periods".
            </p>
          )}
          <ScholarGradesTable key={showAll ? "all" : wantedKey} grades={shown} letterGrades={letterGrades} />
        </>
      )}
    </Modal>
  );
}
