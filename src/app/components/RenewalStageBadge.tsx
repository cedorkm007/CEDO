import { CheckCircle2, Clock, AlertTriangle, Info, MinusCircle } from "lucide-react";
import { STAGE_INFO, type StageTone } from "@/lib/renewal";

const TONE: Record<StageTone, { cls: string; icon: React.ReactNode }> = {
  success: { cls: "border-green-300 bg-green-50 text-green-900", icon: <CheckCircle2 size={14} aria-hidden="true" /> },
  info: { cls: "border-sky-300 bg-sky-50 text-sky-900", icon: <Info size={14} aria-hidden="true" /> },
  warning: { cls: "border-amber-400 bg-amber-50 text-amber-900", icon: <Clock size={14} aria-hidden="true" /> },
  danger: { cls: "border-red-300 bg-red-50 text-red-800", icon: <AlertTriangle size={14} aria-hidden="true" /> },
  neutral: { cls: "border-slate-300 bg-slate-100 text-slate-800", icon: <MinusCircle size={14} aria-hidden="true" /> },
};

/** The stage of a renewal as a coloured chip — always words and an icon, never colour alone. Used by the scholar's Renewal tile and the staff board. */
export function RenewalStageBadge({ stage, full = false }: { stage: string; full?: boolean }) {
  const info = (STAGE_INFO as Record<string, { title: string; short: string; tone: StageTone }>)[stage];
  const tone = TONE[info?.tone ?? "neutral"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${tone.cls}`}>
      {tone.icon}
      {info ? (full ? info.title : info.short) : stage}
    </span>
  );
}

