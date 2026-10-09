import { SendHorizontal, Lock, CheckCircle2, Unlock } from "lucide-react";
import type { PortalCounts } from "../portalLogic";
import { isLocked, type Submission, type SubmitReadiness } from "../submissionLogic";
import { formatWhen } from "@/lib/gradeEvidence";
import { ProgressBar, focusRing } from "./portalParts";
import type { StandingCounts } from "@/lib/standing";

function Stat({ label, value, tone }: { label: string; value: number; tone: "navy" | "green" | "amber" | "slate" }) {
  const color = tone === "green" ? "text-green-800" : tone === "amber" ? "text-amber-900" : tone === "slate" ? "text-slate-700" : "text-[#062444]";
  return (
    <div className="bg-white border border-[#e6ecf5] rounded-xl px-4 py-3">
      <p className={`text-[26px] leading-tight font-extrabold ${color}`}>{value}</p>
      <p className="text-[14px] text-slate-700">{label}</p>
    </div>
  );
}

/**
 * Top of the Scholars tab: Total scholars | Complete | Declared, not graded | Not set up, an overall progress bar and the
 * Submit grades button. The button is enabled only when every scholar is complete, the period is Open and the grading scale
 * is set up (see submitReadiness); once submitted it shows who/when and says the grades are locked. If CEDO reopened a
 * submission, that is said here too, with CEDO's reason.
 */
export function ScholarsSummary({ counts, loading, readiness, submission, onSubmit, standing }: {
  counts: PortalCounts; loading: boolean; readiness: SubmitReadiness; submission: Submission | null; onSubmit: () => void;
  /** Scholarship standing counts; null when the school has not saved a retention requirement. */
  standing?: StandingCounts | null;
}) {
  const locked = isLocked(submission);
  return (
    <section aria-label="Progress for this period" className="mb-5">
      {locked && submission && (
        <div role="status" className="flex items-start gap-2.5 bg-green-50 border border-green-300 rounded-xl px-4 py-3 mb-3">
          <CheckCircle2 size={18} className="text-green-800 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[14.5px] text-green-950">
            <strong>Submitted on {formatWhen(submission.submittedAt)}.</strong> These grades are now locked. To change a grade, open the scholar's grades and use <strong>Request correction</strong>;
            CEDO has to approve it. To add or remove a subject, ask CEDO to reopen your submission.
          </p>
        </div>
      )}
      {!locked && submission?.status === "reopened" && (
        <div role="status" className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-3">
          <Unlock size={18} className="text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-[14.5px] text-amber-950">
            <strong>CEDO reopened this submission{submission.reopenedAt ? ` on ${formatWhen(submission.reopenedAt)}` : ""}.</strong>
            {submission.reopenNote ? ` Reason: ${submission.reopenNote}.` : ""} Make your changes, then submit the grades again.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Stat label="Total scholars" value={counts.total} tone="navy" />
        <Stat label="Complete" value={counts.complete} tone="green" />
        <Stat label="Declared, not graded" value={counts.declaredNotGraded} tone="amber" />
        <Stat label="Not set up" value={counts.notSetUp} tone="slate" />
      </div>
      {standing && (
        <p className="text-[14.5px] text-slate-800 mb-3" aria-label="Scholarship standing">
          <strong className="text-[#062444]">Scholarship standing:</strong>{" "}
          <span className="text-green-900 font-semibold">{standing.good} good</span> ·{" "}
          <span className="text-amber-900 font-semibold">{standing.atRisk} at risk</span> ·{" "}
          <span className="text-red-900 font-semibold">{standing.below} below requirement</span>
          {standing.noGwa > 0 && <span className="text-slate-700"> · {standing.noGwa} with no GWA yet</span>}
        </p>
      )}
      <div className="bg-white border border-[#e6ecf5] rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">
            {loading ? "Loading progress…" : `${counts.percent}% complete — ${counts.complete} of ${counts.total} scholar${counts.total === 1 ? "" : "s"}`}
          </p>
          <ProgressBar percent={counts.percent} label="Scholars with every subject graded" />
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          {locked ? (
            <button type="button" disabled aria-disabled="true"
              className="flex items-center gap-2 bg-green-800 text-white text-[14px] font-semibold rounded-lg px-4 py-2.5 opacity-90 cursor-default">
              <Lock size={15} aria-hidden="true" /> Submitted
            </button>
          ) : (
            <button type="button" onClick={onSubmit} disabled={!readiness.ok} aria-disabled={!readiness.ok}
              className={`flex items-center gap-2 bg-[#062444] text-white text-[14px] font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`}>
              <SendHorizontal size={15} aria-hidden="true" /> Submit grades
            </button>
          )}
          <p className="text-[13.5px] text-slate-700 max-w-[19rem] sm:text-right">
            {locked ? "Grades are locked until CEDO approves a correction or reopens the submission."
              : readiness.ok ? "Every scholar is complete — you can submit now."
              : readiness.reason}
          </p>
        </div>
      </div>
    </section>
  );
}
