// ─────────────────────────────────────────────────────────────
// src/school/portalLogic.ts
// Pure rules behind the School Portal's redesigned Scholars tab (no Supabase, no React), kept
// separate so tests/school-grades/run.mjs can exercise them directly:
// per-scholar status, the summary row / progress bar, year-level ordering, group progress for the
// cards, search + filters for the table view, breadcrumbs, the period-bar status, the "allowed
// grades" hint, and the change-password rules.
// ─────────────────────────────────────────────────────────────
import type { ScholarGradeSummary } from "./gradeSaveLogic";
import type { GradingConfig, LetterGrade, SchoolScholarRow } from "./types";

// ── Status of one scholar in the selected period ─────────────
/** "submitted" appears once a school has submitted the period (Phase 6); until then nothing produces it. */
export type ScholarStatus = "not_set_up" | "not_graded" | "complete" | "submitted";

export const STATUS_LABEL: Record<ScholarStatus, string> = {
  not_set_up: "Not set up",
  not_graded: "Not graded",
  complete: "Complete",
  submitted: "Submitted",
};

/**
 * Same strict rule the database uses for "complete" (see the monitoring migration): at least one declared
 * subject AND every declared subject has a grade.  No subjects = not set up; some subject without a grade = not graded.
 */
export function scholarStatus(summary: Pick<ScholarGradeSummary, "subjects" | "graded">, submitted = false): ScholarStatus {
  if (summary.subjects === 0) return "not_set_up";
  if (summary.graded < summary.subjects) return "not_graded";
  return submitted ? "submitted" : "complete";
}

export interface ScholarRowData {
  scholar: SchoolScholarRow;
  summary: ScholarGradeSummary;
  status: ScholarStatus;
}

export const NO_YEAR_LABEL = "(Not set)";
export const yearLevelOf = (s: Pick<SchoolScholarRow, "yearLevel">): string => s.yearLevel.trim() || NO_YEAR_LABEL;
export const programOf = (s: Pick<SchoolScholarRow, "course">): string => s.course.trim() || NO_YEAR_LABEL;

export function scholarName(s: Pick<SchoolScholarRow, "lastName" | "firstName" | "middleName">): string {
  const mi = s.middleName.trim() ? `${s.middleName.trim()[0]}.` : "";
  return [`${s.lastName},`, s.firstName, mi].filter(Boolean).join(" ");
}

// ── Summary row + progress ───────────────────────────────────
export interface PortalCounts {
  total: number;
  /** Complete (or Submitted). */
  complete: number;
  /** Declared, not graded: has subjects but at least one has no grade. */
  declaredNotGraded: number;
  notSetUp: number;
  submitted: number;
  /** Whole-number percent of scholars that are complete, 0 when there are no scholars. */
  percent: number;
  /** Subjects with a grade entered, across all scholars (used to tell "Not started" from "In progress"). */
  gradedSubjects: number;
}

export function portalCounts(rows: ScholarRowData[]): PortalCounts {
  const c: PortalCounts = { total: rows.length, complete: 0, declaredNotGraded: 0, notSetUp: 0, submitted: 0, percent: 0, gradedSubjects: 0 };
  for (const r of rows) {
    c.gradedSubjects += r.summary.graded;
    if (r.status === "not_set_up") c.notSetUp++;
    else if (r.status === "not_graded") c.declaredNotGraded++;
    else { c.complete++; if (r.status === "submitted") c.submitted++; }
  }
  c.percent = c.total === 0 ? 0 : Math.floor((100 * c.complete) / c.total);
  return c;
}

/** The period bar's status: where the school is in this period. (Phase 6 adds "Submitted" once a school submits.) */
export function periodProgressLabel(c: PortalCounts): "Not started" | "In progress" | "Ready to submit" | "Submitted" {
  if (c.total > 0 && c.submitted === c.total) return "Submitted";
  if (c.total > 0 && c.complete === c.total) return "Ready to submit";
  if (c.gradedSubjects === 0) return "Not started";
  return "In progress";
}

/** The Submit button is only enabled once every scholar is complete (and there is at least one). */
export function canSubmit(c: PortalCounts): boolean {
  return c.total > 0 && c.complete === c.total && c.submitted < c.total;
}

// ── Ordering + group progress (year-level / program cards) ───
/** 1st Year, 2nd Year, 3rd Year ... in order; anything without a number after them alphabetically; "(Not set)" last. */
export function sortYearLevels(levels: string[]): string[] {
  const rank = (s: string): [number, string] => {
    if (s === NO_YEAR_LABEL) return [Number.MAX_SAFE_INTEGER, s];
    const m = /\d+/.exec(s);
    return m ? [Number(m[0]), s] : [Number.MAX_SAFE_INTEGER - 1, s];
  };
  return [...levels].sort((a, b) => {
    const [na, sa] = rank(a);
    const [nb, sb] = rank(b);
    return na !== nb ? na - nb : sa.localeCompare(sb);
  });
}

export interface GroupProgress {
  key: string;
  total: number;
  complete: number;
  percent: number;
}

/** Counts and completion for each group (e.g. each year level), in the order given by `order` (or alphabetical). */
export function groupProgress(rows: ScholarRowData[], keyOf: (s: SchoolScholarRow) => string, order?: (keys: string[]) => string[]): GroupProgress[] {
  const map = new Map<string, GroupProgress>();
  for (const r of rows) {
    const key = keyOf(r.scholar);
    const g = map.get(key) ?? { key, total: 0, complete: 0, percent: 0 };
    g.total++;
    if (r.status === "complete" || r.status === "submitted") g.complete++;
    map.set(key, g);
  }
  for (const g of map.values()) g.percent = g.total === 0 ? 0 : Math.floor((100 * g.complete) / g.total);
  const keys = (order ?? ((k: string[]) => [...k].sort((a, b) => a.localeCompare(b))))(Array.from(map.keys()));
  return keys.map(k => map.get(k)!);
}

// ── Search + filters (toolbar and Table view) ────────────────
export interface RowFilter {
  search?: string;
  yearLevel?: string;
  program?: string;
  status?: ScholarStatus | "";
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9ñ-]+/).filter(Boolean);

/** Name or ID, in any word order: "maria santos", "santos maria" and "2409-0001" all find the right scholar. */
export function matchesSearch(s: SchoolScholarRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (s.scholarIdNumber.toLowerCase().includes(q)) return true;
  const hay = `${s.firstName} ${s.middleName} ${s.lastName}`.toLowerCase();
  return words(q).every(w => hay.includes(w));
}

export function filterRows(rows: ScholarRowData[], f: RowFilter): ScholarRowData[] {
  return rows.filter(r =>
    matchesSearch(r.scholar, f.search ?? "")
    && (!f.yearLevel || yearLevelOf(r.scholar) === f.yearLevel)
    && (!f.program || programOf(r.scholar) === f.program)
    && (!f.status || r.status === f.status));
}

// ── Breadcrumbs: Scholars > 5th Year > BS Education ──────────
export type Drill = { level: "yearLevels" } | { level: "programs"; yearLevel: string } | { level: "scholars"; yearLevel: string; program: string };

export interface Crumb {
  label: string;
  /** Where clicking it goes; null for the page you are on. */
  to: Drill | null;
}

export function breadcrumbs(drill: Drill): Crumb[] {
  if (drill.level === "yearLevels") return [{ label: "Scholars", to: null }];
  if (drill.level === "programs") return [{ label: "Scholars", to: { level: "yearLevels" } }, { label: drill.yearLevel, to: null }];
  return [
    { label: "Scholars", to: { level: "yearLevels" } },
    { label: drill.yearLevel, to: { level: "programs", yearLevel: drill.yearLevel } },
    { label: drill.program, to: null },
  ];
}

// ── Grade entry hint ─────────────────────────────────────────
/** "Allowed: 1 to 5, or INC, DRP" — shown beside the grade box so a school knows what the database will accept. */
export function gradeInputHint(config: GradingConfig | null, letters: LetterGrade[]): string {
  if (!config) return "Set up your grading scale first.";
  const range = `${config.scaleMin} to ${config.scaleMax}`;
  const letterList = config.usesLetterGrades ? letters.map(l => l.letter.trim()).filter(Boolean) : [];
  return letterList.length > 0 ? `Allowed: ${range}, or ${letterList.join(", ")}` : `Allowed: ${range}`;
}

// ── Change password ──────────────────────────────────────────
export const MIN_PASSWORD_LENGTH = 8;

/** The first problem with a change-password form, or null when it can be submitted. */
export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (!current) return "Enter your current password.";
  if (next.length < MIN_PASSWORD_LENGTH) return `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (next === current) return "The new password must be different from the current one.";
  if (next !== confirm) return "The new password and its confirmation do not match.";
  return null;
}
