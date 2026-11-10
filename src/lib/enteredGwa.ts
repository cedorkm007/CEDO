// ─────────────────────────────────────────────────────────────
// src/lib/enteredGwa.ts
// The GWA of the grades a scholar ENTERED in the renewal (Scholar Renewal > Entered grades, the application's detail, the scholar's own Grades tile and the entry form).
// Same calculation as the rest of the site (src/lib/gwa.ts): the sum of grade x units divided by the units, over the subjects whose grade is a number; shown with 2 decimals.
// INC, DRP, letters and other marks are not numbers, so they are left out of the number and named next to it.
// ─────────────────────────────────────────────────────────────
import { formatGwa, gwaDetail } from "./gwa";
import { compactGrade } from "./gradeCheck";

export interface EnteredGwa { gwa: number | null; text: string; subjectsCounted: number; subjectsTotal: number; unitsCounted: number; notCounted: string[] }

/** `lines`: the entered subjects (units may be text or number; a grade with a stray space such as "1 .0" is read as 1.0). */
export function enteredGwa(lines: { grade: string; units?: string | number | null }[]): EnteredGwa {
  const rows = lines.filter(l => String(l.grade ?? "").trim() !== "").map(l => {
    const u = typeof l.units === "number" ? l.units : Number(String(l.units ?? "").replace(",", "."));
    return { grade: compactGrade(String(l.grade)), units: Number.isFinite(u) && u > 0 ? u : null };
  });
  const d = gwaDetail(rows, []);
  const notCounted = [...new Set(rows.filter(r => !Number.isFinite(Number(r.grade)) || r.grade === "").map(r => r.grade.toUpperCase()))];
  return { gwa: d.gwa, text: formatGwa(d.gwa), subjectsCounted: d.subjectsCounted, subjectsTotal: rows.length, unitsCounted: d.unitsCounted, notCounted };
}
