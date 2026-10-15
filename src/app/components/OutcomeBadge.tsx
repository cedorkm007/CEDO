import { XCircle, AlertCircle, HelpCircle } from "lucide-react";
import type { OutcomeCounts, SubjectOutcome } from "@/lib/subjectOutcome";

/**
 * The flag shown beside a subject's grade wherever grades are listed (School Portal, staff Grades Monitoring, the scholar's own
 * grades): Failed, DRP (counts as failed), INC, or "Needs review" for a mark nobody can read. Always carries words and an icon,
 * never colour alone. Renders nothing for passed / ungraded / no-passing-mark subjects.
 */
export function OutcomeBadge({ outcome }: { outcome: SubjectOutcome }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-bold";
  if (outcome === "failed") {
    return <span className={`${base} border-red-300 bg-red-50 text-red-800`}><XCircle size={13} aria-hidden="true" /> Failed</span>;
  }
  if (outcome === "drp") {
    return <span className={`${base} border-red-300 bg-red-50 text-red-800`}><XCircle size={13} aria-hidden="true" /> DRP<span className="font-semibold"> (counts as failed)</span></span>;
  }
  if (outcome === "inc") {
    return <span className={`${base} border-amber-400 bg-amber-50 text-amber-900`}><AlertCircle size={13} aria-hidden="true" /> INC</span>;
  }
  if (outcome === "review") {
    return <span className={`${base} border-slate-400 bg-slate-100 text-slate-800`}><HelpCircle size={13} aria-hidden="true" /> Needs review</span>;
  }
  return null;
}

/** Left-edge colour for a subject's row, matching its badge. */
export function outcomeRowClass(outcome: SubjectOutcome): string {
  if (outcome === "failed" || outcome === "drp") return "border-l-4 border-red-500 pl-2";
  if (outcome === "inc") return "border-l-4 border-amber-500 pl-2";
  if (outcome === "review") return "border-l-4 border-slate-400 pl-2";
  return "";
}

/** Small count chips for a scholar's row in a list: "2 failed", "1 INC", "1 to review". Renders nothing when there is nothing to flag. */
export function OutcomeCountChips({ counts }: { counts: OutcomeCounts }) {
  if (counts.failed === 0 && counts.inc === 0 && counts.review === 0) return null;
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-bold";
  return (
    <>
      {counts.failed > 0 && (
        <span className={`${base} border-red-300 bg-red-50 text-red-800`} title={counts.drp > 0 ? `Includes ${counts.drp} DRP (counts as failed)` : undefined}>
          <XCircle size={12} aria-hidden="true" /> {counts.failed} failed
        </span>
      )}
      {counts.inc > 0 && (
        <span className={`${base} border-amber-400 bg-amber-50 text-amber-900`}><AlertCircle size={12} aria-hidden="true" /> {counts.inc} INC</span>
      )}
      {counts.review > 0 && (
        <span className={`${base} border-slate-400 bg-slate-100 text-slate-800`}><HelpCircle size={12} aria-hidden="true" /> {counts.review} to review</span>
      )}
    </>
  );
}
