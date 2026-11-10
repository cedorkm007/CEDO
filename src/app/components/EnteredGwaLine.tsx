import { enteredGwa } from "@/lib/enteredGwa";

/** One line under a list of entered subjects: "GWA of these grades: 1.43 (weighted by units · 7 of 9 subjects counted; INC, DRP are not counted)". Nothing when no grade is a number yet. */
export function EnteredGwaLine({ lines, className = "" }: { lines: { grade: string; units?: string | number | null }[]; className?: string }) {
  const g = enteredGwa(lines);
  if (g.gwa === null) return null;
  return (
    <p className={`mt-2 text-[14px] text-slate-900 ${className}`} data-testid="entered-gwa">
      <span className="font-bold text-[#062444]">GWA of these grades: {g.text}</span>
      <span className="text-slate-700"> (weighted by units · {g.subjectsCounted} of {g.subjectsTotal} subject{g.subjectsTotal === 1 ? "" : "s"} counted{g.notCounted.length > 0 ? `; ${g.notCounted.join(", ")} not counted` : ""})</span>
    </p>
  );
}
