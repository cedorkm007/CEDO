import { useMemo, useState } from "react";
import { GraduationCap, BookOpen, UploadCloud, Download, Search, ChevronRight, LayoutGrid, Table2, AlertTriangle, Settings } from "lucide-react";
import { useUrlState } from "@/app/useUrlState";
import { statusLabel, canSchoolEdit } from "@/lib/academicPeriods";
import {
  breadcrumbs, filterRows, groupProgress, sortYearLevels, yearLevelOf, programOf, STATUS_LABEL,
  type Drill, type ScholarStatus,
} from "../portalLogic";
import { periodLabel } from "../gradeSaveLogic";
import { downloadGradeTemplate } from "../templateDownload";
import { SubmitGradesDialog } from "./SubmitGradesDialog";
import { submitReadiness } from "../submissionLogic";
import { periodTitle } from "@/lib/academicPeriods";
import { BulkGradeUploadModal } from "./BulkGradeUploadModal";
import { ScholarsSummary } from "./ScholarsSummary";
import { ScholarsTable } from "./ScholarsTable";
import { ProgressBar, fieldClass, focusRing, linkButton } from "./portalParts";
import { countStandings, STANDING_LABEL, type StandingResult } from "@/lib/standing";
import type { SchoolData } from "../useSchoolData";
import type { SchoolScholarRow } from "../types";

type ViewMode = "browse" | "table";
const VIEW_VALUES: readonly ViewMode[] = ["browse", "table"];
const STATUSES: ScholarStatus[] = ["not_set_up", "not_graded", "complete", "submitted"];

function Notice({ tone, children, role }: { tone: "amber" | "red"; children: React.ReactNode; role?: "alert" | "status" }) {
  const cls = tone === "red" ? "text-red-900 bg-red-50 border-red-300" : "text-amber-900 bg-amber-50 border-amber-300";
  return (
    <div role={role} className={`flex items-start gap-2.5 text-[14.5px] border rounded-lg px-3.5 py-2.5 mb-3 ${cls}`}>
      <AlertTriangle size={16} className="shrink-0 mt-1" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * The School Portal's Scholars tab (Phase 5 redesign): a summary row with overall progress, a toolbar (search, template,
 * CSV upload, view toggle), year-level cards with progress that drill down through programs to a table — or one
 * "Table view" of every scholar with filters — plus guidance for every empty state. All data comes from useSchoolData.
 */
export function ScholarsDrilldownPanel({ data, onGoToGradingSystem, onOpenScholar }: {
  data: SchoolData; onGoToGradingSystem: () => void;
  /** Opens the grade-entry window for a scholar (the window lives in the workspace so the Corrections tab can open it too). */
  onOpenScholar: (scholar: SchoolScholarRow) => void;
}) {
  const { rows, counts, period, periodRecord, editable, gradingReady, configLoaded, periods, loading } = data;
  const [view, setView] = useUrlState<ViewMode>("scholarsView", "browse", VIEW_VALUES);
  const [drill, setDrill] = useState<Drill>({ level: "yearLevels" });
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScholarStatus | "">("");
  const [standingFilter, setStandingFilter] = useState<StandingResult | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [toolbarError, setToolbarError] = useState("");

  const searching = search.trim() !== "";
  const hasOpenPeriod = periods.some(p => canSchoolEdit(p.status));

  const yearCards = useMemo(() => groupProgress(rows, s => yearLevelOf(s), sortYearLevels), [rows]);
  const programCards = useMemo(() => {
    if (drill.level !== "programs") return [];
    return groupProgress(rows.filter(r => yearLevelOf(r.scholar) === drill.yearLevel), s => programOf(s));
  }, [rows, drill]);
  const scholarsInScope = useMemo(() => {
    if (drill.level !== "scholars") return [];
    return rows.filter(r => yearLevelOf(r.scholar) === drill.yearLevel && programOf(r.scholar) === drill.program);
  }, [rows, drill]);

  const yearOptions = useMemo(() => sortYearLevels(Array.from(new Set(rows.map(r => yearLevelOf(r.scholar))))), [rows]);
  const programOptions = useMemo(
    () => Array.from(new Set(rows.filter(r => !yearFilter || yearLevelOf(r.scholar) === yearFilter).map(r => programOf(r.scholar)))).sort((a, b) => a.localeCompare(b)),
    [rows, yearFilter],
  );
  const tableRows = useMemo(() => filterRows(rows, { yearLevel: yearFilter, program: programFilter, status: statusFilter, standing: standingFilter }), [rows, yearFilter, programFilter, statusFilter, standingFilter]);
  // Scholarship standing only appears once the school has saved a retention requirement (Grading System tab).
  const hasRequirement = data.config?.retentionThreshold != null;
  const standingCounts = useMemo(() => (hasRequirement ? countStandings(rows.map(r => r.standing)) : null), [rows, hasRequirement]);
  const searchRows = useMemo(() => filterRows(rows, { search }), [rows, search]);

  async function handleDownloadTemplate() {
    setToolbarError("");
    setDownloading(true);
    const result = await downloadGradeTemplate(data.scholars, period);
    setDownloading(false);
    if (!result.ok) setToolbarError(`Couldn't prepare the template: ${result.error}`);
  }

  const openScholar = onOpenScholar;
  const readiness = submitReadiness({ counts, editable, gradingReady, locked: data.locked, hasPeriod: !!periodRecord });

  const emptyGuidance = (
    <>
      <p className="font-semibold text-[#062444] mb-1">No subjects declared yet for {periodLabel(period) || "this period"}.</p>
      {!gradingReady ? (
        <p>First set up your grading scale (see the notice above). Then you can add subjects with <strong>Enter grades</strong>, or fill in the template and <strong>Upload CSV</strong>.</p>
      ) : !editable ? (
        <p>This period is not Open, so subjects can't be added to it. Choose an Open period in the bar above.</p>
      ) : (
        <p>Open a scholar's grades with <strong>Enter grades</strong> to add subjects — or use <strong>Download template</strong>, fill it in, and <strong>Upload CSV</strong>.</p>
      )}
    </>
  );

  const nothingListed = rows.length === 0 && !loading;
  const allNotSetUp = counts.total > 0 && counts.notSetUp === counts.total && !data.gradesLoading && !data.gradesError;

  return (
    <div>
      {/* Setup + status notices */}
      {configLoaded && !gradingReady && (
        <Notice tone="red" role="alert">
          <p className="font-bold">Set up your grading scale before entering grades.</p>
          <p>Grades can't be entered or uploaded until your school's scale is saved. It only takes a minute.</p>
          <button onClick={onGoToGradingSystem} className={`mt-1.5 inline-flex items-center gap-1.5 text-[14.5px] ${linkButton}`}>
            <Settings size={14} aria-hidden="true" /> Go to Grading System
          </button>
        </Notice>
      )}
      {data.periodsError && <Notice tone="red" role="alert">Couldn't load the grading periods: {data.periodsError}</Notice>}
      {!period.schoolYear && !data.periodsError && (
        <Notice tone="amber">CEDO has not set the current grading period yet, so grades can't be shown or entered.</Notice>
      )}
      {period.schoolYear && !periodRecord && !data.periodsError && (
        <Notice tone="amber">CEDO has not set up this grading period yet, so grades can't be entered for it.</Notice>
      )}
      {periodRecord && !editable && (
        <Notice tone="amber">
          This period is {statusLabel(periodRecord.status)} — you can look at grades but not enter or change them. Choose an Open period in the bar above to enter grades.
        </Notice>
      )}
      {data.gradesError && (
        <Notice tone="red" role="alert">
          <span>Couldn't load the saved grades: {data.gradesError}</span>
          <button onClick={data.reloadGrades} className={`ml-3 underline ${linkButton}`}>Retry</button>
        </Notice>
      )}
      {data.subjectsNeedingUnits > 0 && (
        <Notice tone="amber">
          {data.subjectsNeedingUnits} subject{data.subjectsNeedingUnits === 1 ? " has" : "s have"} no units yet in this period and {data.subjectsNeedingUnits === 1 ? "is" : "are"} counted as 1 unit in the GWA.
          Open a scholar's grades to enter the units (they are highlighted).
        </Notice>
      )}

      <ScholarsSummary counts={counts} loading={loading || data.gradesLoading} readiness={readiness} submission={data.submission} onSubmit={() => setSubmitting(true)} standing={standingCounts} />
      {gradingReady && !hasRequirement && (
        <p className="text-[14px] text-slate-700 mb-4">
          Scholarship standing is off. Save a <strong>retention requirement</strong> in the{" "}
          <button onClick={onGoToGradingSystem} className={linkButton}>Grading System tab</button> to see which scholars are at risk.
        </p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="scholar-search" className="block text-[14px] font-semibold text-[#062444] mb-1">Search scholars by name or ID</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
            <input id="scholar-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. Santos or 2409-00123"
              className={`${fieldClass} w-full pl-9`} />
          </div>
        </div>
        <button onClick={() => void handleDownloadTemplate()} disabled={downloading || !period.schoolYear || rows.length === 0}
          className={`flex items-center gap-2 border border-[#062444]/40 bg-white text-[#062444] text-[14px] font-semibold rounded-lg px-4 py-2 disabled:opacity-50 ${focusRing}`}>
          <Download size={15} aria-hidden="true" /> {downloading ? "Preparing…" : "Download template"}
        </button>
        <button onClick={() => setShowBulkUpload(true)} disabled={!hasOpenPeriod || !gradingReady || rows.length === 0}
          title={!gradingReady ? "Set up your grading scale first" : !hasOpenPeriod ? "Needs an Open period" : undefined}
          className={`flex items-center gap-2 bg-gradient-to-br from-[#062444] to-[#0a3a6b] text-white text-[14px] font-semibold rounded-lg px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`}>
          <UploadCloud size={15} aria-hidden="true" /> Upload CSV
        </button>
        <div role="group" aria-label="View" className="flex rounded-lg border border-[#062444]/40 overflow-hidden bg-white">
          <button onClick={() => setView("browse")} aria-pressed={view === "browse"}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-[14px] font-semibold ${focusRing} ${view === "browse" ? "bg-[#062444] text-white" : "text-[#062444]"}`}>
            <LayoutGrid size={15} aria-hidden="true" /> By year level
          </button>
          <button onClick={() => setView("table")} aria-pressed={view === "table"}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-[14px] font-semibold border-l border-[#062444]/40 ${focusRing} ${view === "table" ? "bg-[#062444] text-white" : "text-[#062444]"}`}>
            <Table2 size={15} aria-hidden="true" /> Table view
          </button>
        </div>
      </div>
      {toolbarError && <p role="alert" className="text-[14px] text-red-800 -mt-3 mb-4">{toolbarError}</p>}

      {/* Content */}
      {loading ? (
        <p className="text-[14.5px] text-slate-700 text-center py-8">Loading your scholars…</p>
      ) : nothingListed ? (
        <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-8 text-center text-[14.5px] text-slate-800">
          <p className="font-semibold text-[#062444] mb-1">No scholars are linked to your school yet.</p>
          <p>If you expected to see scholars here, please contact CEDO (Account menu → Help / Contact CEDO).</p>
        </div>
      ) : searching ? (
        <section aria-label="Search results">
          <p className="text-[14.5px] text-slate-800 mb-2" aria-live="polite">{searchRows.length} scholar{searchRows.length === 1 ? "" : "s"} found for “{search.trim()}”</p>
          <ScholarsTable rows={searchRows} editable={editable && !data.locked} gradingReady={gradingReady} showStanding={hasRequirement} onOpen={openScholar}
            empty={<p>No scholars match “{search.trim()}”. Check the spelling, or try the Scholar ID.</p>} />
        </section>
      ) : view === "table" ? (
        <section aria-label="All scholars">
          {allNotSetUp && <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-4 text-[14.5px] text-slate-800 mb-4">{emptyGuidance}</div>}
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label htmlFor="filter-year" className="block text-[14px] font-semibold text-[#062444] mb-1">Year level</label>
              <select id="filter-year" value={yearFilter} onChange={e => { setYearFilter(e.target.value); setProgramFilter(""); }} className={fieldClass}>
                <option value="">All year levels</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="filter-program" className="block text-[14px] font-semibold text-[#062444] mb-1">Program</label>
              <select id="filter-program" value={programFilter} onChange={e => setProgramFilter(e.target.value)} className={`${fieldClass} max-w-[18rem]`}>
                <option value="">All programs</option>
                {programOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="filter-status" className="block text-[14px] font-semibold text-[#062444] mb-1">Status</label>
              <select id="filter-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as ScholarStatus | "")} className={fieldClass}>
                <option value="">All statuses</option>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            {hasRequirement && (
              <div>
                <label htmlFor="filter-standing" className="block text-[14px] font-semibold text-[#062444] mb-1">Standing</label>
                <select id="filter-standing" value={standingFilter} onChange={e => setStandingFilter(e.target.value as StandingResult | "")} className={fieldClass}>
                  <option value="">All</option>
                  {(["good", "at_risk", "below", "no_gwa"] as StandingResult[]).map(k => <option key={k} value={k}>{STANDING_LABEL[k]}</option>)}
                </select>
              </div>
            )}
            {(yearFilter || programFilter || statusFilter || standingFilter) && (
              <button onClick={() => { setYearFilter(""); setProgramFilter(""); setStatusFilter(""); setStandingFilter(""); }} className={`text-[14px] pb-2 ${linkButton}`}>Clear filters</button>
            )}
            <p className="text-[14px] text-slate-800 pb-2 sm:ml-auto" aria-live="polite">Showing {tableRows.length} of {rows.length} scholars</p>
          </div>
          <ScholarsTable rows={tableRows} editable={editable && !data.locked} gradingReady={gradingReady} showStanding={hasRequirement} onOpen={openScholar}
            empty={<p>No scholars match these filters. Try clearing one of them.</p>} />
        </section>
      ) : (
        <section aria-label="Browse scholars by year level and program">
          <nav aria-label="Breadcrumb" className="mb-3">
            <ol className="flex flex-wrap items-center gap-1 text-[14.5px]">
              {breadcrumbs(drill).map((c, i, all) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {c.to ? (
                    <button onClick={() => setDrill(c.to!)} className={linkButton}>{c.label}</button>
                  ) : (
                    <span aria-current="page" className="font-bold text-[#062444]">{c.label}</span>
                  )}
                  {i < all.length - 1 && <ChevronRight size={14} className="text-slate-600" aria-hidden="true" />}
                </li>
              ))}
            </ol>
          </nav>

          {drill.level === "yearLevels" && (
            <>
              {allNotSetUp && <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-4 text-[14.5px] text-slate-800 mb-4">{emptyGuidance}</div>}
              <p className="text-[14.5px] text-slate-800 mb-3">Select a year level to browse your scholars.</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                {yearCards.map(g => (
                  <button key={g.key} onClick={() => setDrill({ level: "programs", yearLevel: g.key })}
                    className={`text-left bg-white border border-[#e6ecf5] rounded-xl p-4 hover:border-[#0077b6] hover:shadow-sm transition-all ${focusRing}`}>
                    <GraduationCap size={18} className="text-[#0077b6] mb-2" aria-hidden="true" />
                    <p className="font-bold text-[16px] text-[#062444]">{g.key}</p>
                    <p className="text-[14px] text-slate-700 mb-2.5">{g.total} scholar{g.total === 1 ? "" : "s"}</p>
                    <ProgressBar percent={g.percent} label={`${g.key}: scholars complete`} />
                    <p className="text-[14px] text-slate-800 mt-1.5">{g.complete} of {g.total} complete</p>
                  </button>
                ))}
              </div>
            </>
          )}

          {drill.level === "programs" && (
            <>
              <p className="text-[14.5px] text-slate-800 mb-3">{drill.yearLevel} — select a program.</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                {programCards.map(g => (
                  <button key={g.key} onClick={() => setDrill({ level: "scholars", yearLevel: drill.yearLevel, program: g.key })}
                    className={`text-left bg-white border border-[#e6ecf5] rounded-xl p-4 hover:border-[#0077b6] hover:shadow-sm transition-all ${focusRing}`}>
                    <BookOpen size={18} className="text-[#0077b6] mb-2" aria-hidden="true" />
                    <p className="font-bold text-[16px] text-[#062444]">{g.key}</p>
                    <p className="text-[14px] text-slate-700 mb-2.5">{g.total} scholar{g.total === 1 ? "" : "s"}</p>
                    <ProgressBar percent={g.percent} label={`${g.key}: scholars complete`} />
                    <p className="text-[14px] text-slate-800 mt-1.5">{g.complete} of {g.total} complete</p>
                  </button>
                ))}
              </div>
            </>
          )}

          {drill.level === "scholars" && (
            <ScholarsTable rows={scholarsInScope} editable={editable && !data.locked} gradingReady={gradingReady} showStanding={hasRequirement} onOpen={openScholar}
              empty={<p>No scholars in {drill.yearLevel} — {drill.program}.</p>} />
          )}
        </section>
      )}

      {submitting && periodRecord && (
        <SubmitGradesDialog periodId={periodRecord.id} periodTitle={periodTitle(period)} scholarCount={counts.total}
          onClose={() => setSubmitting(false)} onSubmitted={() => { data.reloadSubmission(); data.reloadGrades(); }} />
      )}
      {showBulkUpload && (
        <BulkGradeUploadModal scholars={data.scholars} schoolId={data.schoolId} periods={periods} initialKey={data.selectedKey}
          onClose={() => setShowBulkUpload(false)} onDone={data.reloadGrades} />
      )}
    </div>
  );
}
