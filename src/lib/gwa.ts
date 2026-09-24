// Shared GWA computation — used by both the scholar portal's Grades tab
// (src/scholar/components/dashboard/SubjectsGradesPanel.tsx) and the staff
// "Scholars' Grades Monitoring" tool's grade drill-down, so both sides
// compute the exact same number from the same school grading config. A
// simple (unweighted) average — no `units`/credit-hours field exists
// anywhere in the schema or was requested alongside Subject Code/Name/Grade.

export interface GradingConfig {
  scaleMin: number;
  scaleMax: number;
  direction: "lower_is_better" | "higher_is_better";
  usesLetterGrades: boolean;
}

export interface LetterGrade {
  letter: string;
  numericValue: number | null;
}

export interface GradeLike {
  grade: string;
}

/** Resolves one grade string to a number: a plain numeric string first, else a letter-grade lookup. Returns null if unresolvable (blank, or an unmapped letter/non-numeric mark like "INC"). */
function resolveGradeValue(grade: string, letterGrades: LetterGrade[]): number | null {
  const trimmed = grade.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) return numeric;
  const match = letterGrades.find(l => l.letter.trim().toLowerCase() === trimmed.toLowerCase());
  return match?.numericValue ?? null;
}

/** Simple average of every resolvable grade in `rows`; null if none resolve (e.g. an all-blank or all-INC group), so callers can show "—" instead of a misleading "GWA: 0.00". */
export function computeGwa(rows: GradeLike[], letterGrades: LetterGrade[]): number | null {
  const values = rows.map(r => resolveGradeValue(r.grade, letterGrades)).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function formatGwa(gwa: number | null): string {
  return gwa === null ? "—" : gwa.toFixed(2);
}
