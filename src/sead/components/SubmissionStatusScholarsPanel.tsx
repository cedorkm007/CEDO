import { useEffect, useMemo, useState } from "react";
import { fetchSubmissionScholarsByStatus, type SubmissionStatusScholar, type SubmissionUploadStatus } from "../submissionActivitiesApi";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { useSort, SortableTh } from "@/app/components/SortableTable";
import { usePaginatedList, ListPagination } from "@/app/components/PaginatedList";

const selectClass = "rounded-lg border border-[#062444]/15 px-3 py-2 text-[13px] font-semibold text-[#062444] outline-none focus:border-[#0088cc] bg-white";

/** Order year levels the way the rest of Submission Activities does (1st Year, 2nd Year, …), anything unexpected last. */
function yearLevelRank(level: string): number {
  const i = (FORMATION_YEAR_LEVELS as readonly string[]).indexOf(level);
  return i === -1 ? 1000 : i;
}

/**
 * Opened from a total at the top of the Submission Activities Files tab (Accepted / Needs Resubmission / Pending): the scholars
 * who have at least one file in that status — the same people the total counts — with Year Level and School filters.
 * Backed by submission_scholars_by_status (supabase_migration_submission_status_scholars_rpc.sql). The whole list for one status
 * is read once and filtered here, the same way the Submission Monitoring roster does it, so changing a filter is instant.
 */
export function SubmissionStatusScholarsPanel({ status, label }: { status: SubmissionUploadStatus; label: string }) {
  const [rows, setRows] = useState<SubmissionStatusScholar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [yearLevel, setYearLevel] = useState("all");
  const [school, setSchool] = useState("all");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setYearLevel("all");
    setSchool("all");
    void fetchSubmissionScholarsByStatus(status).then(result => {
      if (cancelled) return;
      if (result.ok) setRows(result.rows); else { setRows([]); setError(result.error || "Couldn't load the scholars. Please try again."); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [status, retry]);

  const yearLevelOptions = useMemo(
    () => [...new Set(rows.map(r => r.yearLevel))].sort((a, b) => yearLevelRank(a) - yearLevelRank(b) || a.localeCompare(b)),
    [rows],
  );
  const schoolOptions = useMemo(() => [...new Set(rows.map(r => r.school))].sort((a, b) => a.localeCompare(b)), [rows]);

  const filtered = useMemo(
    () => rows.filter(r => (yearLevel === "all" || r.yearLevel === yearLevel) && (school === "all" || r.school === school)),
    [rows, yearLevel, school],
  );

  const { sorted, sortState, toggleSort } = useSort<SubmissionStatusScholar>(filtered, {
    scholar: r => `${r.lastName} ${r.firstName}`.trim().toLowerCase(),
    yearLevel: r => yearLevelRank(r.yearLevel),
    school: r => r.school.toLowerCase(),
    files: r => r.fileCount,
  });
  const { paged, page, setPage, totalPages, filteredCount, pageSize } = usePaginatedList(sorted, { pageSize: 50 });
  useEffect(() => { setPage(1); }, [yearLevel, school, status, sortState.key, sortState.direction, setPage]);

  const filtersActive = yearLevel !== "all" || school !== "all";
  const thClass = "px-3 pb-1 text-[12px] font-bold uppercase tracking-wide text-slate-600";

  return (
    <section aria-label={`Scholars with ${label} files`} className="rounded-2xl border border-[#e6ecf5] bg-white p-4">
      <h3 className="text-[15px] font-bold text-[#062444]">Scholars with {label} files</h3>
      <p className="mt-0.5 mb-3 text-[13px] text-slate-600">
        {loading ? "Loading…" : filtersActive
          ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} scholars match the filters.`
          : `${rows.length.toLocaleString()} scholar${rows.length === 1 ? "" : "s"} with at least one file in this status, across all submission activities.`}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="sub-status-year">Year level</label>
        <select id="sub-status-year" value={yearLevel} onChange={e => setYearLevel(e.target.value)} disabled={loading} className={selectClass}>
          <option value="all">All Year Levels</option>
          {yearLevelOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <label className="sr-only" htmlFor="sub-status-school">School</label>
        <select id="sub-status-school" value={school} onChange={e => setSchool(e.target.value)} disabled={loading} className={`${selectClass} max-w-full`}>
          <option value="all">All Schools</option>
          {schoolOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {filtersActive && (
          <button type="button" onClick={() => { setYearLevel("all"); setSchool("all"); }} className="text-[13px] font-semibold text-[#0077b6] hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          {error} <button type="button" onClick={() => setRetry(n => n + 1)} className="ml-1 font-semibold underline">Retry</button>
        </p>
      ) : loading ? null : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-600">No scholars have files in this status.</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-600">No scholars match these filters.</p>
      ) : (
        <>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-y-1.5 text-left text-[13px]">
              <caption className="sr-only">Scholars with {label} files</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Scholar ID</th>
                  <SortableTh label="Scholar" sortKey="scholar" sortState={sortState} onSort={toggleSort} className={thClass} />
                  <SortableTh label="Year Level" sortKey="yearLevel" sortState={sortState} onSort={toggleSort} className={thClass} />
                  <SortableTh label="School" sortKey="school" sortState={sortState} onSort={toggleSort} className={thClass} />
                  <SortableTh label="Files" sortKey="files" sortState={sortState} onSort={toggleSort} className={thClass} />
                  <th scope="col" className={thClass}>Activities</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(r => (
                  <tr key={r.scholarId} className="bg-[#f8fafc]">
                    <td className="whitespace-nowrap rounded-l-xl px-3 py-2 text-slate-600">{r.scholarIdNumber || "—"}</td>
                    <td className="px-3 py-2 font-semibold text-[#062444]">{r.lastName}, {r.firstName}</td>
                    <td className="px-3 py-2 text-slate-700">{r.yearLevel}</td>
                    <td className="px-3 py-2 text-slate-700">{r.school}</td>
                    <td className="px-3 py-2 text-slate-700">{r.fileCount}</td>
                    <td className="rounded-r-xl px-3 py-2 text-slate-700">{r.activityNames.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={filteredCount} pageSize={pageSize} itemLabel="scholars" />
        </>
      )}
    </section>
  );
}
