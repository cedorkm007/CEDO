import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Pencil, X } from "lucide-react";
import { scholarName, programOf, yearLevelOf, pageWindow, SCHOLARS_PAGE_SIZE, type ScholarRowData } from "../portalLogic";
import { StatusChip, StandingChip, fieldClass, focusRing, linkButton } from "./portalParts";
import { OutcomeCountChips } from "@/app/components/OutcomeBadge";
import type { SchoolScholarRow } from "../types";

const TH = "text-left px-4 py-3 font-bold text-[13px] uppercase tracking-wide text-slate-700 whitespace-nowrap";

/**
 * The school's own number for the scholar (the STUDENT NO. of its promotional report). The school can type or correct it right here;
 * the upload uses it to find the scholar.
 */
function SchoolIdCell({ scholar, onSave }: { scholar: SchoolScholarRow; onSave?: (scholarIdNumber: string, value: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState<string | null>(null);      // shown until the reloaded list arrives
  useEffect(() => { setJustSaved(null); }, [scholar.schoolStudentNo]);
  const current = justSaved ?? scholar.schoolStudentNo;
  const name = scholarName(scholar);
  async function save() {
    if (!onSave) return;
    setBusy(true); setError("");
    const problem = await onSave(scholar.scholarIdNumber, value);
    setBusy(false);
    if (problem) { setError(problem); return; }
    setJustSaved(value.trim());
    setEditing(false);
  }
  if (editing) {
    return (
      <div className="min-w-[10rem] max-w-[15rem] whitespace-normal">
        <div className="flex items-center gap-1">
          <input value={value} onChange={e => setValue(e.target.value)} maxLength={40} autoFocus disabled={busy} aria-label={`School ID of ${name}`}
            onKeyDown={e => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
            className="w-32 rounded-md border border-[#062444]/30 px-2 py-1 text-[14px] outline-none focus:border-[#062444]" />
          <button onClick={() => void save()} disabled={busy} aria-label={`Save the School ID of ${name}`} className="rounded-md p-1 text-green-800 hover:bg-green-50 disabled:opacity-50"><Check size={16} aria-hidden="true" /></button>
          <button onClick={() => setEditing(false)} disabled={busy} aria-label="Cancel" className="rounded-md p-1 text-slate-700 hover:bg-slate-100"><X size={16} aria-hidden="true" /></button>
        </div>
        {error && <p role="alert" className="mt-1 max-w-[14rem] text-[13px] text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {current ? <span>{current}</span> : <span className="text-slate-600">—</span>}
      {onSave && (
        <button onClick={() => { setValue(current); setError(""); setEditing(true); }} aria-label={`${current ? "Change" : "Add"} the School ID of ${name}`}
          className="rounded-md p-1 text-[#0077b6] hover:bg-[#f0f6fb]"><Pencil size={14} aria-hidden="true" /></button>
      )}
    </span>
  );
}

/**
 * One table of scholars: Scholar ID, School ID, Name, Program, Year, Subjects, Graded, Status, GWA, Actions.
 * Used for the "Table view", for search results, and at the last level of the year-level / program drill-down,
 * so the same columns and chips appear everywhere. Scrolls sideways on a phone instead of squeezing.
 */
export function ScholarsTable({ rows, editable, gradingReady, onOpen, empty, showStanding = false, onSetSchoolId, resetKey = "" }: {
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
  /** Saves the School ID of a scholar; returns a message when it could not be saved. Without it the column is read-only. */
  onSetSchoolId?: (scholarIdNumber: string, value: string) => Promise<string | null>;
  /** The list is shown 50 to a page. When this changes (another search, filter or program) the list starts again at page 1; a re-read of the same list keeps the page. */
  resetKey?: string;
}) {
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { setPage(1); }, [resetKey]);
  if (rows.length === 0) {
    return <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-8 text-center text-[14.5px] text-slate-800">{empty}</div>;
  }
  const canEnter = editable && gradingReady;
  const win = pageWindow(rows.length, page);
  const shown = rows.slice(win.start, win.end);
  const goTo = (p: number) => { setPage(p); top.current?.scrollIntoView({ block: "start" }); };
  return (
    <div ref={top} className="scroll-mt-4">
    <div className="relative bg-white border border-[#e6ecf5] rounded-xl overflow-x-auto">
      <table className="w-full min-w-[1080px] text-[14.5px]">
        <caption className="sr-only">Scholars of your school with their subjects, grading progress, status and GWA for the selected period</caption>
        <thead className="bg-[#f7f9fc]">
          <tr>
            <th scope="col" className={TH}>Scholar ID</th>
            <th scope="col" className={TH}>School ID</th>
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
          {shown.map(({ scholar: s, summary, status, standing, outcomes }) => (
            <tr key={s.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc]">
              <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{s.scholarIdNumber}</td>
              <td className="px-4 py-3 text-slate-800 whitespace-nowrap"><SchoolIdCell scholar={s} onSave={onSetSchoolId} /></td>
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
                {outcomes && <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle"><OutcomeCountChips counts={outcomes} /></span>}
              </td>
              <td className="px-4 py-3 text-slate-800 whitespace-nowrap">{summary.subjects === 0 ? "—" : `${summary.graded} of ${summary.subjects}`}</td>
              <td className="px-4 py-3"><StatusChip status={status} /></td>
              <td className="px-4 py-3 font-semibold text-[#062444]">{summary.gwaText}</td>
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
    {rows.length > SCHOLARS_PAGE_SIZE && (
      <nav aria-label="Pages of scholars" className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[14px] text-slate-800">
        <span aria-live="polite">Showing {win.start + 1}–{win.end} of {rows.length} scholars</span>
        <span className="flex flex-wrap items-center gap-2">
          <button onClick={() => goTo(win.page - 1)} disabled={win.page <= 1} className={`rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 font-semibold text-[#062444] disabled:opacity-50 ${focusRing}`}>Previous</button>
          {win.pages > 6 ? (
            <label className="flex items-center gap-1.5">Page
              <select value={win.page} onChange={e => goTo(Number(e.target.value))} aria-label="Go to page" className={`${fieldClass} py-1`}>
                {Array.from({ length: win.pages }, (_, k) => <option key={k + 1} value={k + 1}>{k + 1}</option>)}
              </select> of {win.pages}
            </label>
          ) : <span>Page {win.page} of {win.pages}</span>}
          <button onClick={() => goTo(win.page + 1)} disabled={win.page >= win.pages} className={`rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 font-semibold text-[#062444] disabled:opacity-50 ${focusRing}`}>Next</button>
        </span>
      </nav>
    )}
    </div>
  );
}
