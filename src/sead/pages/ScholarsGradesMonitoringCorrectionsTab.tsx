import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { fetchAllCorrections, reviewCorrection, type StaffCorrection } from "../gradesReviewApi";
import { CorrectionStatusChip } from "@/school/components/CorrectionsPanel";
import { formatWhen } from "@/lib/gradeEvidence";

type Filter = "pending" | "open" | "all";

function ReviewControls({ request, onDone }: { request: StaffCorrection; onDone: () => void }) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!mode) return;
    if (mode === "reject" && note.trim().length < 3) { setError("Please tell the school why the request is rejected."); return; }
    setBusy(true); setError("");
    const result = await reviewCorrection(request.id, mode === "approve", note);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setMode(null); setNote("");
    onDone();
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={() => setMode("approve")} className="flex items-center gap-1.5 bg-green-700 text-white text-[13px] font-semibold rounded-lg px-3.5 py-1.5">
          <CheckCircle2 size={14} aria-hidden="true" /> Approve
        </button>
        <button onClick={() => setMode("reject")} className="flex items-center gap-1.5 border border-red-700 text-red-800 bg-white text-[13px] font-semibold rounded-lg px-3.5 py-1.5">
          <XCircle size={14} aria-hidden="true" /> Reject
        </button>
      </div>
    );
  }
  const id = `review-note-${request.id}`;
  return (
    <div className="mt-3 border border-[#e6ecf5] rounded-lg p-3 bg-[#f7f9fc]">
      <label htmlFor={id} className="block text-[13px] font-semibold text-[#062444] mb-1">
        {mode === "approve" ? "Note to the school (optional)" : "Why is it rejected? (the school will see this)"}
      </label>
      <textarea id={id} value={note} onChange={e => setNote(e.target.value)} rows={2}
        className="w-full border border-[#062444]/30 rounded-lg px-2.5 py-2 text-[13.5px] outline-none focus:border-[#0088cc] bg-white" />
      {error && <p role="alert" className="text-[13px] text-red-700 mt-1.5">{error}</p>}
      <div className="flex justify-end gap-2 mt-2">
        <button onClick={() => { setMode(null); setError(""); }} className="px-3.5 py-1.5 rounded-lg border border-[#062444]/30 text-[13px] font-semibold text-[#062444] bg-white">Back</button>
        <button onClick={() => void submit()} disabled={busy}
          className={`px-3.5 py-1.5 rounded-lg text-white text-[13px] font-semibold disabled:opacity-60 ${mode === "approve" ? "bg-green-700" : "bg-red-700"}`}>
          {busy ? "Saving…" : mode === "approve" ? "Confirm approval" : "Confirm rejection"}
        </button>
      </div>
    </div>
  );
}

/**
 * Staff review of schools' correction requests: which school, scholar and subject, the current and proposed grade, the school's
 * reason. Approving lets the school change that ONE grade once; rejecting needs a reason the school will see.
 */
export function ScholarsGradesMonitoringCorrectionsTab() {
  const [rows, setRows] = useState<StaffCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");

  const load = useCallback(async () => {
    const result = await fetchAllCorrections();
    if (result.ok) { setRows(result.rows); setError(""); } else setError(result.error);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => rows.filter(r => filter === "all" ? true : filter === "open" ? (r.status === "pending" || r.status === "approved") : r.status === "pending"), [rows, filter]);
  const pendingCount = rows.filter(r => r.status === "pending").length;

  if (loading) return <p className="text-[13px] text-slate-600 text-center py-10">Loading…</p>;

  return (
    <div>
      <p className="text-[13.5px] text-slate-700 mb-3">
        Once a school submits a period its grades are locked. These are its requests to correct a grade. Approving lets the school change that one grade once.
      </p>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2 mb-4">
        {([["pending", `Waiting for review (${pendingCount})`], ["open", "Waiting or approved"], ["all", "All requests"]] as [Filter, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
            className={`text-[13px] font-semibold rounded-full px-3.5 py-1.5 border ${filter === key ? "bg-[#062444] border-[#062444] text-white" : "bg-white border-[#062444]/30 text-[#062444]"}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-[13px] text-red-700 mb-3">Couldn't load the requests: {error} (has the Phase 6 migration been run?)</p>}
      {shown.length === 0 ? (
        <div className="bg-white border border-dashed border-[#062444]/25 rounded-xl px-5 py-8 text-center text-[13.5px] text-slate-700">
          {filter === "pending" ? "No correction requests are waiting for review." : "Nothing to show."}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map(r => (
            <li key={r.id} className="bg-white border border-[#e6ecf5] rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <p className="font-bold text-[14px] text-[#062444]">{r.schoolName}</p>
                <CorrectionStatusChip status={r.status} />
              </div>
              <p className="text-[13.5px] text-slate-800">
                <strong className="text-[#062444]">{r.subject}{r.subjectCode ? ` (${r.subjectCode})` : ""}</strong> — scholar {r.scholarIdNumber} · {r.periodLabel}
              </p>
              <p className="text-[13.5px] text-slate-800 mt-0.5">
                Grade {r.currentGrade || "none"}{r.proposedGrade ? ` → ${r.proposedGrade}` : ""} <span className="text-slate-600">· requested {formatWhen(r.requestedAt)}</span>
              </p>
              <p className="text-[13.5px] text-slate-800 mt-1"><strong className="text-[#062444]">Reason:</strong> {r.reason}</p>
              {r.reviewedAt && (
                <p className="text-[13.5px] text-slate-800 mt-1">
                  <strong className="text-[#062444]">{r.reviewedByLabel ?? "CEDO"}, {formatWhen(r.reviewedAt)}:</strong> {r.reviewNote || (r.status === "approved" ? "Approved." : "")}
                </p>
              )}
              {r.status === "pending" && <ReviewControls request={r} onDone={() => void load()} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
