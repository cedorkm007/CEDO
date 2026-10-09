import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Paperclip } from "lucide-react";
import { Modal } from "../components/Modal";
import { ScholarGradesTable } from "../components/ScholarGradesTable";
import {
  fetchScholarGradesForStaff, fetchScholarGradingConfigForStaff, fetchScholarLetterGradesForStaff,
  type MonitoringScholarRow, type LetterGrade, type GradingPeriod,
} from "../scholarsGradesMonitoringApi";
import {
  fetchAllMatching, fetchFilterOptions, fetchSchoolSetups, fetchSchoolSummaries, fetchScholarsPage, loadScholarStandings,
  type SchoolSetup, type SchoolSummary, type ScholarFilters, type ScholarStandingInfo, type StaffScholar,
} from "../scholarsMonitoringData";
import type { StaffGradeRow } from "../components/ScholarGradesTable";
import { periodKey, periodTitle } from "@/lib/academicPeriods";
import { STANDING_LABEL, type StandingResult } from "@/lib/standing";
import { StandingChip } from "@/school/components/portalParts";
import { GradeDocumentsList, GradeHistoryList, HistoryHeading } from "@/app/components/GradeEvidence";
import { fetchGradeAudit, fetchGradeDocuments } from "@/lib/gradeEvidenceApi";
import type { AuditEntry, GradeDocument } from "@/lib/gradeEvidence";

const PAGE_SIZE = 50;
/** When filtering by standing, every matching scholar's grades have to be read; beyond this many CEDO is asked to narrow it down. */
const STANDING_SCAN_CAP = 2000;

type StandingFilter = "" | "good" | "at_risk" | "below";

function displayName(row: MonitoringScholarRow): string {
  const mi = row.middleName.trim() ? `${row.middleName.trim()[0]}.` : "";
  return [`${row.lastName},`, row.firstName, mi].filter(Boolean).join(" ");
}

const SELECT_CLS = "w-full border border-[#062444]/15 rounded-lg px-2.5 py-2 text-[14px] outline-none focus:border-[#0088cc] bg-white";
const LABEL_CLS = "block text-[13px] font-semibold text-slate-600 mb-1";
const TH_CLS = "text-left px-4 py-2.5 font-bold text-[13px] uppercase tracking-wide text-slate-600";

export function ScholarsGradesMonitoringScholarsTab({ period, periodId }: { period: GradingPeriod; periodId: string | null }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [program, setProgram] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [standingFilter, setStandingFilter] = useState<StandingFilter>("");
  const [page, setPage] = useState(0);

  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [setups, setSetups] = useState<Map<string, SchoolSetup> | null>(null);
  const [options, setOptions] = useState<{ programs: string[]; yearLevels: string[] }>({ programs: [], yearLevels: [] });

  const [rows, setRows] = useState<StaffScholar[]>([]);
  const [total, setTotal] = useState(0);
  const [info, setInfo] = useState<Map<string, ScholarStandingInfo>>(new Map());
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<StaffScholar | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    void fetchSchoolSummaries().then(setSchools);
    void fetchSchoolSetups().then(setSetups);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  // The program and year-level lists follow the chosen school.
  useEffect(() => {
    let cancelled = false;
    void fetchFilterOptions(schoolId || undefined).then(o => { if (!cancelled) setOptions(o); });
    return () => { cancelled = true; };
  }, [schoolId]);

  // Any change to the filters, the viewed period or the standing filter starts again from the first page.
  const filterKey = `${debounced}|${schoolId}|${program}|${yearLevel}|${standingFilter}|${period.schoolYear}|${period.semester}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) { lastFilterKey.current = filterKey; setPage(0); }
  }, [filterKey]);

  const filters: ScholarFilters = useMemo(
    () => ({ search: debounced, schoolId, program, yearLevel }),
    [debounced, schoolId, program, yearLevel],
  );
  const scanning = standingFilter !== "";

  useEffect(() => {
    if (!setups) return;
    const mine = ++requestId.current;
    setLoading(true);
    setError("");
    (async () => {
      if (scanning) {
        const all = await fetchAllMatching(filters, STANDING_SCAN_CAP);
        if (mine !== requestId.current) return;
        if (!all.ok) { setError(all.error); setLoading(false); return; }
        const st = await loadScholarStandings(all.rows, period, setups);
        if (mine !== requestId.current) return;
        if (!st.ok) { setError(st.error); setLoading(false); return; }
        setRows(all.rows); setInfo(st.byScholar); setTotal(all.total); setCapped(all.capped); setLoading(false);
        return;
      }
      const result = await fetchScholarsPage(filters, PAGE_SIZE, page * PAGE_SIZE);
      if (mine !== requestId.current) return;
      if (!result.ok) { setError(result.error); setLoading(false); return; }
      const st = await loadScholarStandings(result.rows, period, setups);
      if (mine !== requestId.current) return;
      if (!st.ok) { setError(st.error); setLoading(false); return; }
      setRows(result.rows); setInfo(st.byScholar); setTotal(result.total); setCapped(false); setLoading(false);
    })();
  }, [filters, scanning, page, period, setups]);

  // In standing mode the filter and paging happen here, over everything that was read.
  const matching = useMemo(
    () => (scanning ? rows.filter(r => info.get(r.scholarIdNumber)?.standing === standingFilter) : rows),
    [scanning, rows, info, standingFilter],
  );
  const shownTotal = scanning ? matching.length : total;
  const shown = scanning ? matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : matching;
  const pages = Math.max(1, Math.ceil(shownTotal / PAGE_SIZE));
  const first = shownTotal === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(shownTotal, (page + 1) * PAGE_SIZE);
  const anyFilter = !!(debounced || schoolId || program || yearLevel || standingFilter);

  function clearFilters() {
    setSearch(""); setSchoolId(""); setProgram(""); setYearLevel(""); setStandingFilter("");
  }

  return (
    <div>
      <div className="bg-[#f7f9fc] border border-[#e6ecf5] rounded-xl px-4 py-3 mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <label htmlFor="sgm-search" className={LABEL_CLS}>Search by name or Scholar ID</label>
            <div className="relative max-w-md">
              <Search size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input id="sgm-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type a name or ID…"
                className="w-full border border-[#062444]/15 rounded-lg pl-9 pr-3 py-2 text-[14px] outline-none focus:border-[#0088cc] bg-white" />
            </div>
          </div>
          <div>
            <label htmlFor="sgm-school" className={LABEL_CLS}>School</label>
            <select id="sgm-school" value={schoolId} onChange={e => { setSchoolId(e.target.value); setProgram(""); setYearLevel(""); }} className={SELECT_CLS}>
              <option value="">All schools</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sgm-program" className={LABEL_CLS}>Program</label>
            <select id="sgm-program" value={program} onChange={e => setProgram(e.target.value)} className={SELECT_CLS}>
              <option value="">All programs</option>
              {options.programs.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sgm-year" className={LABEL_CLS}>Year level</label>
            <select id="sgm-year" value={yearLevel} onChange={e => setYearLevel(e.target.value)} className={SELECT_CLS}>
              <option value="">All year levels</option>
              {options.yearLevels.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sgm-standing" className={LABEL_CLS}>Scholarship standing ({periodTitle(period)})</label>
            <select id="sgm-standing" value={standingFilter} onChange={e => setStandingFilter(e.target.value as StandingFilter)} className={SELECT_CLS}>
              <option value="">Any standing</option>
              <option value="good">{STANDING_LABEL.good}</option>
              <option value="at_risk">{STANDING_LABEL.at_risk}</option>
              <option value="below">{STANDING_LABEL.below}</option>
            </select>
          </div>
          {anyFilter && (
            <div className="flex items-end">
              <button onClick={clearFilters} className="text-[13.5px] font-semibold text-[#0077b6] hover:underline py-2">Clear all filters</button>
            </div>
          )}
        </div>
      </div>

      {scanning && capped && (
        <p role="status" className="text-[13.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {total.toLocaleString()} scholars match your other filters. Standing was worked out for the first {STANDING_SCAN_CAP.toLocaleString()} only — choose a
          school or program to narrow it down and see everyone.
        </p>
      )}
      {error && <p role="alert" className="text-[13.5px] text-red-700 mb-3">Couldn't load the scholars: {error}</p>}

      <p role="status" className="text-[13.5px] text-slate-700 mb-2">
        {loading ? "Loading…" : shownTotal === 0 ? "No scholars found." : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${shownTotal.toLocaleString()} scholar${shownTotal === 1 ? "" : "s"}`}
      </p>

      <div className="bg-white border border-[#e6ecf5] rounded-xl overflow-x-auto relative">
        <table className="w-full min-w-[860px] text-[14px]">
          <caption className="sr-only">Scholars with their GWA and scholarship standing for {periodTitle(period)}</caption>
          <thead className="bg-[#f7f9fc]">
            <tr>
              <th scope="col" className={TH_CLS}>Scholar ID</th>
              <th scope="col" className={TH_CLS}>Name</th>
              <th scope="col" className={TH_CLS}>School</th>
              <th scope="col" className={TH_CLS}>Program</th>
              <th scope="col" className={TH_CLS}>Year</th>
              <th scope="col" className={TH_CLS}>GWA</th>
              <th scope="col" className={TH_CLS}>Standing</th>
              <th scope="col" className={TH_CLS}>Grades</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-600">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-600">No scholars found.</td></tr>
            ) : shown.map(r => {
              const i = info.get(r.scholarIdNumber);
              const standing: StandingResult = i?.standing ?? "no_gwa";
              return (
                <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8] hover:bg-[#f7f9fc]">
                  <td className="px-4 py-2.5 text-slate-700">{r.scholarIdNumber}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#062444]">{displayName(r)}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.schoolName || <span className="text-amber-800 font-semibold">No school set</span>}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.program}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.yearLevel}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#062444]">{i?.gwa == null ? "—" : i.gwa.toFixed(2)}{i?.gwa == null && <span className="sr-only">No GWA yet</span>}</td>
                  <td className="px-4 py-2.5"><StandingChip standing={standing} /></td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => setViewing(r)} className="text-[#0077b6] font-semibold hover:underline">View Grades<span className="sr-only"> for {displayName(r)}</span></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {shownTotal > PAGE_SIZE && !loading && (
        <nav aria-label="Scholar pages" className="flex items-center justify-between gap-3 mt-3">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-4 py-2 rounded-lg border border-[#062444]/20 text-[14px] font-semibold text-[#062444] disabled:opacity-50">Previous</button>
          <span className="text-[13.5px] text-slate-700">Page {page + 1} of {pages.toLocaleString()}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="px-4 py-2 rounded-lg border border-[#062444]/20 text-[14px] font-semibold text-[#062444] disabled:opacity-50">Next</button>
        </nav>
      )}

      {viewing && <ScholarGradesModal scholar={viewing} period={period} periodId={periodId} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Shows the period chosen at the top of the page by default; "Show all periods" lists every semester on record for the scholar. */
function ScholarGradesModal({ scholar, period, periodId, onClose }: { scholar: MonitoringScholarRow; period: GradingPeriod; periodId: string | null; onClose: () => void }) {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState("");
  const [docs, setDocs] = useState<GradeDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState("");
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

  // Change history (every period on record, or just the selected one) and the supporting documents of the selected period.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      const r = await fetchGradeAudit(scholar.scholarIdNumber, showAll ? null : periodId);
      if (cancelled) return;
      if (r.ok) { setAudit(r.rows); setAuditError(""); } else setAuditError(r.error);
      setAuditLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scholar.scholarIdNumber, periodId, showAll]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!periodId) { setDocs([]); setDocsLoading(false); return; }
      setDocsLoading(true);
      const r = await fetchGradeDocuments(scholar.scholarIdNumber, periodId);
      if (cancelled) return;
      if (r.ok) { setDocs(r.rows); setDocsError(""); } else setDocsError(r.error);
      setDocsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scholar.scholarIdNumber, periodId]);

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

          <section aria-label="Supporting documents" className="mt-5">
            <h4 className="flex items-center gap-1.5 text-[14.5px] font-bold text-[#062444] mb-2"><Paperclip size={15} aria-hidden="true" /> Supporting documents — {periodTitle(period)}</h4>
            <GradeDocumentsList documents={docs} loading={docsLoading} error={docsError} />
          </section>
          <section aria-label="Change history" className="mt-5">
            <HistoryHeading />
            <GradeHistoryList entries={audit} loading={auditLoading} error={auditError} />
          </section>
        </>
      )}
    </Modal>
  );
}
