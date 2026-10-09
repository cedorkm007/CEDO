import { AlertTriangle } from "lucide-react";
import { formatGwa } from "@/lib/gwa";
import { scholarName, programOf, yearLevelOf, type ScholarRowData } from "../portalLogic";
import { StatusChip, StandingChip, linkButton } from "./portalParts";
import type { SchoolScholarRow } from "../types";

const TH = "text-left px-4 py-3 font-bold text-[13px] uppercase tracking-wide text-slate-700 whitespace-nowrap";

/**
 * One table of scholars: Scholar ID, Name, Program, Year, Subjects, Graded, Status, GWA, Actions.
 * Used for the "Table view", for search results, and at the last level of the year-level / program drill-down,
 * so the same columns and chips appear everywhere. Scrolls sideways on a phone instead of squeezing.
 */
export function ScholarsTable({ rows, editable, gradingReady, onOpen, empty, showStanding = false }: {
  rows: ScholarRowData[];
  /** The selected period is Open (grades may be entered). */
  editable: boolean;
  /** The school has saved its grading scale (required before entering grades). */
  gradingReady: boolean;
  onOpen: (scholar: SchoolScholarRow) => void;
  /** Shown instead of the table when there is nothing to list. */
  empty: React.ReactNode;
  /** Show the scholarship Standing column (only when the school has saved a retention requirement). */
  showStanding?: boolean;
}) {
  if (rows.length === 0) {
    return <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-8 text-center text-[14.5px] text-slate-800">{empty}</div>;
  }
  const canEnter = editable && gradingReady;
  return (
    <div className="relative bg-white border border-[#e6ecf5] rounded-xl overflow-x-auto">
      <table className="w-full min-w-[980px] text-[14.5px]">
        <caption className="sr-only">Scholars of your school with their subjects, grading progress, status and GWA for the selected period</caption>
        <thead className="bg-[#f7f9fc]">
          <tr>
            <th scope="col" className={TH}>Scholar ID</th>
            <th scope="col" className={TH}>Name</th>
            <th scope="col" className={TH}>Program</th>
            <th scope="col" className={TH}>Year</th>
            <th scope="col" className={TH}>Subjects</th>
            <th scope="col" className={TH}>Graded</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={TH}>GWA</th>
            {showStanding && <th scope="col" className={TH}>Standing</th>}
            <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ scholar: s, summary, status, standing }) => (
            <tr key={s.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc]">
              <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{s.scholarIdNumber}</td>
              <td className="px-4 py-3 font-semibold text-[#062444]">{scholarName(s)}</td>
              <td className="px-4 py-3 text-slate-800">{programOf(s)}</td>
              <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{yearLevelOf(s)}</td>
              <td className="px-4 py-3 text-slate-800">
                {summary.subjects === 0 ? <span className="text-slate-700">None yet</span> : summary.subjects}
                {summary.missingUnits > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[13px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5"
                    title="These subjects have no units yet and count as 1 unit in the GWA">
                    <AlertTriangle size={12} aria-hidden="true" /> {summary.missingUnits} need units
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{summary.subjects === 0 ? "—" : `${summary.graded} of ${summary.subjects}`}</td>
              <td className="px-4 py-3"><StatusChip status={status} /></td>
              <td className="px-4 py-3 font-semibold text-[#062444]">{formatGwa(summary.gwa)}</td>
              {showStanding && <td className="px-4 py-3"><StandingChip standing={standing} /></td>}
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <button onClick={() => onOpen(s)} className={`${linkButton} text-[14.5px]`}
                  aria-label={`${canEnter ? "Enter grades" : "View grades"} for ${scholarName(s)}`}>
                  {canEnter ? "Enter grades" : "View grades"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
