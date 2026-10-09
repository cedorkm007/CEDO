// ─────────────────────────────────────────────────────────────
// src/lib/academicPeriods.ts
// Pure helpers for academic periods (school year + term, with a status and an
// optional deadline) — see supabase_migration_academic_periods.sql. Shared by the
// School Portal, the staff Scholars' Grades Monitoring tool and the scholar's
// Subjects and Grades panel. No Supabase/React imports so tests can run it alone.
// ─────────────────────────────────────────────────────────────

export const TERMS = ["1st Semester", "2nd Semester", "Summer"] as const;
export type Term = (typeof TERMS)[number];

export type PeriodStatus = "open" | "closed" | "archived";

export interface AcademicPeriod {
  id: string;
  schoolYear: string;
  term: Term;
  status: PeriodStatus;
  /** ISO date (YYYY-MM-DD) or null when no deadline is set. */
  deadline: string | null;
}

/** The shape the rest of the app already uses for "a school year + semester". */
export interface PeriodRef {
  schoolYear: string;
  semester: string;
}

/** Shown to people; stored value stays "Summer". */
export function termLabel(term: string): string {
  return term === "Summer" ? "Summer / Midyear" : term;
}

export function statusLabel(status: PeriodStatus): string {
  return status === "open" ? "Open" : status === "closed" ? "Closed" : "Archived";
}

/** Mirrors normalize_academic_term() in the migration: tolerant of how people have typed a term. */
export function normalizeTerm(raw: string | null | undefined): Term | null {
  if (raw == null) return null;
  const t = raw.trim().toLowerCase();
  if (/^(1st|first|1)[ ._-]*(sem(ester)?)?$/.test(t) || /^sem(ester)?[ ._-]*(1|i)$/.test(t)) return "1st Semester";
  if (/^(2nd|second|2)[ ._-]*(sem(ester)?)?$/.test(t) || /^sem(ester)?[ ._-]*(2|ii)$/.test(t)) return "2nd Semester";
  if (/^(summer|mid[ ._-]?year|summer[ /._-]*mid[ ._-]?year|mid[ ._-]?year[ /._-]*summer)$/.test(t)) return "Summer";
  return null;
}

/** "2026-2027": four digits, a dash, and the next year. */
export function isValidSchoolYear(value: string): boolean {
  const m = /^(\d{4})-(\d{4})$/.exec(value.trim());
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}

function termRank(term: string): number {
  const i = (TERMS as readonly string[]).indexOf(normalizeTerm(term) ?? term);
  return i === -1 ? TERMS.length : i;
}

/** Newest first: later school year first, and within a year Summer, 2nd, 1st. */
export function sortPeriods<T extends { schoolYear: string; term?: string; semester?: string }>(periods: T[]): T[] {
  return [...periods].sort((a, b) => {
    if (a.schoolYear !== b.schoolYear) return a.schoolYear < b.schoolYear ? 1 : -1;
    return termRank(b.term ?? b.semester ?? "") - termRank(a.term ?? a.semester ?? "");
  });
}

/** Stable identity for a period no matter how its semester text was spelled. */
export function periodKey(schoolYear: string, semester: string): string {
  return `${schoolYear.trim()}|${normalizeTerm(semester) ?? semester.trim()}`;
}

export const ALL_PERIODS_KEY = "all";

export function findPeriod(periods: AcademicPeriod[], ref: PeriodRef): AcademicPeriod | null {
  const key = periodKey(ref.schoolYear, ref.semester);
  return periods.find(p => periodKey(p.schoolYear, p.term) === key) ?? null;
}

export function periodRefOf(p: Pick<AcademicPeriod, "schoolYear" | "term">): PeriodRef {
  return { schoolYear: p.schoolYear, semester: p.term };
}

/** A school may only enter or change grades in an Open period. */
export function canSchoolEdit(status: PeriodStatus | null | undefined): boolean {
  return status === "open";
}

export function periodTitle(ref: PeriodRef): string {
  const term = normalizeTerm(ref.semester);
  return [ref.schoolYear, term ? termLabel(term) : ref.semester].filter(Boolean).join(" · ");
}

export interface PeriodOption {
  key: string;
  label: string;
}

/** Options for a period dropdown: newest first, the current one marked, optionally "All periods" at the end. */
export function periodOptions(periods: AcademicPeriod[], current: PeriodRef | null, opts: { includeAll?: boolean; withStatus?: boolean } = {}): PeriodOption[] {
  const currentKey = current && current.schoolYear ? periodKey(current.schoolYear, current.semester) : null;
  const list: PeriodOption[] = sortPeriods(periods).map(p => {
    const key = periodKey(p.schoolYear, p.term);
    const bits = [`${p.schoolYear} · ${termLabel(p.term)}`];
    if (opts.withStatus) bits.push(`(${statusLabel(p.status)}${key === currentKey ? ", current" : ""})`);
    else if (key === currentKey) bits.push("(current)");
    return { key, label: bits.join(" ") };
  });
  if (opts.includeAll) list.push({ key: ALL_PERIODS_KEY, label: "All periods" });
  return list;
}

/** Whole days from `today` to a YYYY-MM-DD deadline (negative once passed). */
export function daysUntil(deadline: string, today: Date): number {
  const [y, m, d] = deadline.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / 86_400_000);
}

/** "Deadline: Nov 15, 2026 (12 days left)" — or "(passed)". Null when there is no deadline. */
export function deadlineSummary(deadline: string | null, today: Date): string | null {
  if (!deadline) return null;
  const [y, m, d] = deadline.split("-").map(Number);
  const text = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const days = daysUntil(deadline, today);
  const tail = days > 1 ? `${days} days left` : days === 1 ? "1 day left" : days === 0 ? "due today" : "passed";
  return `Deadline: ${text} (${tail})`;
}
