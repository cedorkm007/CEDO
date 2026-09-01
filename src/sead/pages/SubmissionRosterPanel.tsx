import { useEffect, useMemo, useState } from "react";
import { X, Users, CheckCircle2, AlertCircle, Lock, Circle, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import {
  fetchSubmissionRosterStatus,
  type SubmissionActivity, type SubmissionRosterRow, type SubmissionRosterStatus,
} from "../submissionActivitiesApi";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";
import { toCsv, downloadCsv } from "../csvUtils";
import { generateSubmissionRosterReport } from "@/lib/docGenerator";

/**
 * Milestones 5-6 of the "Drive folder reorganization + submission
 * monitoring" task, plus a later addendum (before Milestone 7) adding a
 * Status filter and a filtered-count summary — same file, same
 * conventions, not a separate milestone number since it's a direct
 * extension of Milestone 6's own filter row. The roster display
 * (Milestone 5) plus year-level, school, AND status filters, all
 * AND-combined (Milestone 6 + addendum). School filter options are
 * derived directly from the already-loaded roster rows rather than
 * a separate distinct-schools query — the whole roster for one activity
 * is already fetched client-side, so there's no reason to add a second
 * round-trip just to list the schools that are already in hand. Year
 * Level filter mirrors SubmissionReviewPanel.tsx's own FORMATION_YEAR_LEVELS
 * dropdown (same task, same codebase, same convention) rather than
 * deriving year levels from the roster the same way schools are —
 * FORMATION_YEAR_LEVELS is the canonical, complete list even for a year
 * level with zero eligible scholars right now, which a roster-derived
 * list would silently omit. Status filter uses the full 4-way set
 * (Submitted / Needs Resubmission / Locked / Not Submitted) rather than
 * a Submitted-vs-everything-else binary — confirmed directly with the
 * person rather than assumed, since "Not Submitted" language elsewhere
 * in the original request was genuinely ambiguous against these 4 real
 * statuses.
 */
function statusMeta(status: SubmissionRosterStatus): { label: string; className: string; Icon: typeof CheckCircle2 } {
  if (status === "submitted") return { label: "Submitted", className: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  if (status === "needs_resubmission") return { label: "Needs Resubmission", className: "bg-red-50 text-red-700", Icon: AlertCircle };
  if (status === "locked") return { label: "Locked", className: "bg-slate-100 text-slate-600", Icon: Lock };
  return { label: "Not Submitted", className: "bg-amber-50 text-amber-700", Icon: Circle };
}

/**
 * Opened from SubmissionActivitiesSection for one activity at a time,
 * matching SubmissionReviewPanel's own activity-switcher convention so
 * staff don't have to close and reopen it to move between activities.
 */
export function SubmissionRosterPanel({ activity, activities, onClose }: {
  activity: SubmissionActivity; activities: SubmissionActivity[]; onClose: () => void;
}) {
  const [activityId, setActivityId] = useState(activity.id);
  const [rows, setRows] = useState<SubmissionRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [yearLevel, setYearLevel] = useState("all");
  const [school, setSchool] = useState("all");
  const [status, setStatus] = useState<"all" | SubmissionRosterStatus>("all");

  async function load(forActivityId: string) {
    setLoading(true);
    setError("");
    const result = await fetchSubmissionRosterStatus(forActivityId);
    if (!result.ok) setError(result.error || "Couldn't load the submission roster.");
    setRows(result.rows ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(activityId); }, [activityId]);

  // Reset filters that no longer apply when switching activities — a
  // school/year-level selected for one activity's roster may not exist
  // in another activity's roster at all.
  useEffect(() => { setYearLevel("all"); setSchool("all"); setStatus("all"); }, [activityId]);

  const schoolOptions = useMemo(
    () => [...new Set(rows.map(r => r.school || "No School Set"))].sort(),
    [rows]
  );

  // AND-combined per the person's explicit "cross-matchable" request —
  // all active conditions must hold, not any one of them.
  const filteredRows = useMemo(() => rows.filter(row => {
    if (yearLevel !== "all" && row.yearLevel !== yearLevel) return false;
    if (school !== "all" && (row.school || "No School Set") !== school) return false;
    if (status !== "all" && row.status !== status) return false;
    return true;
  }), [rows, yearLevel, school, status]);

  // Counts reflect whichever rows are currently visible — filteredRows
  // already equals the full roster when no filter is active, so this
  // one computation naturally covers both "filtered" and "unfiltered"
  // totals without a separate code path for either case.
  const statusCounts = useMemo(() => {
    const counts: Record<SubmissionRosterStatus, number> = { submitted: 0, needs_resubmission: 0, locked: 0, not_submitted: 0 };
    for (const row of filteredRows) counts[row.status]++;
    return counts;
  }, [filteredRows]);

  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportError, setExportError] = useState("");

  const activeActivityName = activities.find(a => a.id === activityId)?.name ?? "Submission Activity";

  /** Same convention as ScholarsTab.tsx's describeAppliedFilters — human-
   * readable summary line for the exported document's header. "All" is
   * omitted per filter rather than spelled out, so an unfiltered export
   * just reads "All scholars", matching the natural reading of an
   * unfiltered roster rather than an empty-looking "Filters: none" line. */
  function describeFilters(): string {
    const parts: string[] = [];
    if (yearLevel !== "all") parts.push(`Year Level = ${yearLevel}`);
    if (school !== "all") parts.push(`School = ${school}`);
    if (status !== "all") parts.push(`Status = ${statusMeta(status as SubmissionRosterStatus).label}`);
    return parts.length === 0 ? "All scholars (no filters applied)" : `Filters: ${parts.join("; ")}`;
  }

  function buildExportColumns(): { label: string; value: (r: SubmissionRosterRow) => string }[] {
    return [
      { label: "Scholar", value: r => `${r.lastName}, ${r.firstName}` },
      { label: "Year Level", value: r => r.yearLevel || "—" },
      { label: "School", value: r => r.school || "No School Set" },
      { label: "Status", value: r => statusMeta(r.status).label },
    ];
  }

  async function handleExportCsv() {
    if (exportingCsv || exportingPdf || exportingWord || filteredRows.length === 0) return;
    setExportingCsv(true);
    setExportError("");
    try {
      const columns = buildExportColumns();
      const csv = toCsv(columns.map(c => c.label), filteredRows.map(r => columns.map(c => c.value(r))));
      downloadCsv(csv, `Submission_Roster_${activeActivityName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      setExportError("Could not export CSV. Please try again.");
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleExportPdf() {
    if (exportingCsv || exportingPdf || exportingWord || filteredRows.length === 0) return;
    setExportingPdf(true);
    setExportError("");
    try {
      const columns = buildExportColumns();
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const marginX = 14;
      let y = 18;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text("Submission Monitoring Roster", marginX, y);
      y += 6;
      pdf.setFontSize(11);
      pdf.text(activeActivityName, marginX, y);
      y += 6;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(`Generated ${new Date().toLocaleString()} • ${filteredRows.length} scholar${filteredRows.length === 1 ? "" : "s"}`, marginX, y);
      y += 5;
      pdf.text(describeFilters(), marginX, y);
      y += 8;

      const colWidths = [70, 35, 55, 30];
      const rowHeight = 7;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      let x = marginX;
      columns.forEach((c, i) => { pdf.text(c.label, x, y); x += colWidths[i]; });
      y += 4;
      pdf.setDrawColor(200);
      pdf.line(marginX, y, marginX + colWidths.reduce((a, b) => a + b, 0), y);
      y += 4;
      pdf.setFont("helvetica", "normal");

      for (const row of filteredRows) {
        if (y > 280) { pdf.addPage(); y = 18; }
        x = marginX;
        columns.forEach((c, i) => { pdf.text(c.value(row), x, y, { maxWidth: colWidths[i] - 2 }); x += colWidths[i]; });
        y += rowHeight;
      }

      pdf.save(`Submission_Roster_${activeActivityName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch {
      setExportError("Could not export PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportWord() {
    if (exportingCsv || exportingPdf || exportingWord || filteredRows.length === 0) return;
    setExportingWord(true);
    setExportError("");
    try {
      const columns = buildExportColumns();
      await generateSubmissionRosterReport({
        activityName: activeActivityName,
        columns: columns.map(c => c.label),
        columnWeights: [2.2, 1, 1.6, 1],
        rows: filteredRows.map(r => columns.map(c => c.value(r))),
        generatedAt: new Date().toLocaleString(),
        filtersSummary: describeFilters(),
      });
    } catch {
      setExportError("Could not export Word document. Please try again.");
    } finally {
      setExportingWord(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-white"><Users size={16} /> Submission Monitoring</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[#e6ecf5] px-6 py-3">
          <select value={activityId} onChange={event => setActivityId(event.target.value)}
            className="rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[#062444] outline-none focus:border-[#0088cc]">
            {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={yearLevel} onChange={event => setYearLevel(event.target.value)}
            className="rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[#062444] outline-none focus:border-[#0088cc]">
            <option value="all">All Year Levels</option>
            {FORMATION_YEAR_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
          </select>
          <select value={school} onChange={event => setSchool(event.target.value)}
            className="rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[#062444] outline-none focus:border-[#0088cc]">
            <option value="all">All Schools</option>
            {schoolOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={status} onChange={event => setStatus(event.target.value as "all" | SubmissionRosterStatus)}
            className="rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[#062444] outline-none focus:border-[#0088cc]">
            <option value="all">All Statuses</option>
            {(["submitted", "needs_resubmission", "locked", "not_submitted"] as SubmissionRosterStatus[]).map(s => (
              <option key={s} value={s}>{statusMeta(s).label}</option>
            ))}
          </select>
        </div>

        {!loading && !error && rows.length > 0 && (
          <div className="grid shrink-0 grid-cols-4 gap-2 border-b border-[#e6ecf5] px-6 py-3">
            {(["submitted", "needs_resubmission", "locked", "not_submitted"] as SubmissionRosterStatus[]).map(s => {
              const meta = statusMeta(s);
              return (
                <div key={s} className={`rounded-lg px-2 py-1.5 text-center ${meta.className}`}>
                  <p className="text-[15px] font-extrabold">{statusCounts[s]}</p>
                  <p className="text-[10px] font-bold uppercase leading-tight">{meta.label}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="overflow-y-auto p-6">
          {loading ? (
            <p className="text-[13px] text-slate-400">Loading…</p>
          ) : error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">{error}</p>
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No scholars are eligible for this activity yet.</p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No scholars match these filters.</p>
          ) : (
            <table className="w-full border-separate border-spacing-y-1.5 text-left text-[12.5px]">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <th className="px-3 pb-1">Scholar</th>
                  <th className="px-3 pb-1">Year Level</th>
                  <th className="px-3 pb-1">School</th>
                  <th className="px-3 pb-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const meta = statusMeta(row.status);
                  return (
                    <tr key={row.scholarId} className="rounded-xl bg-[#f8fafc]">
                      <td className="rounded-l-xl px-3 py-2 font-semibold text-[#062444]">{row.lastName}, {row.firstName}</td>
                      <td className="px-3 py-2 text-slate-600">{row.yearLevel || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{row.school || "No School Set"}</td>
                      <td className="rounded-r-xl px-3 py-2">
                        <span className={`flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.className}`}>
                          <meta.Icon size={12} /> {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}