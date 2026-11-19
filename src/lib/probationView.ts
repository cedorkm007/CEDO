// ─────────────────────────────────────────────────────────────
// src/lib/probationView.ts
// Consultation Tool > Probationary Monitoring: the plain rules of the list: which filters exist, how they are remembered, and how a row's renewal summary reads.
// No React / Supabase, so tests can run it alone. The scholars themselves are chosen, filtered, sorted and counted by the database.
// ─────────────────────────────────────────────────────────────

export type ProbationAttention = "soon" | "passed" | "no_study_plan";
export type ProbationKind = "" | "temporary" | "regular";
export interface ProbationFilters { search: string; attention: ProbationAttention[]; kind: ProbationKind }
export const EMPTY_PROBATION_FILTERS: ProbationFilters = { search: "", attention: [], kind: "" };
export const probationFiltersActive = (f: ProbationFilters): boolean => f.search.trim() !== "" || f.attention.length > 0 || f.kind !== "";

/** "Soon" = the deadline is today or in the next this-many days (the database uses the same number). */
export const INC_SOON_DAYS = 7;
export const PROBATION_PAGE_SIZE = 50;
export const ATTENTION_OPTIONS: { value: ProbationAttention; label: string }[] = [
  { value: "soon", label: `INC deadline soon (within ${INC_SOON_DAYS} days)` },
  { value: "passed", label: "INC deadline passed" },
  { value: "no_study_plan", label: "Study plan missing" },
];
export const KIND_OPTIONS: { value: ProbationKind; label: string }[] = [
  { value: "", label: "All" }, { value: "temporary", label: "Temporary (INC)" }, { value: "regular", label: "Regular probation" },
];

// ── remembered while the person opens a scholar and comes back (also after another tool or a reload) ──
export interface RememberedProbationView { filters: ProbationFilters; sortKey: "name" | "deadline"; sortDir: "asc" | "desc"; page: number }
export const PROBATION_REMEMBER_KEY = "cedo.consultation.probation.view";
export function readRememberedProbation(raw: string | null): RememberedProbationView | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedProbationView>;
    const f = v.filters as Partial<ProbationFilters> | undefined;
    if (!f || typeof f !== "object") return null;
    const attention = (Array.isArray(f.attention) ? f.attention : []).filter((x): x is ProbationAttention => x === "soon" || x === "passed" || x === "no_study_plan");
    return {
      filters: { search: typeof f.search === "string" ? f.search.slice(0, 100) : "", attention, kind: f.kind === "temporary" || f.kind === "regular" ? f.kind : "" },
      sortKey: v.sortKey === "deadline" ? "deadline" : "name", sortDir: v.sortDir === "desc" ? "desc" : "asc",
      page: Number.isFinite(v.page) && (v.page as number) >= 1 ? Math.floor(v.page as number) : 1,
    };
  } catch { return null; }
}

/** The one-line INC summary of a row: "No open INC", "2 INC open - next deadline Nov 25, 2026 (6 days left)", "1 INC open - deadline passed 3 days ago". */
export function incSummary(openCount: number, nextDeadline: string | null, today: string): { text: string; tone: "none" | "ok" | "soon" | "passed" | "unset" } {
  if (openCount <= 0) return { text: "No open INC", tone: "none" };
  const label = `${openCount} INC open`;
  if (!nextDeadline) return { text: `${label} - deadline to be set at consultation`, tone: "unset" };
  const days = Math.round((Date.parse(`${nextDeadline.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return { text: `${label} - deadline passed ${-days} day${days === -1 ? "" : "s"} ago`, tone: "passed" };
  if (days === 0) return { text: `${label} - due today`, tone: "soon" };
  return { text: `${label} - next deadline in ${days} day${days === 1 ? "" : "s"}`, tone: days <= INC_SOON_DAYS ? "soon" : "ok" };
}
