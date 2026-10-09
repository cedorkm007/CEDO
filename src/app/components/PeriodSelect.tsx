import { useId } from "react";
import type { PeriodOption } from "@/lib/academicPeriods";

/**
 * One labelled dropdown used everywhere a person picks an academic period (School Portal,
 * staff Scholars' Grades Monitoring, the scholar's Subjects and Grades). Options come from
 * periodOptions() in src/lib/academicPeriods.ts so they read the same on every screen.
 */
export function PeriodSelect({
  options, value, onChange, label = "Period", disabled = false, className = "",
}: {
  options: PeriodOption[];
  value: string;
  onChange: (key: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={id} className="text-[12.5px] font-bold text-[#062444] shrink-0">{label}</label>
      <select
        id={id} value={value} onChange={e => onChange(e.target.value)} disabled={disabled || options.length === 0}
        className="min-w-0 border border-[#062444]/20 rounded-lg bg-white px-2.5 py-1.5 text-[13px] text-[#062444] outline-none focus:border-[#0088cc] disabled:opacity-60"
      >
        {options.length === 0 && <option value="">No periods yet</option>}
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </div>
  );
}
