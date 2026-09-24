import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, GraduationCap, BookOpen, UploadCloud } from "lucide-react";
import { fetchOwnScholars } from "../schoolApi";
import { ScholarGradeEntryModal } from "./ScholarGradeEntryModal";
import { BulkGradeUploadModal } from "./BulkGradeUploadModal";
import type { SchoolScholarRow } from "../types";

type DrillLevel = { level: "yearLevels" } | { level: "programs"; yearLevel: string } | { level: "scholars"; yearLevel: string; program: string };

function displayName(row: SchoolScholarRow): string {
  const mi = row.middleName.trim() ? `${row.middleName.trim()[0]}.` : "";
  return [`${row.lastName},`, row.firstName, mi].filter(Boolean).join(" ");
}

export function ScholarsDrilldownPanel({ schoolId }: { schoolId: string }) {
  const [scholars, setScholars] = useState<SchoolScholarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillLevel>({ level: "yearLevels" });
  const [viewingScholar, setViewingScholar] = useState<SchoolScholarRow | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);

  useEffect(() => {
    fetchOwnScholars(schoolId).then(rows => { setScholars(rows); setLoading(false); });
  }, [schoolId]);

  function reload() {
    fetchOwnScholars(schoolId).then(setScholars);
  }

  const yearLevels = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of scholars) {
      const yl = s.yearLevel || "(Not set)";
      map.set(yl, (map.get(yl) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [scholars]);

  const programs = useMemo(() => {
    if (drill.level !== "programs") return [];
    const map = new Map<string, number>();
    for (const s of scholars) {
      if ((s.yearLevel || "(Not set)") !== drill.yearLevel) continue;
      const p = s.course || "(Not set)";
      map.set(p, (map.get(p) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [scholars, drill]);

  const scholarsInScope = useMemo(() => {
    if (drill.level !== "scholars") return [];
    return scholars.filter(s => (s.yearLevel || "(Not set)") === drill.yearLevel && (s.course || "(Not set)") === drill.program);
  }, [scholars, drill]);

  if (loading) return <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>;

  if (drill.level === "yearLevels") {
    return (
      <div>
        <p className="text-[12.5px] text-slate-400 mb-3">Select a year level to browse your scholars.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {yearLevels.map(([yl, count]) => (
            <button key={yl} onClick={() => setDrill({ level: "programs", yearLevel: yl })}
              className="text-left bg-white border border-[#e6ecf5] rounded-xl p-4 hover:border-[#0088cc]/40 hover:shadow-sm transition-all">
              <GraduationCap size={16} className="text-[#0088cc] mb-2" />
              <p className="font-bold text-[13.5px] text-[#062444]">{yl}</p>
              <p className="text-[12px] text-slate-400">{count} scholar{count === 1 ? "" : "s"}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (drill.level === "programs") {
    return (
      <div>
        <button onClick={() => setDrill({ level: "yearLevels" })} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] mb-3 hover:opacity-80">
          <ChevronLeft size={14} /> Back to Year Levels
        </button>
        <p className="text-[12.5px] text-slate-400 mb-3">{drill.yearLevel} — select a program.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {programs.map(([program, count]) => (
            <button key={program} onClick={() => setDrill({ level: "scholars", yearLevel: drill.yearLevel, program })}
              className="text-left bg-white border border-[#e6ecf5] rounded-xl p-4 hover:border-[#0088cc]/40 hover:shadow-sm transition-all">
              <BookOpen size={16} className="text-[#0088cc] mb-2" />
              <p className="font-bold text-[13.5px] text-[#062444]">{program}</p>
              <p className="text-[12px] text-slate-400">{count} scholar{count === 1 ? "" : "s"}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setDrill({ level: "programs", yearLevel: drill.yearLevel })} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] mb-3 hover:opacity-80">
        <ChevronLeft size={14} /> Back to Programs
      </button>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12.5px] text-slate-400">{drill.yearLevel} — {drill.program}</p>
        <button onClick={() => setShowBulkUpload(true)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80">
          <UploadCloud size={14} /> Bulk Upload Grades
        </button>
      </div>
      <div className="bg-white border border-[#e6ecf5] rounded-xl overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-[#f7f9fc]">
            <tr>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">Scholar ID</th>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500">Name</th>
              <th className="text-left px-4 py-2.5 font-bold text-[11.5px] uppercase tracking-wide text-slate-500"></th>
            </tr>
          </thead>
          <tbody>
            {scholarsInScope.map(s => (
              <tr key={s.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc]">
                <td className="px-4 py-2.5 text-slate-700">{s.scholarIdNumber}</td>
                <td className="px-4 py-2.5 font-semibold text-[#062444]">{displayName(s)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => setViewingScholar(s)} className="text-[#0088cc] font-semibold hover:underline">Enter Grades</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewingScholar && (
        <ScholarGradeEntryModal scholar={viewingScholar} onClose={() => setViewingScholar(null)} />
      )}
      {showBulkUpload && drill.level === "scholars" && (
        <BulkGradeUploadModal
          scholars={scholarsInScope}
          onClose={() => setShowBulkUpload(false)}
          onDone={reload}
        />
      )}
    </div>
  );
}
