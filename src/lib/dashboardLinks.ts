// ─────────────────────────────────────────────────────────────
// src/lib/dashboardLinks.ts
// Consultation Tool > Main Dashboard: pressing a number takes you to the tab that lists what the number counts, with the filters of that tab already set, so the total you land on is the number you pressed
// (Probationary → Probationary Monitoring; KSB Client / Home Visited → Daily Records with that Visit type; Clients Served → Daily Records with you as the consultant, from the 1st of the month to today).
// A tab remembers its page, filters and search (src/lib/dailyRecordsView.ts, src/lib/probationView.ts); the link only writes that memory and the tab reads it when it opens.
// No React / Supabase, so tests can run it alone.
// ─────────────────────────────────────────────────────────────
import { EMPTY_DAILY_FILTERS, REMEMBER_KEY, quickRange, type DailyRecordFiltersLike } from "./dailyRecordsView";
import { EMPTY_PROBATION_FILTERS, PROBATION_REMEMBER_KEY } from "./probationView";

export type DashboardKind = "probationary" | "ksb" | "home" | "served";
export interface DashboardTarget { tab: "daily-records" | "probation-monitoring"; storageKey: string; value: string }

/** Where a dashboard number leads. `today` is the Philippine day (YYYY-MM-DD); `me` is the signed-in staff member (needed for "served"). Null when the number cannot be linked (no known staff member). */
export function dashboardTarget(kind: DashboardKind, today: string, me: string | null): DashboardTarget | null {
  if (kind === "probationary") {
    return { tab: "probation-monitoring", storageKey: PROBATION_REMEMBER_KEY, value: JSON.stringify({ filters: EMPTY_PROBATION_FILTERS, sortKey: "name", sortDir: "asc", page: 1 }) };
  }
  let filters: DailyRecordFiltersLike = { ...EMPTY_DAILY_FILTERS };
  if (kind === "ksb") filters = { ...filters, visitTypes: ["KSB Client"] };
  else if (kind === "home") filters = { ...filters, visitTypes: ["Home Visit"] };
  else {
    if (!me) return null;
    const month = quickRange("month", today, null)!;
    filters = { ...filters, from: month.from, to: month.to, consultantIds: [me] };
  }
  return { tab: "daily-records", storageKey: REMEMBER_KEY, value: JSON.stringify({ filters, sortKey: "date", sortDir: "desc", page: 1 }) };
}
