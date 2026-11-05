import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, ChevronRight, Eye, Loader2, MapPin, RefreshCw, Search, X, XCircle } from "lucide-react";
import {
  PROGRESS_PAGE_SIZE, approveProgress, fetchProgressActivities, fetchProgressCounts, fetchProgressList, fetchProgressPictureUrl, mapLink, rejectProgress,
  type ProgressCounts, type ProgressRow, type ProgressStatus,
} from "../progressMonitorApi";

type StatusFilter = ProgressStatus | "all";
const REFRESH_MS = 30_000;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

function StatusChip({ row }: { row: ProgressRow }) {
  if (row.status === "approved") return <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[12.5px] font-bold text-green-800"><CheckCircle2 size={12} /> Approved</span>;
  if (row.status === "rejected") return <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[12.5px] font-bold text-red-700"><XCircle size={12} /> Rejected</span>;
  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[12.5px] font-bold text-amber-800">Waiting</span>;
}

/** The picture, large, with where and when it was taken, and the two buttons. */
function PictureDialog({ row, busy, onClose, onApprove, onReject }: { row: ProgressRow; busy: boolean; onClose: () => void; onApprove: () => void; onReject: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { let off = false; void fetchProgressPictureUrl(row.imagePath).then(u => { if (!off) setUrl(u); }); return () => { off = true; }; }, [row.imagePath]);
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="Picture" onClick={onClose}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 bg-[#062444] px-5 py-3.5">
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-[#F3BC00]">{row.activityName}</p>
            <h3 className="truncate text-[16px] font-bold text-white">{row.scholarName} <span className="font-normal text-white/70">· {row.scholarIdNumber}</span></h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4">
          <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-slate-100">
            {url === undefined ? <Loader2 className="animate-spin text-slate-500" /> : url ? <img src={url} alt={`Picture of ${row.scholarName}`} className="max-h-[60vh] w-full object-contain" /> : <p className="p-6 text-[14px] text-slate-600">The picture could not be loaded.</p>}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2">
            <div><dt className="text-[12.5px] font-bold uppercase text-slate-500">Place</dt><dd className="text-slate-900">{row.placeText || "—"}</dd></div>
            <div><dt className="text-[12.5px] font-bold uppercase text-slate-500">Position</dt><dd className="text-slate-900"><a href={mapLink(row.lat, row.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0077b6] hover:underline"><MapPin size={13} />{row.lat.toFixed(5)}, {row.lng.toFixed(5)}</a>{row.accuracyM != null ? ` (±${Math.round(row.accuracyM)} m)` : ""}</dd></div>
            <div><dt className="text-[12.5px] font-bold uppercase text-slate-500">Taken (phone's clock)</dt><dd className="text-slate-900">{when(row.capturedAt)}</dd></div>
            <div><dt className="text-[12.5px] font-bold uppercase text-slate-500">Received (our clock)</dt><dd className="text-slate-900">{when(row.submittedAt)}</dd></div>
            <div><dt className="text-[12.5px] font-bold uppercase text-slate-500">School</dt><dd className="text-slate-900">{row.school || "—"}</dd></div>
            <div><dt className="text-[12.5px] font-bold uppercase text-slate-500">Program</dt><dd className="text-slate-900">{row.program || "—"}</dd></div>
          </dl>
          {row.status !== "pending" && (
            <p className={`mt-3 rounded-lg border px-3 py-2 text-[14px] ${row.status === "approved" ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-800"}`}>
              {row.status === "approved" ? "Approved" : "Rejected"}{row.reviewerName ? ` by ${row.reviewerName}` : ""} on {when(row.reviewedAt)}.{row.rejectReason ? ` Reason: ${row.rejectReason}` : ""}
            </p>
          )}
        </div>
        {row.status !== "approved" && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
            {row.status === "pending" && <button onClick={onReject} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2.5 text-[14px] font-bold text-red-700 disabled:opacity-50">Reject</button>}
            <button onClick={onApprove} disabled={busy} className="rounded-lg bg-green-700 px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-50">{row.status === "rejected" ? "Approve instead" : "Approve"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RejectDialog({ row, busy, onCancel, onConfirm }: { row: ProgressRow; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Reject picture" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#062444]">Reject this picture?</h3>
        <p className="mt-1 text-[14px] text-slate-700">{row.scholarName} will have to take a picture again. You can tell them why (optional).</p>
        <label htmlFor="reject-reason" className="mt-3 block text-[13px] font-semibold text-slate-700">Reason (optional)</label>
        <textarea id="reject-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={3} placeholder="For example: too dark, not at the activity place."
          className="mt-1 w-full rounded-lg border border-[#062444]/20 px-3 py-2 text-[14px] outline-none focus:border-[#0088cc]" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2.5 text-[14px] font-semibold text-[#062444]">Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={busy} className="rounded-lg bg-red-700 px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-50">{busy ? "Rejecting…" : "Reject"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * SDP Monitoring > Progress Monitoring: the pictures scholars sent for the activities that confirm attendance with a picture. A row per scholar and activity: Scholar ID, Name,
 * School, Program, the picture (click to see it large) and Approve / Reject. An approved picture credits the scholar (the attendance and the SDP credit); a rejected one makes the
 * scholar take another picture. The list is read a page at a time (50) and refreshes by itself every 30 seconds.
 */
export function ProgressMonitoringSection() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [activityId, setActivityId] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ProgressCounts>({ pending: 0, approved: 0, rejected: 0 });
  const [activities, setActivities] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notReady, setNotReady] = useState(false);
  const [viewing, setViewing] = useState<ProgressRow | null>(null);
  const [rejecting, setRejecting] = useState<ProgressRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => { const t = setTimeout(() => { setQuery(search); setPage(0); }, 350); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [r, c] = await Promise.all([fetchProgressList({ status, activityId, search: query, page }), fetchProgressCounts(activityId)]);
    if (!r.ok) { setError(r.error); setNotReady(!!r.notReady); setRows([]); setTotal(0); }
    else { setError(""); setNotReady(false); setRows(r.rows); setTotal(r.total); setCounts(c); }
    if (!quiet) setLoading(false);
  }, [status, activityId, query, page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void fetchProgressActivities().then(setActivities); }, []);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && !viewing && !rejecting) void load(true); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, viewing, rejecting]);

  async function approve(row: ProgressRow) {
    setBusy(true); setNote("");
    const r = await approveProgress(row.id);
    setBusy(false);
    if (!r.ok) { setNote(r.error); return; }
    setNote(r.credit === "already_credited" ? `${row.scholarName} was already credited for this activity, so the picture is approved and no second credit was made.` : `Approved. ${row.scholarName} is credited.`);
    setViewing(null); await load(true);
  }
  async function reject(row: ProgressRow, reason: string) {
    setBusy(true); setNote("");
    const r = await rejectProgress(row.id, reason);
    setBusy(false);
    if (!r.ok) { setNote(r.error); return; }
    setNote(`Rejected. ${row.scholarName} will take the picture again.`);
    setRejecting(null); setViewing(null); await load(true);
  }

  const pages = Math.max(1, Math.ceil(total / PROGRESS_PAGE_SIZE));
  const chips = useMemo(() => ([
    ["pending", `Waiting (${counts.pending})`], ["approved", `Approved (${counts.approved})`], ["rejected", `Rejected (${counts.rejected})`], ["all", "All"],
  ] as [StatusFilter, string][]), [counts]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
        {chips.map(([key, label]) => (
          <button key={key} onClick={() => { setStatus(key); setPage(0); }} aria-pressed={status === key}
            className={`rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${status === key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444]"}`}>{label}</button>
        ))}
        <button onClick={() => void load()} aria-label="Refresh" className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 px-3 py-1.5 text-[14px] font-semibold text-[#062444]"><RefreshCw size={14} /> Refresh</button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID" aria-label="Search by name or Scholar ID"
            className="w-full rounded-lg border border-[#062444]/20 py-2.5 pl-9 pr-3 text-[14px] outline-none focus:border-[#0088cc]" />
        </div>
        <select value={activityId} onChange={e => { setActivityId(e.target.value); setPage(0); }} aria-label="Activity" className="min-w-[200px] rounded-lg border border-[#062444]/20 px-3 py-2.5 text-[14px] outline-none focus:border-[#0088cc]">
          <option value="">All activities with progress monitoring</option>
          {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {note && <p role="status" className="mb-3 rounded-lg border border-[#0088cc]/30 bg-[#eef6fc] px-3 py-2 text-[14px] text-[#062444]">{note}</p>}
      {error && <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-red-700"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-[#e6ecf5]">
        <table className="w-full text-[14px]">
          <thead className="bg-[#f7f9fc] text-left text-slate-700">
            <tr>
              <th className="px-3 py-2.5 font-bold">Scholar ID</th>
              <th className="px-3 py-2.5 font-bold">Name</th>
              <th className="px-3 py-2.5 font-bold">School</th>
              <th className="px-3 py-2.5 font-bold">Program</th>
              <th className="px-3 py-2.5 font-bold">Activity</th>
              <th className="px-3 py-2.5 font-bold">View image</th>
              <th className="px-3 py-2.5 font-bold">{status === "pending" ? "Approve / Reject" : "Status"}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-600"><Loader2 className="mx-auto animate-spin" /></td></tr>}
            {!loading && !error && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-600"><Camera className="mx-auto mb-2 opacity-40" />{status === "pending" ? "No pictures are waiting for approval." : "No pictures here."}</td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="border-t border-[#f0f3f8] align-middle">
                <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-[#062444]">{r.scholarIdNumber}</td>
                <td className="px-3 py-2.5 text-slate-900">{r.scholarName}</td>
                <td className="px-3 py-2.5 text-slate-800">{r.school || "—"}</td>
                <td className="px-3 py-2.5 text-slate-800">{r.program || "—"}</td>
                <td className="px-3 py-2.5 text-slate-800">{r.activityName}<span className="block text-[12.5px] text-slate-600">{when(r.submittedAt)}</span></td>
                <td className="px-3 py-2.5"><button onClick={() => setViewing(r)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#0077b6]/40 px-3 py-1.5 text-[13.5px] font-semibold text-[#0077b6] hover:bg-[#eef6fc]"><Eye size={14} /> View</button></td>
                <td className="px-3 py-2.5">
                  {r.status === "pending" ? (
                    <div className="flex gap-1.5">
                      <button onClick={() => void approve(r)} disabled={busy} className="rounded-lg bg-green-700 px-3 py-1.5 text-[13.5px] font-bold text-white disabled:opacity-50">Approve</button>
                      <button onClick={() => setRejecting(r)} disabled={busy} className="rounded-lg border border-red-300 px-3 py-1.5 text-[13.5px] font-bold text-red-700 disabled:opacity-50">Reject</button>
                    </div>
                  ) : <StatusChip row={r} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-[14px] text-slate-700">
        <span>{total === 0 ? "" : `${page * PROGRESS_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PROGRESS_PAGE_SIZE)} of ${total}`}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page" className="rounded-lg border border-[#062444]/25 p-2 disabled:opacity-40"><ChevronLeft size={16} /></button>
          <span>Page {page + 1} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page + 1 >= pages} aria-label="Next page" className="rounded-lg border border-[#062444]/25 p-2 disabled:opacity-40"><ChevronRight size={16} /></button>
        </div>
      </div>
      {notReady && <p className="mt-3 text-[13.5px] text-slate-600">Once the database update is run, activities with progress monitoring appear here. Attach it to an activity in <strong>SDP Activities</strong>: open the activity and choose the <strong>Progress Monitoring</strong> tab.</p>}

      {viewing && <PictureDialog row={viewing} busy={busy} onClose={() => setViewing(null)} onApprove={() => void approve(viewing)} onReject={() => setRejecting(viewing)} />}
      {rejecting && <RejectDialog row={rejecting} busy={busy} onCancel={() => setRejecting(null)} onConfirm={reason => void reject(rejecting, reason)} />}
    </div>
  );
}
