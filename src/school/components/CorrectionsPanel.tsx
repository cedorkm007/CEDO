import { useMemo, useState } from "react";
import { CheckCircle2, Clock, XCircle, Ban, BadgeCheck } from "lucide-react";
import { cancelCorrection } from "../submissionApi";
import { CORRECTION_STATUS_LABEL, type CorrectionRequest, type CorrectionStatus } from "../submissionLogic";
import { formatWhen } from "@/lib/gradeEvidence";
import { scholarName } from "../portalLogic";
import { focusRing, linkButton } from "./portalParts";
import type { SchoolScholarRow } from "../types";

type Filter = "open" | "all";

const CHIP: Record<CorrectionStatus, { cls: string; icon: React.ReactNode }> = {
  pending: { cls: "text-amber-900 bg-amber-50 border-amber-300", icon: <Clock size={13} aria-hidden="true" /> },
  approved: { cls: "text-green-900 bg-green-50 border-green-300", icon: <CheckCircle2 size={13} aria-hidden="true" /> },
  rejected: { cls: "text-red-900 bg-red-50 border-red-300", icon: <XCircle size={13} aria-hidden="true" /> },
  applied: { cls: "text-blue-900 bg-blue-50 border-blue-300", icon: <BadgeCheck size={13} aria-hidden="true" /> },
  cancelled: { cls: "text-slate-800 bg-slate-100 border-slate-300", icon: <Ban size={13} aria-hidden="true" /> },
};

export function CorrectionStatusChip({ status }: { status: CorrectionStatus }) {
  const c = CHIP[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-bold border rounded-full px-2.5 py-0.5 ${c.cls}`}>
      {c.icon} {CORRECTION_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The school's correction requests: which grade, why, what CEDO decided and why. A request CEDO approved shows
 * "Open grades" — the one change it allows is made in the scholar's grade-entry window. A pending request can be cancelled.
 */
export function CorrectionsPanel({ corrections, error, scholars, onOpenScholar, onChanged }: {
  corrections: CorrectionRequest[]; error: string; scholars: SchoolScholarRow[];
  onOpenScholar: (scholar: SchoolScholarRow) => void; onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const byId = useMemo(() => new Map(scholars.map(s => [s.scholarIdNumber, s])), [scholars]);
  const shown = filter === "all" ? corrections : corrections.filter(c => c.status === "pending" || c.status === "approved");

  async function cancel(id: string) {
    setBusy(id); setActionError("");
    const result = await cancelCorrection(id);
    setBusy(null);
    if (!result.ok) { setActionError(result.error); return; }
    onChanged();
  }

  return (
    <section aria-label="Correction requests">
      <h2 className="text-[18px] font-bold text-[#062444] mb-1">Correction requests</h2>
      <p className="text-[14.5px] text-slate-800 mb-4">
        After you submit grades they are locked. To change a grade, open the scholar's grades and choose <strong>Request correction</strong>.
        CEDO reviews it; if it is approved you can change that one grade once.
      </p>
      <div role="group" aria-label="Show" className="flex gap-2 mb-3">
        {([["open", "Open requests"], ["all", "All requests"]] as [Filter, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
            className={`text-[14px] font-semibold rounded-full px-3.5 py-1.5 border ${focusRing} ${filter === key ? "bg-[#062444] border-[#062444] text-white" : "bg-white border-[#062444]/40 text-[#062444]"}`}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-[14.5px] text-red-800 mb-3">Couldn't load your requests: {error}</p>}
      {actionError && <p role="alert" className="text-[14.5px] text-red-800 mb-3">{actionError}</p>}
      {shown.length === 0 ? (
        <div className="bg-white border border-dashed border-[#062444]/30 rounded-xl px-5 py-8 text-center text-[14.5px] text-slate-800">
          {filter === "open" ? "No open correction requests." : "You haven't sent any correction requests yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map(c => {
            const scholar = byId.get(c.scholarIdNumber);
            return (
              <li key={c.id} className="bg-white border border-[#e6ecf5] rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <p className="font-bold text-[15px] text-[#062444]">
                    {c.subject}{c.subjectCode ? ` (${c.subjectCode})` : ""} — {scholar ? scholarName(scholar) : c.scholarIdNumber}
                  </p>
                  <CorrectionStatusChip status={c.status} />
                </div>
                <p className="text-[14.5px] text-slate-800">
                  Grade {c.currentGrade || "none"}{c.proposedGrade ? ` → ${c.proposedGrade}` : ""}
                  <span className="text-slate-700"> · requested {formatWhen(c.requestedAt)}</span>
                </p>
                <p className="text-[14.5px] text-slate-800 mt-1"><strong className="text-[#062444]">Your reason:</strong> {c.reason}</p>
                {c.reviewedAt && (
                  <p className="text-[14.5px] text-slate-800 mt-1">
                    <strong className="text-[#062444]">CEDO{c.reviewedByLabel ? ` (${c.reviewedByLabel})` : ""}, {formatWhen(c.reviewedAt)}:</strong> {c.reviewNote || (c.status === "approved" ? "Approved." : "")}
                  </p>
                )}
                <div className="flex flex-wrap gap-4 mt-2.5">
                  {c.status === "approved" && scholar && (
                    <button onClick={() => onOpenScholar(scholar)} className={`${linkButton} text-[14.5px]`}>Open grades and make the change</button>
                  )}
                  {c.status === "pending" && (
                    <button onClick={() => void cancel(c.id)} disabled={busy === c.id} className={`${linkButton} text-[14.5px] disabled:opacity-50`}>
                      {busy === c.id ? "Cancelling…" : "Cancel request"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
