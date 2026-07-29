import { useMemo, useState } from "react";
import { ChevronRight, BookMarked, Info } from "lucide-react";
import { SectionCard } from "./SectionCard";
import type { SubjectGrade } from "../../types";

export function SubjectsGradesPanel({ grades }: { grades: SubjectGrade[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, SubjectGrade[]>();
    for (const g of grades) {
      const key = `${g.schoolYear} — ${g.semester}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return Array.from(map.entries());
  }, [grades]);

  const [openKey, setOpenKey] = useState<string | null>(groups[0]?.[0] ?? null);

  return (
    <SectionCard icon={<BookMarked size={14} />} title="Subjects and Grades">
      {grades.length === 0 ? (
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <Info size={14} /> No subjects or grades have been recorded yet — CEDO staff updates this after each grading period.
        </p>
      ) : (
        groups.map(([key, rows]) => {
          const open = openKey === key;
          return (
            <div key={key} className="border border-[#e6ecf5] rounded-xl mb-3 overflow-hidden">
              <button
                onClick={() => setOpenKey(open ? null : key)}
                className="w-full flex items-center gap-2.5 bg-[#f7f9fc] hover:bg-[#eef3fb] px-4 py-3.5 text-left transition-colors"
              >
                <ChevronRight size={15} className={`text-[#0088cc] transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="font-bold text-sm text-[#062444]">{key}</span>
              </button>
              {open && (
                <div className="px-4 pb-4 pt-1 overflow-x-auto">
                  <table className="w-full text-[13.5px] border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Subject</th>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Grade</th>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} className="hover:bg-[#f7f9fc]">
                          <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">{r.subject}</td>
                          <td className="py-2.5 border-b border-[#f0f3f8] font-semibold text-[#062444]">{r.grade}</td>
                          <td className="py-2.5 border-b border-[#f0f3f8] text-slate-500">{r.remarks || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </SectionCard>
  );
}
