import { CalendarDays } from "lucide-react";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { deadlineSummary, statusLabel, termLabel, normalizeTerm } from "@/lib/academicPeriods";
import { periodProgressLabel } from "../portalLogic";
import { linkButton } from "./portalParts";
import type { SchoolData } from "../useSchoolData";

/**
 * Always visible under the header: which period the school is working on, a way to change it, the deadline
 * (with days left) and where the school is in this period. Schools must always know which period they are
 * entering grades for.  Wording follows the owner's brief:
 *   School Year 2026-2027 · 1st Semester  [change v]   Deadline: Nov 15 (12 days left)   Status: In progress
 */
export function SchoolPeriodBar({ data }: { data: SchoolData }) {
  const { period, periodRecord, options, selectedKey, currentKey, selectPeriod, counts, editable } = data;
  const term = normalizeTerm(period.semester);
  const deadline = periodRecord ? deadlineSummary(periodRecord.deadline, new Date()) : null;
  const progress = periodProgressLabel(counts);

  return (
    <div className="bg-[#f7f9fc] border-b border-[#e6ecf5] px-4 md:px-8 py-3" role="region" aria-label="Grading period">
      <div className="max-w-[1100px] mx-auto flex flex-wrap items-center gap-x-6 gap-y-2.5">
        <p className="flex items-center gap-2 text-[15px] font-bold text-[#062444]">
          <CalendarDays size={17} className="text-[#0077b6] shrink-0" aria-hidden="true" />
          {period.schoolYear
            ? <span>School Year {period.schoolYear} · {term ? termLabel(term) : period.semester}</span>
            : <span>No grading period selected</span>}
        </p>
        <PeriodSelect label="Change period" options={options} value={selectedKey} onChange={selectPeriod} />
        {currentKey && selectedKey !== currentKey && (
          <button onClick={() => selectPeriod(null)} className={`text-[14px] ${linkButton}`}>Back to the current period</button>
        )}
        {deadline && <span className="text-[14px] text-slate-800">{deadline}</span>}
        {periodRecord && (
          <span className="text-[14px] text-slate-800">
            Status: <strong className="text-[#062444]">{progress}</strong>
            {!editable && <span className="ml-2 text-[13px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5">{statusLabel(periodRecord.status)} period</span>}
          </span>
        )}
      </div>
    </div>
  );
}
