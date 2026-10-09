import { useEffect, useMemo, useState } from "react";
import { ChevronRight, BookMarked, Info } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { fetchMyGradingConfig, fetchMyLetterGrades, fetchCurrentGradingPeriod } from "../../scholarApi";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { ALL_PERIODS_KEY, normalizeTerm, periodKey, periodOptions, termLabel, type AcademicPeriod, type PeriodRef } from "@/lib/academicPeriods";
import { computeGwa, formatGwa, type LetterGrade } from "@/lib/gwa";
import type { SubjectGrade } from "../../types";

/**
 * A scholar's own subjects and grades, grouped by period. Phase 2: a period dropdown. It starts on the
 * Current Grading Period when the scholar has grades in it, otherwise on "All periods" so an older
 * scholar never lands on an empty screen. The options are the periods this scholar actually has grades in
 * (plus the current one), so nothing about other scholars or unused periods is revealed.
 */
export function SubjectsGradesPanel({ grades }: { grades: SubjectGrade[] }) {
  const [letterGrades, setLetterGrades] = useState<LetterGrade[]>([]);
  const [current, setCurrent] = useState<PeriodRef>({ schoolYear: "", semester: "" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    fetchMyGradingConfig().then(config => {
      if (config?.usesLetterGrades) fetchMyLetterGrades().then(setLetterGrades);
    });
    fetchCurrentGradingPeriod().then(setCurrent);
  }, []);

  const currentKey = current.schoolYear ? periodKey(current.schoolYear, current.semester) : "";

  // Periods this scholar has grades in, as pseudo-periods just to reuse the shared dropdown labels.
  const options = useMemo(() => {
    const seen = new Map<string, AcademicPeriod>();
    for (const g of grades) {
      const key = periodKey(g.schoolYear, g.semester);
      const term = normalizeTerm(g.semester);
      if (!seen.has(key) && term) seen.set(key, { id: key, schoolYear: g.schoolYear.trim(), term, status: "closed", deadline: null });
    }
    if (currentKey && !seen.has(currentKey)) {
      const term = normalizeTerm(current.semester);
      if (term) seen.set(currentKey, { id: currentKey, schoolYear: current.schoolYear.trim(), term, status: "closed", deadline: null });
    }
    return periodOptions(Array.from(seen.values()), current, { includeAll: true });
  }, [grades, current, currentKey]);

  const hasGradesInCurrent = grades.some(g => periodKey(g.schoolYear, g.semester) === currentKey);
  const defaultKey = currentKey && hasGradesInCurrent ? currentKey : ALL_PERIODS_KEY;
  const effectiveKey = selectedKey && options.some(o => o.key === selectedKey) ? selectedKey : defaultKey;

  const visibleGrades = useMemo(
    () => (effectiveKey === ALL_PERIODS_KEY ? grades : grades.filter(g => periodKey(g.schoolYear, g.semester) === effectiveKey)),
    [grades, effectiveKey],
  );

  const groups = useMemo(() => {
    const map = new Map<string, SubjectGrade[]>();
    for (const g of visibleGrades) {
      const term = normalizeTerm(g.semester);
      const key = `${g.schoolYear} — ${term ? termLabel(term) : g.semester}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return Array.from(map.entries());
  }, [visibleGrades]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  // Open the first group unless the scholar has opened/closed one themselves.
  const shownOpenKey = openKey !== null && groups.some(([k]) => k === openKey) ? openKey : openKey === "" ? null : (groups[0]?.[0] ?? null);

  return (
    <SectionCard icon={<BookMarked size={14} />} title="Subjects and Grades">
      {grades.length === 0 ? (
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <Info size={14} /> No subjects or grades have been recorded yet — CEDO staff updates this after each grading period.
        </p>
      ) : (
        <>
        <PeriodSelect label="Period" options={options} value={effectiveKey} onChange={setSelectedKey} className="mb-4" />
        {groups.length === 0 && (
          <p className="text-sm text-slate-600 flex items-center gap-2 mb-3">
            <Info size={14} /> No subjects or grades for this period yet. Pick another period, or "All periods".
          </p>
        )}
        {groups.map(([key, rows]) => {
          const open = shownOpenKey === key;
          const gwa = computeGwa(rows, letterGrades);
          return (
            <div key={key} className="border border-[#e6ecf5] rounded-xl mb-3 overflow-hidden">
              <button
                onClick={() => setOpenKey(open ? "" : key)}
                className="w-full flex items-center justify-between gap-2.5 bg-[#f7f9fc] hover:bg-[#eef3fb] px-4 py-3.5 text-left transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <ChevronRight size={15} className={`text-[#0088cc] transition-transform ${open ? "rotate-90" : ""}`} />
                  <span className="font-bold text-sm text-[#062444]">{key}</span>
                </span>
                <span className="text-[12px] font-semibold text-slate-500">GWA: <span className="text-[#062444]">{formatGwa(gwa)}</span><span className="font-normal"> (weighted by units)</span></span>
              </button>
              {open && (
                <div className="px-4 pb-4 pt-1 overflow-x-auto">
                  <table className="w-full text-[13.5px] border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Subject Code</th>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Subject</th>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Units</th>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Grade</th>
                        <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} className="hover:bg-[#f7f9fc]">
                          <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">{r.subjectCode || "—"}</td>
                          <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">
                            {r.subject}
                            {r.excludeFromGwa && <span className="ml-2 text-[11px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">not in GWA</span>}
                          </td>
                          <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">{r.units ?? "—"}</td>
                          <td className="py-2.5 border-b border-[#f0f3f8] font-semibold text-[#062444]">{r.grade || "—"}</td>
                          <td className="py-2.5 border-b border-[#f0f3f8] text-slate-500">{r.remarks || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        </>
      )}
    </SectionCard>
  );
}
