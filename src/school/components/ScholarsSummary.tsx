import { SendHorizontal } from "lucide-react";
import { canSubmit, type PortalCounts } from "../portalLogic";
import { ProgressBar, focusRing } from "./portalParts";

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
 * Top of the Scholars tab: Total scholars | Complete | Declared, not graded | Not set up, an overall progress bar,
 * and the Submit grades button (disabled until every scholar is complete).
 * Submitting itself arrives in the next update (submission and locking), so the button stays disabled and says so.
 */
export function ScholarsSummary({ counts, loading }: { counts: PortalCounts; loading: boolean }) {
  const ready = canSubmit(counts);
  return (
    <section aria-label="Progress for this period" className="mb-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Stat label="Total scholars" value={counts.total} tone="navy" />
        <Stat label="Complete" value={counts.complete} tone="green" />
        <Stat label="Declared, not graded" value={counts.declaredNotGraded} tone="amber" />
        <Stat label="Not set up" value={counts.notSetUp} tone="slate" />
      </div>
      <div className="bg-white border border-[#e6ecf5] rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">
            {loading ? "Loading progress…" : `${counts.percent}% complete — ${counts.complete} of ${counts.total} scholar${counts.total === 1 ? "" : "s"}`}
          </p>
          <ProgressBar percent={counts.percent} label="Scholars with every subject graded" />
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <button disabled aria-disabled="true" title="Available once every scholar is complete — submitting opens in the next update"
            className={`flex items-center gap-2 bg-[#062444] text-white text-[14px] font-semibold rounded-lg px-4 py-2.5 opacity-50 cursor-not-allowed ${focusRing}`}>
            <SendHorizontal size={15} aria-hidden="true" /> Submit grades
          </button>
          <p className="text-[13.5px] text-slate-700 max-w-[19rem] sm:text-right">
            {ready
              ? "Every scholar is complete. Submitting grades will be available in the next update."
              : "Available once every scholar is complete."}
          </p>
        </div>
      </div>
    </section>
  );
}
