import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { fetchSubmissionScholarsByStatus, type SubmissionStatusScholar, type SubmissionUploadStatus } from "../submissionActivitiesApi";
import { ExportButtonGroup, type ExportFormat } from "@/app/components/ExportButtons";
import { toCsv, downloadCsv } from "../csvUtils";
import { generateSubmissionRosterReport } from "@/lib/docGenerator";
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
 * who have at least one file in that status FOR THE CHOSEN SUBMISSION ACTIVITY (or for all activities) — the same people the total
 * counts — with Year Level and School filters, and an export (CSV, PDF, Word) of what is shown.
 * Backed by submission_files_status_scholars (supabase_migration_submission_status_by_activity.sql). The whole list for one status
 * is read once and filtered here, the same way the Submission Monitoring roster does it, so changing a filter is instant.
 */
export function SubmissionStatusScholarsPanel({ status, label, activityId, activityName }: { status: SubmissionUploadStatus; label: string; activityId: string | null; activityName: string }) {
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
    void fetchSubmissionScholarsByStatus(status, activityId).then(result => {
      if (cancelled) return;
      if (result.ok) setRows(result.rows); else { setRows([]); setError(result.error || "Couldn't load the scholars. Please try again."); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [status, activityId, retry]);

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

  // ── Export: exactly the scholars shown (all pages, current filters and order) ──
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState("");
  const fileStem = `Submission_Files_${label.replace(/\s+/g, "_")}_${activityName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "All"}_${new Date().toISOString().slice(0, 10)}`;
  const exportColumns: { label: string; value: (r: SubmissionStatusScholar) => string }[] = [
    { label: "Scholar ID", value: r => r.scholarIdNumber || "—" },
    { label: "Scholar", value: r => `${r.lastName}, ${r.firstName}` },
    { label: "Year Level", value: r => r.yearLevel || "—" },
    { label: "School", value: r => r.school || "No School Set" },
    { label: "Files", value: r => String(r.fileCount) },
    { label: "Activities", value: r => r.activityNames.join("; ") },
  ];
  function describeFilters(): string {
    const parts = [`Status = ${label}`, `Activity = ${activityName}`];
    if (yearLevel !== "all") parts.push(`Year Level = ${yearLevel}`);
    if (school !== "all") parts.push(`School = ${school}`);
    return `Filters: ${parts.join("; ")}`;
  }
  async function runExport(format: ExportFormat, work: () => Promise<void> | void) {
    if (exportingFormat || sorted.length === 0) return;
    setExportingFormat(format); setExportError("");
    try { await work(); } catch { setExportError(`Could not export ${format === "word" ? "the Word document" : format.toUpperCase()}. Please try again.`); } finally { setExportingFormat(null); }
  }
  const exportCsv = () => runExport("csv", () => {
    downloadCsv(`${fileStem}.csv`, toCsv(exportColumns.map(c => c.label), sorted.map(r => exportColumns.map(c => c.value(r)))));
  });
  const exportPdf = () => runExport("pdf", () => {
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const marginX = 12, widths = [26, 52, 26, 60, 14, 80];
    let y = 16;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.text(`Submission Files — ${label}`, marginX, y); y += 6;
    pdf.setFontSize(11); pdf.text(activityName, marginX, y); y += 6;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    pdf.text(`Generated ${new Date().toLocaleString()} • ${sorted.length} scholar${sorted.length === 1 ? "" : "s"}`, marginX, y); y += 5;
    pdf.text(describeFilters(), marginX, y, { maxWidth: 270 }); y += 8;
    const header = () => { pdf.setFont("helvetica", "bold"); let x = marginX; exportColumns.forEach((c, i) => { pdf.text(c.label, x, y); x += widths[i]; }); y += 3; pdf.setDrawColor(200); pdf.line(marginX, y, marginX + widths.reduce((a, b) => a + b, 0), y); y += 5; pdf.setFont("helvetica", "normal"); };
    header();
    for (const row of sorted) {
      if (y > 195) { pdf.addPage(); y = 16; header(); }
      let x = marginX;
      exportColumns.forEach((c, i) => { pdf.text(c.value(row), x, y, { maxWidth: widths[i] - 2 }); x += widths[i]; });
      y += 7;
    }
    pdf.save(`${fileStem}.pdf`);
  });
  const exportWord = () => runExport("word", async () => {
    await generateSubmissionRosterReport({
      title: `SUBMISSION FILES — ${label.toUpperCase()}`, fileNamePrefix: `Submission_Files_${label.replace(/\s+/g, "_")}`,
      activityName, columns: exportColumns.map(c => c.label), columnWeights: [1, 2.2, 1, 1.8, 0.6, 2.4],
      rows: sorted.map(r => exportColumns.map(c => c.value(r))), generatedAt: new Date().toLocaleString(), filtersSummary: describeFilters(),
    });
  });

  const thClass = "px-3 pb-1 text-[12px] font-bold uppercase tracking-wide text-slate-600";

  return (
    <section aria-label={`Scholars with ${label} files`} className="rounded-2xl border border-[#e6ecf5] bg-white p-4">
      <h3 className="text-[15px] font-bold text-[#062444]">Scholars with {label} files — {activityName}</h3>
      <p className="mt-0.5 mb-3 text-[13px] text-slate-600">
        {loading ? "Loading…" : filtersActive
          ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} scholars match the filters.`
          : `${rows.length.toLocaleString()} scholar${rows.length === 1 ? "" : "s"} with at least one file in this status ${activityId === null ? "across all submission activities" : "in this submission activity"}.`}
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
        <div className="ml-auto">
          <ExportButtonGroup onExportCsv={exportCsv} onExportPdf={exportPdf} onExportWord={exportWord} busyFormat={exportingFormat} disabled={loading || sorted.length === 0} labelPrefix="Export " />
        </div>
      </div>
      {exportError && <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-[13px] text-red-700">{exportError}</p>}

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
