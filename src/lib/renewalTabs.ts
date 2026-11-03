// ─────────────────────────────────────────────────────────────
// src/lib/renewalTabs.ts
// Scholar Renewal: the three lists (Applications, Renewed, Not applied) and their sub-tabs. Plain helpers (no Supabase / React) so tests can run them alone.
// The database (supabase_migration_renewal_tabs.sql) decides which sub-tab a scholar is in; this file only names things and words the status column.
// ─────────────────────────────────────────────────────────────

export type RenewalListTab = "applications" | "renewed" | "not_applied";
export type GradeSubTab = "complete" | "failed1" | "inc" | "failed2" | "pending";
export type RenewedSubTab = "regular" | "probationary" | "reconsidered";
export type RenewalSubTab = GradeSubTab | RenewedSubTab;

export interface SubTabInfo { key: RenewalSubTab; label: string; hint: string }

/** The sub-tabs of Applications and Not applied, in the order shown. "pending" is the one the grades-based list needs so that nobody is left out. */
export const GRADE_SUBTABS: SubTabInfo[] = [
  { key: "complete", label: "Complete", hint: "All subjects passed." },
  { key: "failed1", label: "1 failed", hint: "One failed subject (a DRP counts as failed), also when there is an INC as well." },
  { key: "inc", label: "INC", hint: "An open INC and no failed subject." },
  { key: "failed2", label: "2 failed", hint: "Two or more failed subjects (a DRP counts as failed)." },
  { key: "pending", label: "Grades not in", hint: "The grades are not all in yet, none are recorded, or a mark needs review." },
];
export const RENEWED_SUBTABS: SubTabInfo[] = [
  { key: "regular", label: "Regular", hint: "Renewed as a Regular scholar." },
  { key: "probationary", label: "Probationary", hint: "Renewed on Probationary status." },
  { key: "reconsidered", label: "Reconsidered", hint: "Renewed after the Division Head reconsidered the case." },
];
export const SUBTABS: Record<RenewalListTab, SubTabInfo[]> = { applications: GRADE_SUBTABS, renewed: RENEWED_SUBTABS, not_applied: GRADE_SUBTABS };
export const LIST_TAB_LABEL: Record<RenewalListTab, string> = { applications: "Applications", renewed: "Renewed", not_applied: "Not applied" };

export const FIRST_SUBTAB: Record<RenewalListTab, RenewalSubTab> = { applications: "complete", renewed: "regular", not_applied: "complete" };

/** The two filters that are not a list of values. */
export const SDP_FILTER_OPTIONS = [{ value: "complied", label: "SDP complied" }, { value: "not_complied", label: "SDP not complied" }];
export const GRADES_FILTER_OPTIONS = [{ value: "in", label: "Grades all in" }, { value: "not_in", label: "Grades not all in" }];

/** The Scholarship status column. Renewed shows where the scholar came from and where the scholar is now ("Regular to Probationary"); the other lists show the status now. */
export function statusColumnText(tab: RenewalListTab, status: string, from?: string | null, to?: string | null): string {
  if (tab !== "renewed") return status || "—";
  const a = (from ?? "").trim(), b = (to ?? status ?? "").trim();
  if (!b) return "—";
  return !a || a === b ? b : `${a} → ${b}`;
}

/** Whether a sub-tab is one of the known ones for the list (so a stale choice after switching list falls back to the first). */
export function validSubTab(tab: RenewalListTab, sub: string): sub is RenewalSubTab {
  return SUBTABS[tab].some(s => s.key === sub);
}
