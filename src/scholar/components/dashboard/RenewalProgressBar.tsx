import { AlertTriangle, Check } from "lucide-react";
import type { ProgressStep } from "@/lib/renewal";

/**
 * The renewal's progress as a row of steps: done (green tick), where you are now (dark, "You are here"), still to come (grey) and a problem
 * (amber). Wraps to a vertical list on a phone. Words as well as colour, so it never relies on colour alone.
 */
export function RenewalProgressBar({ steps }: { steps: ProgressStep[] }) {
  if (steps.length === 0) return null;
  const current = steps.findIndex(s => s.state === "current" || s.state === "problem");
  return (
    <nav aria-label="Renewal progress">
      <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-2 sm:gap-y-2">
        {steps.map((s, i) => {
          const tone =
            s.state === "done" ? "border-green-300 bg-green-50 text-green-900"
            : s.state === "current" ? "border-[#062444] bg-[#062444] text-white"
            : s.state === "problem" ? "border-amber-400 bg-amber-50 text-amber-950"
            : "border-slate-300 bg-white text-slate-700";
          return (
            <li key={s.key} aria-current={i === current ? "step" : undefined} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[14px] font-semibold ${tone}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                s.state === "done" ? "bg-green-700 text-white" : s.state === "current" ? "bg-white text-[#062444]" : s.state === "problem" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-800"}`}>
                {s.state === "done" ? <Check size={14} aria-hidden="true" /> : s.state === "problem" ? <AlertTriangle size={13} aria-hidden="true" /> : i + 1}
              </span>
              <span>
                {s.label}
                {s.state === "done" && <span className="sr-only"> — done</span>}
                {s.state === "current" && <span className="block text-[13px] font-bold text-[#F3BC00]">You are here</span>}
                {s.note && <span className="block text-[13px] font-normal">{s.note}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
