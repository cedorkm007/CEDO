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
  retentionThreshold?: number | null;
  /** The school's passing mark on its own scale; a grade worse than this is failed. null/undefined = not set yet. */
  passingMark?: number | null;
}

/** What a school's own non-numeric mark (F, D/F, W...) means for renewal. */
export type MarkOutcome = "passed" | "failed" | "incomplete" | "review";

export interface LetterGrade {
  letter: string;
  numericValue: number | null;
  /** Set on a school's own non-numeric mark (the "other marks" list): what it means for renewal. Letter-table entries leave it empty. */
  outcome?: MarkOutcome;
  /** What the mark stands for, in the school's words (only on the school's own marks). */
  meaning?: string;
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

// ── GWA under a school's own GWA settings (School Portal > Grading System > GWA Computation) ──────────
// Phase 1 uses it for the "sample computation" and the preview of what a change would do; Phase 2 switches every screen to it. With the default settings it gives the same number as
// computeGwa() above. Everything a school can choose is in GwaSettings.

export interface GwaSettings {
  method: "weighted" | "simple";
  gradeUsed: "equivalent" | "percentage";
  decimals: 2 | 3 | 4;
  rounding: "round" | "cut";
  includeFailed: boolean;
  /** Special marks that count as a number in the GWA (e.g. DRP counts as 5). Marks not listed are left out. */
  specialValues: Record<string, number>;
  /** Subject codes excluded from the GWA when a subject is first saved (e.g. NSTP, PE). The per-subject tick still decides each subject. */
  excludedCodes: string[];
  /** The GWA a scholar must keep, on the scale of the GWA (a percentage when the GWA uses percentages). null = the school's existing requirement. */
  retentionThreshold: number | null;
}

/** Today's behaviour: units-weighted, the equivalent grade, 2 decimals, rounded, failed grades included, special marks left out. */
export const DEFAULT_GWA_SETTINGS: GwaSettings = { method: "weighted", gradeUsed: "equivalent", decimals: 2, rounding: "round", includeFailed: true, specialValues: {}, excludedCodes: [], retentionThreshold: null };

/** Rounds (or cuts off) to the chosen decimals without the binary-fraction surprises (1.005 rounds to 1.01; 1.7483 cuts to 1.74). */
export function roundTo(value: number, decimals: number, mode: "round" | "cut"): number {
  const s = String(value);
  if (s.includes("e")) return mode === "round" ? Number(value.toFixed(decimals)) : Math.trunc(value * 10 ** decimals) / 10 ** decimals;
  const shifted = Number(`${s}e${decimals}`);
  const whole = mode === "round" ? Math.round(shifted) : Math.trunc(shifted);
  return Number(`${whole}e-${decimals}`);
}

/** The GWA as shown: "—" when there is none, otherwise rounded or cut off to the school's decimals. */
export function formatWith(value: number | null, s: Pick<GwaSettings, "decimals" | "rounding">): string {
  return value === null ? "—" : roundTo(value, s.decimals, s.rounding).toFixed(s.decimals);
}

export interface GwaSettingsRow extends GradeLike {
  /** The percentage of the subject, when the school enters percentages. */
  percentage?: number | null;
  /** True when the subject is judged failed (only looked at when failed grades are left out). */
  failed?: boolean;
}
export type GwaLineReason = "" | "special" | "excluded" | "no_number" | "failed";
export interface GwaSettingsLine { value: number | null; units: number; counted: boolean; reason: GwaLineReason }
export interface GwaSettingsResult { gwa: number | null; lines: GwaSettingsLine[]; subjectsCounted: number; unitsCounted: number; formula: string }

/**
 * A subject counts when it is not excluded, has a number to use (its grade, or its percentage when the GWA uses percentages, or the special number set for its mark) and is not a
 * failed subject while failed grades are left out. A subject without units weighs 1 unit. null GWA when nothing counts.
 */
export function gwaWithSettings(rows: GwaSettingsRow[], letterGrades: LetterGrade[], s: GwaSettings): GwaSettingsResult {
  const lines: GwaSettingsLine[] = rows.map(r => {
    const units = effectiveUnits(r);
    if (r.excludeFromGwa) return { value: null, units, counted: false, reason: "excluded" };
    const special = Object.entries(s.specialValues).find(([k]) => k.trim().toLowerCase() === r.grade.trim().toLowerCase());
    const value = special ? special[1] : s.gradeUsed === "percentage" ? (r.percentage ?? null) : resolveGradeValue(r.grade, letterGrades);
    if (value === null) return { value: null, units, counted: false, reason: "no_number" };
    if (!s.includeFailed && r.failed) return { value, units, counted: false, reason: "failed" };
    return { value, units, counted: true, reason: special ? "special" : "" };
  });
  const counted = lines.filter(l => l.counted);
  if (counted.length === 0) return { gwa: null, lines, subjectsCounted: 0, unitsCounted: 0, formula: "" };
  const num = (n: number) => (Math.abs(n * 100 - Math.round(n * 100)) < 1e-9 ? n.toFixed(2) : String(n));      // 1.5 is shown as 1.50, 1.375 as it is
  if (s.method === "weighted") {
    const sumU = counted.reduce((a, l) => a + l.units, 0);
    const gwa = counted.reduce((a, l) => a + (l.value as number) * l.units, 0) / sumU;
    return { gwa, lines, subjectsCounted: counted.length, unitsCounted: sumU, formula: `(${counted.map(l => `${num(l.value as number)}×${l.units}`).join(" + ")}) ÷ ${sumU}` };
  }
  const gwa = counted.reduce((a, l) => a + (l.value as number), 0) / counted.length;
  return { gwa, lines, subjectsCounted: counted.length, unitsCounted: counted.reduce((a, l) => a + l.units, 0), formula: `(${counted.map(l => num(l.value as number)).join(" + ")}) ÷ ${counted.length}` };
}
