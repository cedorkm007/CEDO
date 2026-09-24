import { useEffect, useState } from "react";
import { School } from "lucide-react";
import { Modal } from "../components/Modal";
import {
  fetchSchoolsCompletion, fetchProgramsCompletion,
  type GradingPeriod, type SchoolCompletionRow, type ProgramCompletionRow,
} from "../scholarsGradesMonitoringApi";

function percentColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

export function ScholarsGradesMonitoringSchoolsTab({ period }: { period: GradingPeriod }) {
  const [schools, setSchools] = useState<SchoolCompletionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSchool, setOpenSchool] = useState<SchoolCompletionRow | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSchoolsCompletion(period).then(rows => { setSchools(rows); setLoading(false); });
  }, [period]);

  if (loading) return <p className="text-[13px] text-slate-400 text-center py-10">Loading…</p>;

  if (schools.length === 0) {
    return <p className="text-[13px] text-slate-400 text-center py-10">No schools found. Schools are backfilled from scholars' existing school field — check the schools table.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {schools.map(s => (
          <button
            key={s.schoolId}
            onClick={() => setOpenSchool(s)}
            className="text-left bg-white border border-[#e6ecf5] rounded-xl p-4 hover:border-[#0088cc]/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-2 mb-2">
              <School size={15} className="text-[#0088cc] shrink-0" />
              <span className="font-bold text-[13.5px] text-[#062444] truncate">{s.schoolName}</span>
            </div>
            <p className={`text-2xl font-extrabold ${percentColor(s.percentComplete)}`}>{s.percentComplete}%</p>
            <p className="text-[12px] text-slate-400">{s.completeScholars} of {s.totalScholars} scholars complete</p>
          </button>
        ))}
      </div>

      {openSchool && (
        <ProgramsModal school={openSchool} period={period} onClose={() => setOpenSchool(null)} />
      )}
    </div>
  );
}

function ProgramsModal({ school, period, onClose }: { school: SchoolCompletionRow; period: GradingPeriod; onClose: () => void }) {
  const [programs, setPrograms] = useState<ProgramCompletionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProgramsCompletion(school.schoolId, period).then(rows => { setPrograms(rows); setLoading(false); });
  }, [school.schoolId, period]);

  return (
    <Modal title={`${school.schoolName} — Programs`} onClose={onClose}>
      {loading ? (
        <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>
      ) : programs.length === 0 ? (
        <p className="text-[13px] text-slate-400 text-center py-8">No programs found for this school.</p>
      ) : (
        <div className="space-y-2">
          {programs.map(p => (
            <div key={p.program} className="flex items-center justify-between bg-white border border-[#e6ecf5] rounded-lg px-4 py-3">
              <span className="text-[13.5px] font-semibold text-[#062444]">{p.program}</span>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-slate-400">{p.completeScholars} of {p.totalScholars} complete</span>
                <span className={`text-[15px] font-extrabold ${percentColor(p.percentComplete)}`}>{p.percentComplete}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
