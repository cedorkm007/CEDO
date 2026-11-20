// ─────────────────────────────────────────────────────────────
// src/lib/dashboardLinks.ts
// Consultation Tool > Main Dashboard: pressing a number takes you to the tab that lists what the number counts, with the filters of that tab already set, so the total you land on is the number you pressed
// (Probationary → Probationary Monitoring; KSB Client / Home Visited → Daily Records with that Visit type; Clients Served → Daily Records from the 1st of the month to today, every consultant).
// A tab remembers its page, filters and search (src/lib/dailyRecordsView.ts, src/lib/probationView.ts); the link only writes that memory and the tab reads it when it opens.
// No React / Supabase, so tests can run it alone.
// ─────────────────────────────────────────────────────────────
import { EMPTY_DAILY_FILTERS, REMEMBER_KEY, quickRange, type DailyRecordFiltersLike } from "./dailyRecordsView";
import { EMPTY_PROBATION_FILTERS, PROBATION_REMEMBER_KEY } from "./probationView";

export type DashboardKind = "probationary" | "ksb" | "home" | "served";
export interface DashboardTarget { tab: "daily-records" | "probation-monitoring"; storageKey: string; value: string }

/** Where a dashboard number leads. `today` is the Philippine day (YYYY-MM-DD). The signature keeps a third argument that is no longer needed (Clients Served counts every consultant). */
export function dashboardTarget(kind: DashboardKind, today: string, _me?: string | null): DashboardTarget | null {
  if (kind === "probationary") {
    return { tab: "probation-monitoring", storageKey: PROBATION_REMEMBER_KEY, value: JSON.stringify({ filters: EMPTY_PROBATION_FILTERS, sortKey: "name", sortDir: "asc", page: 1 }) };
  }
  let filters: DailyRecordFiltersLike = { ...EMPTY_DAILY_FILTERS };
  if (kind === "ksb") filters = { ...filters, visitTypes: ["KSB Client"] };
  else if (kind === "home") filters = { ...filters, visitTypes: ["Home Visit"] };
  else {
    const month = quickRange("month", today, null)!;      // the 1st of the month to today, all consultants
    filters = { ...filters, from: month.from, to: month.to };
  }
  return { tab: "daily-records", storageKey: REMEMBER_KEY, value: JSON.stringify({ filters, sortKey: "date", sortDir: "desc", page: 1 }) };
}
