import { CheckCircle2, CircleDashed, AlertTriangle, SendHorizontal, ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { STANDING_LABEL, type StandingResult } from "@/lib/standing";
import { STATUS_LABEL, type ScholarStatus } from "../portalLogic";

/** Visible keyboard focus for every button/link in the School Portal. */
export const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0077b6] focus-visible:ring-offset-1";

/** Link-style button colour: a darker blue so it passes the 4.5:1 text contrast on white. */
export const linkButton = `font-semibold text-[#0077b6] hover:underline ${focusRing} rounded`;

export const fieldClass = `border border-[#062444]/30 rounded-lg bg-white px-3 py-2 text-[14px] text-[#062444] ${focusRing} focus-visible:border-[#0077b6] disabled:bg-slate-50 disabled:text-slate-600`;

const CHIP: Record<ScholarStatus, { cls: string; icon: React.ReactNode }> = {
  not_set_up: { cls: "text-slate-800 bg-slate-100 border-slate-300", icon: <CircleDashed size={13} aria-hidden="true" /> },
  not_graded: { cls: "text-amber-900 bg-amber-50 border-amber-300", icon: <AlertTriangle size={13} aria-hidden="true" /> },
  complete: { cls: "text-green-900 bg-green-50 border-green-300", icon: <CheckCircle2 size={13} aria-hidden="true" /> },
  submitted: { cls: "text-blue-900 bg-blue-50 border-blue-300", icon: <SendHorizontal size={13} aria-hidden="true" /> },
};

/** Status as a coloured chip WITH its text label — colour is never the only signal. */
export function StatusChip({ status }: { status: ScholarStatus }) {
  const c = CHIP[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-bold border rounded-full px-2.5 py-0.5 ${c.cls}`}>
      {c.icon} {STATUS_LABEL[status]}
    </span>
  );
}

/** A thin progress bar with an accessible text value. */
export function ProgressBar({ percent, label, tone = "blue" }: { percent: number; label: string; tone?: "blue" | "green" }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} aria-label={label}
      className="h-2 w-full rounded-full bg-[#e6ecf5] overflow-hidden">
      <div className={`h-full rounded-full ${tone === "green" || clamped === 100 ? "bg-green-600" : "bg-[#0077b6]"}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

const STANDING_CHIP: Partial<Record<StandingResult, { cls: string; icon: React.ReactNode }>> = {
  good: { cls: "text-green-900 bg-green-50 border-green-300", icon: <ShieldCheck size={13} aria-hidden="true" /> },
  at_risk: { cls: "text-amber-900 bg-amber-50 border-amber-300", icon: <ShieldAlert size={13} aria-hidden="true" /> },
  below: { cls: "text-red-900 bg-red-50 border-red-300", icon: <ShieldX size={13} aria-hidden="true" /> },
};

/** Scholarship standing as a coloured chip with its text label; "—" when there is no GWA yet / no requirement. */
export function StandingChip({ standing }: { standing: StandingResult }) {
  const c = STANDING_CHIP[standing];
  if (!c) return <span className="text-slate-700" title={STANDING_LABEL[standing]}>—<span className="sr-only"> {STANDING_LABEL[standing]}</span></span>;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-bold border rounded-full px-2.5 py-0.5 ${c.cls}`}>
      {c.icon} {STANDING_LABEL[standing]}
    </span>
  );
}
