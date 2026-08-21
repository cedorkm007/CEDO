import { useEffect, useMemo, useState } from "react";
import { X, Search, CheckCircle2, AlertCircle, Clock, ExternalLink, ClipboardCheck } from "lucide-react";
import {
  fetchSubmissionsForActivity, reviewSubmissionUploads,
  type SubmissionActivity, type SubmissionForReview,
} from "../submissionActivitiesApi";
import { FORMATION_YEAR_LEVELS } from "@/scholar/formationActivitiesApi";

type StatusFilter = "all" | "uploaded" | "accepted" | "needs_resubmission";
type ReviewOutcome = "accepted" | "needs_resubmission";

function statusMeta(status: string): { label: string; className: string; Icon: typeof CheckCircle2 } {
  if (status === "accepted") return { label: "Accepted", className: "bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  if (status === "needs_resubmission") return { label: "Needs Resubmission", className: "bg-red-50 text-red-700", Icon: AlertCircle };
  return { label: "Pending Review", className: "bg-amber-50 text-amber-700", Icon: Clock };
}

interface ScholarGroup {
  scholarId: string;
  scholarIdNumber: string;
  scholarName: string;
  yearLevel: string;
  uploads: SubmissionForReview[];
}

function groupByScholar(rows: SubmissionForReview[]): ScholarGroup[] {
  const map = new Map<string, ScholarGroup>();
  for (const row of rows) {
    let group = map.get(row.scholarId);
    if (!group) {
      group = { scholarId: row.scholarId, scholarIdNumber: row.scholarIdNumber, scholarName: row.scholarName, yearLevel: row.yearLevel, uploads: [] };
      map.set(row.scholarId, group);
    }
    group.uploads.push(row);
  }
  return [...map.values()].sort((a, b) => a.scholarName.localeCompare(b.scholarName));
}

/** A scholar's whole submission counts as needing resubmission if any one file does, and as accepted only once every file has been. Otherwise it's still pending review (mix of unreviewed and/or accepted files). */
function groupStatus(uploads: SubmissionForReview[]): "accepted" | "needs_resubmission" | "uploaded" {
  if (uploads.some(u => u.status === "needs_resubmission")) return "needs_resubmission";
  if (uploads.every(u => u.status === "accepted")) return "accepted";
  return "uploaded";
}

/**
 * One scholar's whole submission for the open activity — every uploaded
 * file (with a link to view it in Drive), and one review control that
 * applies to all of that scholar's files for this activity at once (see
 * reviewSubmissionUploads in submissionActivitiesApi.ts for why one
 * status/comment pair is written across every row instead of reviewing
 * file-by-file).
 */
function ScholarSubmissionCard({ group, onReviewed }: { group: ScholarGroup; onReviewed: () => void }) {
  const [comment, setComment] = useState(() => group.uploads.find(u => u.staffComment)?.staffComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = groupStatus(group.uploads);
  const meta = statusMeta(status);

  async function review(outcome: ReviewOutcome) {
    if (outcome === "needs_resubmission" && !comment.trim()) {
      setError("Add a comment explaining what needs to be resubmitted.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await reviewSubmissionUploads(group.uploads.map(u => u.id), outcome, comment.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't save the review."); return; }
    onReviewed();
  }

  return (
    <div className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-[#062444]">{group.scholarName || "Unknown scholar"}</p>
          <p className="text-[11.5px] text-slate-500">{group.scholarIdNumber} • {group.yearLevel || "No year level set"}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.className}`}>
          <meta.Icon size={12} /> {meta.label}
        </span>
      </div>

      <ul className="mt-2.5 space-y-1.5">
        {group.uploads.map(u => (
          <li key={u.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
            <span className="font-semibold text-slate-600">{u.fieldLabel}:</span>
            {u.driveViewUrl ? (
              <a href={u.driveViewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#0088cc] hover:underline">
                {u.originalFileName} <ExternalLink size={11} />
              </a>
            ) : (
              <span className="text-slate-500">{u.originalFileName}</span>
            )}
            <span className="text-[11px] text-slate-400">{new Date(u.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>

      <textarea
        value={comment}
        onChange={event => setComment(event.target.value)}
        placeholder="Comment (required for Needs Resubmission — shown to the scholar)"
        rows={2}
        className="mt-2.5 w-full resize-none rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12px] outline-none focus:border-[#0088cc]"
      />
      {error && <p className="mt-1 text-[11.5px] text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => void review("accepted")}
          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-50">
          <CheckCircle2 size={13} /> Accept
        </button>
        <button type="button" disabled={busy} onClick={() => void review("needs_resubmission")}
          className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11.5px] font-bold text-white disabled:opacity-50">
          <AlertCircle size={13} /> Needs Resubmission
        </button>
      </div>
    </div>
  );
}

/**
 * Opened from SubmissionActivitiesSection for one activity at a time (per
 * spec: "staff should be able to open an activity and view scholar
 * submissions..."), with an activity switcher included in the filter row
 * so staff don't have to close and reopen it to move between activities —
 * still covers the spec's separate "filters for activity, year level,
 * scholar name/ID, and status" line without a second top-level surface.
 */
export function SubmissionReviewPanel({ activity, activities, onClose }: {
  activity: SubmissionActivity; activities: SubmissionActivity[]; onClose: () => void;
}) {
  const [activityId, setActivityId] = useState(activity.id);
  const [submissions, setSubmissions] = useState<SubmissionForReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearLevel, setYearLevel] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  async function load(forActivityId: string) {
    setLoading(true);
    setSubmissions(await fetchSubmissionsForActivity(forActivityId));
    setLoading(false);
  }
  useEffect(() => { void load(activityId); }, [activityId]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filteredRows = submissions.filter(row => {
      if (yearLevel !== "all" && row.yearLevel !== yearLevel) return false;
      if (q && !row.scholarName.toLowerCase().includes(q) && !row.scholarIdNumber.toLowerCase().includes(q)) return false;
      return true;
    });
    const grouped = groupByScholar(filteredRows);
    return statusFilter === "all" ? grouped : grouped.filter(g => groupStatus(g.uploads) === statusFilter);
  }, [submissions, yearLevel, query, statusFilter]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-white"><ClipboardCheck size={16} /> Review Submissions</h3>
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
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-lg border border-[#062444]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[#062444] outline-none focus:border-[#0088cc]">
            <option value="all">All Statuses</option>
            <option value="uploaded">Pending Review</option>
            <option value="accepted">Accepted</option>
            <option value="needs_resubmission">Needs Resubmission</option>
          </select>
          <div className="relative min-w-[160px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Scholar name or ID"
              className="w-full rounded-lg border border-[#062444]/15 py-1.5 pl-7 pr-2.5 text-[12px] outline-none focus:border-[#0088cc]" />
          </div>
        </div>

        <div className="space-y-2.5 overflow-y-auto p-6">
          {loading ? (
            <p className="text-[13px] text-slate-400">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#d9e1eb] p-6 text-center text-[13px] text-slate-400">No submissions match these filters.</p>
          ) : (
            groups.map(group => <ScholarSubmissionCard key={group.scholarId} group={group} onReviewed={() => void load(activityId)} />)
          )}
        </div>
      </div>
    </div>
  );
}
