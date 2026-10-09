// Shared GWA computation — used by the School Portal, the scholar portal's Grades tab
// (src/scholar/components/dashboard/SubjectsGradesPanel.tsx) and the staff
// "Scholars' Grades Monitoring" tool's grade drill-down, so every side
// computes the exact same number from the same school grading config.
//
// GWA = sum(grade x units) / sum(units), over the subjects whose grade resolves
// to a number and that are not excluded from the GWA (NSTP, PE, ...). A subject
// with no units yet counts as 1 unit (owner decision, Phase 4) — the School Portal
// flags those so the school can fill them in. If nothing resolves the GWA is null
// and shown as "—".

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
  /** Credit units; null/undefined = not set yet, counted as DEFAULT_UNITS. */
  units?: number | null;
  /** True for subjects the school keeps out of the GWA (e.g. NSTP, PE). */
  excludeFromGwa?: boolean;
}

/** What a subject weighs when the school has not entered its units yet. */
export const DEFAULT_UNITS = 1;

/** The weight a subject carries in the GWA. */
export function effectiveUnits(row: Pick<GradeLike, "units">): number {
  return row.units != null && row.units > 0 ? row.units : DEFAULT_UNITS;
}

/** A subject that counts toward the GWA but still has no units entered (so it is being counted as 1 unit). Excluded subjects do not need units. */
export function needsUnits(row: Pick<GradeLike, "units" | "excludeFromGwa">): boolean {
  return !row.excludeFromGwa && (row.units == null || !(row.units > 0));
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

export interface GwaDetail {
  /** Null when no counted subject has a grade that resolves to a number. */
  gwa: number | null;
  /** Subjects that went into the number. */
  subjectsCounted: number;
  /** Sum of the units that went into the number (the divisor). */
  unitsCounted: number;
  /** Of the counted subjects, how many had no units and were counted as 1 unit. */
  countedWithoutUnits: number;
  /** Subjects left out because they are marked "Exclude from GWA". */
  excluded: number;
}

/** The GWA together with how it was made up — for screens that explain the number. */
export function gwaDetail(rows: GradeLike[], letterGrades: LetterGrade[]): GwaDetail {
  let weighted = 0;
  let unitsCounted = 0;
  let subjectsCounted = 0;
  let countedWithoutUnits = 0;
  let excluded = 0;
  for (const r of rows) {
    if (r.excludeFromGwa) { excluded++; continue; }
    const value = resolveGradeValue(r.grade, letterGrades);
    if (value === null) continue;
    const weight = effectiveUnits(r);
    weighted += value * weight;
    unitsCounted += weight;
    subjectsCounted++;
    if (r.units == null || !(r.units > 0)) countedWithoutUnits++;
  }
  return {
    gwa: unitsCounted > 0 ? weighted / unitsCounted : null,
    subjectsCounted, unitsCounted, countedWithoutUnits, excluded,
  };
}

/** The units-weighted GWA of `rows`; null if none resolve (e.g. an all-blank, all-INC or all-excluded group), so callers can show "—" instead of a misleading "GWA: 0.00". */
export function computeGwa(rows: GradeLike[], letterGrades: LetterGrade[]): number | null {
  return gwaDetail(rows, letterGrades).gwa;
}

export function formatGwa(gwa: number | null): string {
  return gwa === null ? "—" : gwa.toFixed(2);
}
