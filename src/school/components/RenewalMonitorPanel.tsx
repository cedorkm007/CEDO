import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, Search, ShieldAlert, XCircle } from "lucide-react";
import { useLiveReload } from "@/lib/liveUpdates";
import { formatDay, termLabelOf, windowState, type WindowState } from "@/lib/renewal";
import {
  fetchSchoolRenewalRows, fetchSchoolRenewalSummary, fetchSchoolRenewalWindows, type SchoolRenewalWindow,
} from "../renewalMonitorApi";
import {
  EMPTY_FILTERS, FILTER_BUTTONS, GROUP_HINT, PAGE_SIZE, countFor, filterRows, fullName, gradesText, needsClearance, pageCount, pageOf, programOptions, renewalProgress,
  yearLevelOptions, type RenewalFilterKey, type RenewalFilters, type RenewalGroup, type SchoolRenewalRow, type SchoolRenewalSummary,
} from "../renewalMonitorLogic";
import { fieldClass, focusRing } from "./portalParts";
import { ClearanceDownloadMenu } from "./ClearanceDownloadMenu";

const WINDOW_STATE_TEXT: Record<WindowState, string> = { upcoming: "not open yet", open: "open", late: "closed, late applications accepted", closed: "closed" };
const TH = "text-left px-3 py-3 font-bold text-[13px] uppercase tracking-wide text-slate-700 whitespace-nowrap";
const SEGMENT_COLOR: Record<string, string> = { renewed: "bg-green-600", removed: "bg-red-700", applied: "bg-amber-500", not_applied: "bg-slate-400" };

/** A group as a chip with its words (colour is never the only signal). */
function GroupChip({ group, isLate }: { group: RenewalGroup; isLate: boolean }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-bold border rounded-full px-2.5 py-0.5";
  const chip: Record<RenewalGroup, { cls: string; icon: React.ReactNode; text: string }> = {
    in_process: { cls: "text-amber-900 bg-amber-50 border-amber-300", icon: <Clock size={13} aria-hidden="true" />, text: "Applied" },
    renewed: { cls: "text-green-900 bg-green-50 border-green-300", icon: <CheckCircle2 size={13} aria-hidden="true" />, text: "Renewed" },
    removed: { cls: "text-red-900 bg-red-50 border-red-300", icon: <XCircle size={13} aria-hidden="true" />, text: "Removed" },
    not_applied: { cls: "text-slate-800 bg-slate-100 border-slate-300", icon: <CircleDashed size={13} aria-hidden="true" />, text: "Not applied yet" },
    not_required: { cls: "text-slate-800 bg-slate-100 border-slate-300", icon: <CircleDashed size={13} aria-hidden="true" />, text: "Not required" },
  };
  const c = chip[group];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" title={GROUP_HINT[group]}>
      <span className={`${base} ${c.cls}`}>{c.icon} {c.text}</span>
      {isLate && group === "in_process" && <span className="text-[13px] font-semibold text-amber-900">late</span>}
    </span>
  );
}

function GradesChip({ row }: { row: SchoolRenewalRow }) {
  const text = gradesText(row);
  const bad = row.failed > 0 || row.inc > 0;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold ${bad ? "text-red-900" : row.review > 0 ? "text-amber-900" : "text-slate-800"}`}>
      {bad && <AlertTriangle size={13} aria-hidden="true" />}{text}
    </span>
  );
}

/**
 * The School Portal's Renewal tab: where the school's scholars are in a renewal (applied, renewed, on probation, removed, not applied yet), a progress bar of how many are finished,
 * and filters by name, year level and program. Read-only: the school sees only its own scholars, only their renewal status and grade result (supabase_migration_school_renewal_tab.sql).
 */
export function RenewalMonitorPanel({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const [windows, setWindows] = useState<SchoolRenewalWindow[] | null>(null);
  const [windowKey, setWindowKey] = useState("");
  const [rows, setRows] = useState<SchoolRenewalRow[] | null>(null);
  const [summary, setSummary] = useState<SchoolRenewalSummary | null>(null);
  const [filters, setFilters] = useState<RenewalFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  // the windows that apply to the school; the open one (or the latest) is chosen first
  useEffect(() => {
    let cancelled = false;
    void fetchSchoolRenewalWindows().then(r => {
      if (cancelled) return;
      if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
      setWindows(r.windows);
      const pick = r.windows.find(w => windowState(w.opensOn, w.closesOn, w.lateAllowed) === "open") ?? r.windows[0];
      if (pick) setWindowKey(`${pick.schoolYear}|${pick.term}`);
    });
    return () => { cancelled = true; };
  }, []);

  const chosen = useMemo(() => windows?.find(w => `${w.schoolYear}|${w.term}` === windowKey) ?? null, [windows, windowKey]);

  const load = useCallback(async () => {
    if (!chosen) return;
    const [l, s] = await Promise.all([fetchSchoolRenewalRows(chosen.schoolYear, chosen.term), fetchSchoolRenewalSummary(chosen.schoolYear, chosen.term)]);
    if (!l.ok) { if (l.missing) setMissing(true); else setError(l.error); return; }
    setError("");
    setRows(l.rows);
    if (s.ok) setSummary(s.summary);
  }, [chosen]);
  useEffect(() => { setRows(null); setSummary(null); setPage(1); setFilters(EMPTY_FILTERS); void load(); }, [load]);
  useLiveReload(async () => { await load(); });      // a decision or a new application: update in place

  const years = useMemo(() => yearLevelOptions(rows ?? []), [rows]);
  const programs = useMemo(() => programOptions(rows ?? []), [rows]);
  const shown = useMemo(() => filterRows(rows ?? [], filters), [rows, filters]);
  const totalPages = pageCount(shown.length);
  const pageRows = useMemo(() => pageOf(shown, Math.min(page, totalPages)), [shown, page, totalPages]);
  const progress = summary ? renewalProgress(summary) : null;
  const change = (patch: Partial<RenewalFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const clearanceRows = useMemo(() => shown.filter(needsClearance), [shown]);
  const anyFilter = filters.filter !== "all" || filters.query !== "" || filters.yearLevel !== "" || filters.program !== "";
  const wordsFor = (w: SchoolRenewalWindow) => `${termLabelOf(w.schoolYear, w.term)} (${WINDOW_STATE_TEXT[windowState(w.opensOn, w.closesOn, w.lateAllowed)]})`;

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[14.5px] text-amber-950">The Renewal tab needs a database update from CEDO (supabase_migration_school_renewal_tab.sql). Until it is done, this tab cannot show the renewal.</p>;
  if (error) return <p role="alert" className="text-[14.5px] text-red-800">{error}</p>;
  if (windows === null) return <p className="flex items-center gap-2 text-[14.5px] text-slate-800"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  if (windows.length === 0) return <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-8 text-center text-[14.5px] text-slate-800">CEDO has not opened a renewal for your school yet. When it does, your scholars' renewal will show here.</div>;

  return (
    <div>
      {/* which renewal */}
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <label htmlFor="renewal-window" className="block text-[14px] font-semibold text-[#062444] mb-1">Renewal</label>
          <select id="renewal-window" value={windowKey} onChange={e => setWindowKey(e.target.value)} className={fieldClass}>
            {windows.map(w => <option key={`${w.schoolYear}|${w.term}`} value={`${w.schoolYear}|${w.term}`}>{wordsFor(w)}</option>)}
          </select>
        </div>
        {chosen && <p className="text-[14px] text-slate-800 pb-2">Applications {formatDay(chosen.opensOn)} to {formatDay(chosen.closesOn)}.{summary?.basisSchoolYear ? ` Grades are judged for ${termLabelOf(summary.basisSchoolYear, summary.basisTerm)}.` : ""}</p>}
      </div>

      {/* the progress bar */}
      <section aria-label="Renewal progress" className="mb-5 rounded-xl border border-[#e6ecf5] bg-white px-4 py-4">
        {!progress ? <p className="flex items-center gap-2 text-[14.5px] text-slate-800"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
          <>
            <p className="text-[15px] font-bold text-[#062444]" role="status">{progress.processed} of {progress.total} scholars are done with the renewal ({progress.percent}%)</p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={`${progress.processed} of ${progress.total} scholars done with the renewal`}
              className="mt-2 flex h-3.5 w-full overflow-hidden rounded-full bg-[#e6ecf5]">
              {progress.segments.map(s => s.percent > 0 && <div key={s.key} className={SEGMENT_COLOR[s.key]} style={{ width: `${s.percent}%` }} title={`${s.label}: ${s.count}`} />)}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-slate-900">
              {progress.segments.map(s => (
                <li key={s.key} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded-sm ${SEGMENT_COLOR[s.key]}`} aria-hidden="true" /> {s.label}: <strong>{s.count}</strong></li>
              ))}
            </ul>
            <p className="mt-2 text-[13.5px] text-slate-700">Done = renewed, removed, or no renewal needed. {summary && summary.withIncOrFailed > 0 && <><ShieldAlert size={13} className="inline -mt-0.5 text-red-800" aria-hidden="true" /> <strong>{summary.withIncOrFailed}</strong> scholar{summary.withIncOrFailed === 1 ? " has" : "s have"} an INC or a failed grade.</>}</p>
          </>
        )}
      </section>

      {/* the groups */}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show scholars by renewal status">
        {FILTER_BUTTONS.filter(b => b.key !== "not_required" || (summary?.notRequired ?? 0) > 0).map(b => {
          const on = filters.filter === b.key;
          return (
            <button key={b.key} onClick={() => change({ filter: b.key as RenewalFilterKey })} aria-pressed={on}
              className={`rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${focusRing} ${on ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/30 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
              {b.label} <span className={`ml-1 font-bold ${on ? "text-[#F3BC00]" : "text-[#0077b6]"}`}>{summary ? countFor(summary, b.key) : "…"}</span>
            </button>
          );
        })}
      </div>

      {/* the filters */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
          <input value={filters.query} onChange={e => change({ query: e.target.value })} placeholder="Search name or ID" aria-label="Search scholars by name or ID" className={`${fieldClass} w-full pl-9`} />
        </div>
        <select aria-label="Year level" value={filters.yearLevel} onChange={e => change({ yearLevel: e.target.value })} className={fieldClass}>
          <option value="">All year levels</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select aria-label="Program" value={filters.program} onChange={e => change({ program: e.target.value })} className={fieldClass}>
          <option value="">All programs</option>
          {programs.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {anyFilter && <button onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }} className={`text-left text-[14px] font-semibold text-[#0077b6] hover:underline ${focusRing} rounded px-1`}>Clear all filters</button>}
      </div>

      {/* the pre-filled clearances: the scholars in the list with an INC or a failed grade */}
      {clearanceRows.length > 0 && summary && (
        <div className="mb-4">
          <ClearanceDownloadMenu rows={clearanceRows} schoolId={schoolId} schoolName={schoolName} basisSchoolYear={summary.basisSchoolYear} basisTerm={summary.basisTerm} />
        </div>
      )}

      {/* the list */}
      {!rows ? <p className="flex items-center gap-2 text-[14.5px] text-slate-800"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : shown.length === 0 ? <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-8 text-center text-[14.5px] text-slate-800">{anyFilter ? "No scholar matches these filters." : "No scholars in this renewal yet."}</div>
      : (
        <>
          <div className="relative bg-white border border-[#e6ecf5] rounded-xl overflow-x-auto">
            <table className="w-full min-w-[1000px] text-[14.5px]">
              <caption className="sr-only">Your scholars in the renewal of {chosen ? termLabelOf(chosen.schoolYear, chosen.term) : ""}: renewal status and grade result</caption>
              <thead className="bg-[#f7f9fc]">
                <tr>
                  <th scope="col" className={TH}>Scholar ID</th>
                  <th scope="col" className={TH}>School ID</th>
                  <th scope="col" className={TH}>Name</th>
                  <th scope="col" className={TH}>Year</th>
                  <th scope="col" className={TH}>Program</th>
                  <th scope="col" className={TH}>Scholarship</th>
                  <th scope="col" className={TH}>Renewal</th>
                  <th scope="col" className={TH}>Grades</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => (
                  <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc] align-top">
                    <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{r.scholarIdNumber}</td>
                    <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{r.schoolStudentNo || "—"}</td>
                    <td className="px-3 py-3 font-semibold text-[#062444]">{fullName(r)}</td>
                    <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{r.yearLevel || "—"}</td>
                    <td className="px-3 py-3 text-slate-800">{r.program || "—"}</td>
                    <td className="px-3 py-3 text-slate-800 whitespace-nowrap">{r.probation ? <span className="inline-flex items-center gap-1 text-[13px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5"><AlertTriangle size={13} aria-hidden="true" /> Probationary</span> : (r.scholarStatus || "—")}</td>
                    <td className="px-3 py-3"><GroupChip group={r.group} isLate={r.isLate} /></td>
                    <td className="px-3 py-3"><GradesChip row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[14px] text-slate-800">
            <span>Showing {(Math.min(page, totalPages) - 1) * PAGE_SIZE + 1}–{Math.min(Math.min(page, totalPages) * PAGE_SIZE, shown.length)} of {shown.length} scholars{shown.filter(needsClearance).length > 0 ? ` · ${shown.filter(needsClearance).length} with an INC or failed grade` : ""}</span>
            <span className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className={`rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 font-semibold text-[#062444] disabled:opacity-50 ${focusRing}`}>Previous</button>
              <span>Page {Math.min(page, totalPages)} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className={`rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 font-semibold text-[#062444] disabled:opacity-50 ${focusRing}`}>Next</button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
