import { MarksGuide } from "@/app/components/MarksGuide";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { GradingConfig, LetterGrade } from "@/lib/gwa";
import { classifyGrade, countOutcomes, isFailed, outcomeSummaryText } from "@/lib/subjectOutcome";
import { describeRow, periodGwa, rulesAt, type RuleVersion } from "@/lib/rulesRuntime";
import { OutcomeBadge, outcomeRowClass } from "@/app/components/OutcomeBadge";

export interface StaffGradeRow {
  id: string;
  schoolYear: string;
  semester: string;
  subjectCode: string;
  subject: string;
  grade: string;
  units?: number | null;
  excludeFromGwa?: boolean;
  remarks?: string;
  /** The percentage, when the school enters percentages. */
  percentage?: number | null;
}

/** Grouped-by-School-Year+Semester grades matrix with a computed GWA per group — the staff-side counterpart to the scholar portal's SubjectsGradesPanel, using the same periodGwa() (src/lib/rulesRuntime.ts) as the school and the scholar, so every side always agrees. */
export function ScholarGradesTable({ grades, letterGrades, config = null, ruleVersions = [], program = "" }: {
  grades: StaffGradeRow[]; letterGrades: LetterGrade[]; config?: GradingConfig | null;
  /** The grading rules the scholar's school saved, by the semester they start at: each semester is read with the rules that applied to it. */
  ruleVersions?: RuleVersion[]; program?: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, StaffGradeRow[]>();
    for (const g of grades) {
      const key = `${g.schoolYear} — ${g.semester}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return Array.from(map.entries());
  }, [grades]);

  const [openKey, setOpenKey] = useState<string | null>(groups[0]?.[0] ?? null);

  if (grades.length === 0) {
    return <p className="text-[13px] text-slate-400 text-center py-8">No subjects or grades have been recorded for this scholar yet.</p>;
  }

  return (
    <div>
      <MarksGuide marks={letterGrades} className="mb-3" />
      {groups.map(([key, rows]) => {
        const open = openKey === key;
        const rules = rulesAt(ruleVersions, rows[0].schoolYear, rows[0].semester);
        const gwa = periodGwa(rows, letterGrades, rules, r => isFailed(classifyGrade(r.grade, config, letterGrades, rules, program, (r as StaffGradeRow).percentage)));
        const flagged = outcomeSummaryText(countOutcomes(rows, config, letterGrades, rules, program));
        return (
          <div key={key} className="border border-[#e6ecf5] rounded-xl mb-3 overflow-hidden bg-white">
            <button
              onClick={() => setOpenKey(open ? null : key)}
              className="w-full flex items-center justify-between gap-2.5 bg-[#f7f9fc] hover:bg-[#eef3fb] px-4 py-3.5 text-left transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <ChevronRight size={15} className={`text-[#0088cc] transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="font-bold text-sm text-[#062444]">{key}</span>
              </span>
              <span className="text-[13px] font-semibold text-slate-600">
                {flagged && <span className="mr-3 font-bold text-red-800">{flagged}</span>}
                GWA: <span className="text-[#062444]">{gwa.text}</span><span className="font-normal text-slate-600"> ({gwa.settings?.method === "simple" ? "simple average" : "weighted by units"})</span>
              </span>
            </button>
            {open && (
              <div className="px-4 pb-4 pt-1 overflow-x-auto" tabIndex={0} role="region" aria-label={`Subjects and grades, ${key}`}>
                <table className="w-full text-[13.5px] border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Subject Code</th>
                      <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Subject Name</th>
                      <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Units</th>
                      <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Grade</th>
                      <th className="text-left text-[11.5px] uppercase tracking-wide text-[#0088cc] pb-2 border-b-2 border-[#e6ecf5]">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const outcome = classifyGrade(r.grade, config, letterGrades, rules, program, r.percentage);
                      const reading = describeRow({ grade: r.grade, percentage: r.percentage }, rules, program);
                      return (
                      <tr key={r.id} className={`hover:bg-[#f7f9fc] ${outcomeRowClass(outcome)}`}>
                        <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">{r.subjectCode || "—"}</td>
                        <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">
                          {r.subject}
                          {r.excludeFromGwa && <span className="ml-2 text-[11px] font-semibold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">not in GWA</span>}
                        </td>
                        <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700" title={r.units == null ? "No units entered — counted as 1 unit in the GWA" : undefined}>{r.units ?? "—"}</td>
                        <td className="py-2.5 border-b border-[#f0f3f8] font-semibold text-[#062444]">
                          {r.grade || "—"}{r.percentage != null && <span className="ml-1.5 font-normal text-slate-700">({r.percentage}%)</span>} <span className="ml-1.5"><OutcomeBadge outcome={outcome} /></span>
                        </td>
                        <td className="py-2.5 border-b border-[#f0f3f8] text-slate-700">{[reading?.remarks, r.remarks].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
