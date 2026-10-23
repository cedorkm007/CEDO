import { BookOpen } from "lucide-react";
import type { LetterGrade } from "@/lib/gwa";

const COUNTS_AS: Record<NonNullable<LetterGrade["outcome"]>, string> = {
  passed: "Passed",
  failed: "Failed",
  incomplete: "Incomplete (tracked like INC, not failed by itself)",
  review: "Needs review by CEDO",
};

/** The marks every school can enter, whatever its grading system. */
const BUILT_IN: { mark: string; meaning: string; countsAs: string }[] = [
  { mark: "INC", meaning: "Incomplete: the subject's requirements are not complete yet", countsAs: COUNTS_AS.incomplete },
  { mark: "DRP", meaning: "Dropped: the scholar dropped the subject", countsAs: "Failed (a dropped subject counts as failed)" },
];

/**
 * "What do the marks mean?": the list of non-numeric marks (INC, DRP and the school's own, for example F or D/F) with what each stands for and what it counts as.
 * Shown to the school, to the scholar and to CEDO staff, always from the same data (the school's own marks), so everyone reads the same list.
 */
export function MarksGuide({ marks, className = "" }: { marks: LetterGrade[]; className?: string }) {
  const own = marks.filter(m => m.outcome);
  const letters = marks.filter(m => !m.outcome && m.letter.trim() && m.numericValue != null);
  return (
    <details className={`rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-2.5 ${className}`}>
      <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold text-[#062444]">
        <BookOpen size={15} aria-hidden="true" /> What do the marks mean?
      </summary>
      <div className="mt-2.5 overflow-x-auto" tabIndex={0} role="region" aria-label="Meaning of the non-numeric marks">
        <table className="w-full min-w-[420px] text-left text-[14px]">
          <thead><tr className="text-[#062444]"><th scope="col" className="py-1.5 pr-3">Mark</th><th scope="col" className="py-1.5 pr-3">Stands for</th><th scope="col" className="py-1.5">Counts as</th></tr></thead>
          <tbody>
            {[...BUILT_IN, ...own.map(m => ({ mark: m.letter, meaning: m.meaning || "", countsAs: COUNTS_AS[m.outcome!] }))].map(r => (
              <tr key={r.mark} className="border-t border-[#e6ecf5] align-top">
                <th scope="row" className="py-1.5 pr-3 font-bold text-[#062444] whitespace-nowrap">{r.mark}</th>
                <td className="py-1.5 pr-3 text-slate-800">{r.meaning}</td>
                <td className="py-1.5 text-slate-800">{r.countsAs}</td>
              </tr>
            ))}
            {letters.map(l => (
              <tr key={`letter-${l.letter}`} className="border-t border-[#e6ecf5] align-top">
                <th scope="row" className="py-1.5 pr-3 font-bold text-[#062444] whitespace-nowrap">{l.letter}</th>
                <td className="py-1.5 pr-3 text-slate-800">Letter grade, worth {l.numericValue} on the school's scale</td>
                <td className="py-1.5 text-slate-800">Judged by that number against the passing mark</td>
              </tr>
            ))}
          </tbody>
        </table>
        {own.length === 0 && <p className="mt-2 text-[13.5px] text-slate-600">This school has not added any other marks.</p>}
      </div>
    </details>
  );
}
