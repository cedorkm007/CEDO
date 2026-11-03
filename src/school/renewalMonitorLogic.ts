// ─────────────────────────────────────────────────────────────
// src/school/renewalMonitorLogic.ts
// Pure rules for the School Portal's Renewal tab (no Supabase, no React): the groups, the words, the filters, the progress bar and the grade result.
// The groups are decided by the database (supabase_migration_school_renewal_tab.sql); this file only names things and filters the list the school already has.
// ─────────────────────────────────────────────────────────────

export type RenewalGroup = "in_process" | "renewed" | "removed" | "not_applied" | "not_required";
/** The buttons above the list: a group, "probation" (scholarship status Probationary, across the groups), or everybody. */
export type RenewalFilterKey = "all" | RenewalGroup | "probation";

export interface SchoolRenewalRow {
  scholarIdNumber: string;
  schoolStudentNo: string;
  lastName: string; firstName: string; middleName: string;
  yearLevel: string; program: string;
  scholarStatus: string;
  stage: string | null;
  isLate: boolean;
  group: RenewalGroup;
  probation: boolean;
  gradesState: string | null;
  failed: number; inc: number; review: number;
}

export interface SchoolRenewalSummary {
  total: number; applied: number; renewed: number; removed: number; notApplied: number; notRequired: number; probation: number; withIncOrFailed: number;
  basisSchoolYear: string; basisTerm: string;
}

export const GROUP_LABEL: Record<RenewalGroup, string> = {
  in_process: "Applied — being processed", renewed: "Renewed", removed: "Removed", not_applied: "Not applied yet", not_required: "Not required",
};
export const GROUP_HINT: Record<RenewalGroup, string> = {
  in_process: "The scholar applied and CEDO is still working on the renewal.",
  renewed: "The renewal is confirmed.",
  removed: "The scholar is removed from the scholarship.",
  not_applied: "The scholar has not applied for this renewal yet.",
  not_required: "No renewal is needed, or a late application was declined.",
};

/** The buttons, in order, with the words on them. "Not required" is only offered when there is somebody in it. */
export const FILTER_BUTTONS: { key: RenewalFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_process", label: "Applied" },
  { key: "renewed", label: "Renewed" },
  { key: "probation", label: "Probation" },
  { key: "removed", label: "Removed" },
  { key: "not_applied", label: "Not applied yet" },
  { key: "not_required", label: "Not required" },
];

export function countFor(summary: SchoolRenewalSummary, key: RenewalFilterKey): number {
  switch (key) {
    case "all": return summary.total;
    case "in_process": return summary.applied;
    case "renewed": return summary.renewed;
    case "removed": return summary.removed;
    case "not_applied": return summary.notApplied;
    case "not_required": return summary.notRequired;
    case "probation": return summary.probation;
  }
}

/** The progress bar: how many of the school's scholars are finished with the renewal (renewed, removed or not required), and the four parts of the bar. */
export interface RenewalProgress {
  processed: number; total: number; percent: number;
  segments: { key: "renewed" | "removed" | "applied" | "not_applied"; label: string; count: number; percent: number }[];
}
export function renewalProgress(s: SchoolRenewalSummary): RenewalProgress {
  const total = s.total;
  const processed = s.renewed + s.removed + s.notRequired;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return {
    processed, total, percent: total > 0 ? Math.round((processed / total) * 100) : 0,
    segments: [
      { key: "renewed", label: "Renewed", count: s.renewed + s.notRequired, percent: pct(s.renewed + s.notRequired) },
      { key: "removed", label: "Removed", count: s.removed, percent: pct(s.removed) },
      { key: "applied", label: "Applied, being processed", count: s.applied, percent: pct(s.applied) },
      { key: "not_applied", label: "Not applied yet", count: s.notApplied, percent: pct(s.notApplied) },
    ],
  };
}

export function fullName(r: Pick<SchoolRenewalRow, "lastName" | "firstName" | "middleName">): string {
  const mi = r.middleName.trim() ? `${r.middleName.trim()[0]}.` : "";
  return `${r.lastName}, ${[r.firstName, mi].filter(Boolean).join(" ")}`;
}

/** What the grades say, in words for the school: "All passed", "1 failed", "INC", "2 failed + 1 INC", "Grades not in yet". */
export function gradesText(r: Pick<SchoolRenewalRow, "gradesState" | "failed" | "inc" | "review">): string {
  const parts: string[] = [];
  if (r.failed > 0) parts.push(`${r.failed} failed`);
  if (r.inc > 0) parts.push(r.inc === 1 ? "INC" : `${r.inc} INC`);
  if (parts.length > 0) return parts.join(" + ");
  if (r.review > 0) return "Needs review";
  if (r.gradesState && r.gradesState !== "ready") return "Grades not in yet";
  if (!r.gradesState) return "Not checked yet";
  return "All passed";
}

/** A scholar who has an INC or a failed subject (a DRP counts as failed) and is not removed: the ones a clearance is needed for. */
export function needsClearance(r: Pick<SchoolRenewalRow, "failed" | "inc" | "group">): boolean {
  return (r.failed > 0 || r.inc > 0) && r.group !== "removed";
}

export interface RenewalFilters { filter: RenewalFilterKey; query: string; yearLevel: string; program: string }
export const EMPTY_FILTERS: RenewalFilters = { filter: "all", query: "", yearLevel: "", program: "" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Name (in any order), Scholar ID or School ID. */
export function matchesQuery(r: SchoolRenewalRow, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  if (norm(r.scholarIdNumber).includes(q) || norm(r.schoolStudentNo).includes(q)) return true;
  const hay = norm(`${r.firstName} ${r.middleName} ${r.lastName}`);
  return q.split(/[^a-z0-9ñ]+/).filter(Boolean).every(w => hay.includes(w));      // "santos, maria" and "maria santos" both work
}

export function filterRows(rows: SchoolRenewalRow[], f: RenewalFilters): SchoolRenewalRow[] {
  return rows.filter(r =>
    (f.filter === "all" || (f.filter === "probation" ? r.probation : r.group === f.filter))
    && (!f.yearLevel || r.yearLevel === f.yearLevel)
    && (!f.program || r.program === f.program)
    && matchesQuery(r, f.query));
}

const YEAR_ORDER = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
/** Year levels in order (1st, 2nd, 3rd …), anything else after them. */
export function yearLevelOptions(rows: SchoolRenewalRow[]): string[] {
  const rank = (y: string) => { const i = YEAR_ORDER.findIndex(p => y.toLowerCase().startsWith(p)); return i === -1 ? 99 : i; };
  return Array.from(new Set(rows.map(r => r.yearLevel).filter(Boolean))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
export function programOptions(rows: SchoolRenewalRow[]): string[] {
  return Array.from(new Set(rows.map(r => r.program).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export const PAGE_SIZE = 25;
export function pageOf<T>(list: T[], page: number, size = PAGE_SIZE): T[] { return list.slice((Math.max(1, page) - 1) * size, Math.max(1, page) * size); }
export function pageCount(total: number, size = PAGE_SIZE): number { return Math.max(1, Math.ceil(total / size)); }
