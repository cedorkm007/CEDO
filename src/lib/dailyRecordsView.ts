// ─────────────────────────────────────────────────────────────
// src/lib/dailyRecordsView.ts
// Consultation Tool > Daily Records: the plain rules of the list: what a range quick pick means, how a page is worded ("Showing 1–50 of 3,482 records"), which page numbers are shown,
// how the choices are remembered, and what the Export file contains. No React / Supabase, so tests can run it alone. The records themselves are chosen, sorted and counted by the database.
// ─────────────────────────────────────────────────────────────

export interface DailyRecordFiltersLike { search: string; from: string; to: string; visitTypes: string[]; statuses: string[]; consultantIds: string[] }
export const EMPTY_DAILY_FILTERS: DailyRecordFiltersLike = { search: "", from: "", to: "", visitTypes: [], statuses: [], consultantIds: [] };
export const filtersActive = (f: DailyRecordFiltersLike): boolean => f.search.trim() !== "" || !!f.from || !!f.to || f.visitTypes.length > 0 || f.statuses.length > 0 || f.consultantIds.length > 0;

export type QuickRange = "today" | "week" | "month" | "semester";
export const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" }, { key: "semester", label: "This semester" },
];
const addDays = (day: string, n: number): string => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/**
 * The dates of a quick pick, as YYYY-MM-DD ("today" = the Philippine day). This week = Monday to today; This month = the 1st to today;
 * This semester = from the day the current school year and semester were set (`semesterStart`) to today (null when that day is not known: the pick is then not offered).
 */
export function quickRange(key: QuickRange, today: string, semesterStart: string | null): { from: string; to: string } | null {
  if (key === "today") return { from: today, to: today };
  if (key === "week") { const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); return { from: addDays(today, dow === 0 ? -6 : 1 - dow), to: today }; }
  if (key === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return semesterStart ? { from: semesterStart > today ? today : semesterStart, to: today } : null;
}

/** "Showing 1–50 of 3,482 records"; with nothing, "No records". */
export function showingText(page: number, pageSize: number, total: number, noun = "records"): string {
  if (total <= 0) return `No ${noun}`;
  const start = (page - 1) * pageSize + 1, end = Math.min(page * pageSize, total);
  return `Showing ${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${total === 1 ? noun.replace(/s$/, "") : noun}`;
}
export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

/** The page numbers to show: always the first, the last and the ones around the current page, with "…" for the gaps: 1 … 4 5 6 … 70. */
export function pageNumbers(page: number, pages: number, around = 1): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set<number>([1, 2, pages - 1, pages]);
  for (let p = page - around; p <= page + around; p++) if (p >= 1 && p <= pages) keep.add(p);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(p - sorted[i - 1] === 2 ? p - 1 : "…"); out.push(p); });
  return out;
}

// ── remembered while the person looks at a record and comes back (also after another tool or a reload) ──
export interface RememberedView { filters: DailyRecordFiltersLike; sortKey: "date" | "name"; sortDir: "asc" | "desc"; page: number }
export const REMEMBER_KEY = "cedo.consultation.dailyRecords.view";
export function readRemembered(raw: string | null): RememberedView | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedView>;
    const f = v.filters as Partial<DailyRecordFiltersLike> | undefined;
    if (!f || typeof f !== "object") return null;
    const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
    const day = (x: unknown): string => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : "");
    return {
      filters: { search: typeof f.search === "string" ? f.search.slice(0, 100) : "", from: day(f.from), to: day(f.to), visitTypes: arr(f.visitTypes), statuses: arr(f.statuses), consultantIds: arr(f.consultantIds) },
      sortKey: v.sortKey === "name" ? "name" : "date", sortDir: v.sortDir === "asc" ? "asc" : "desc", page: Number.isFinite(v.page) && (v.page as number) >= 1 ? Math.floor(v.page as number) : 1,
    };
  } catch { return null; }
}

// ── the Export ──
export const EXPORT_HEADERS = ["Scholar ID Number", "Name", "Course", "Year Level", "School", "Date Visited", "Visit Type", "Status", "Consulted By", "Failed Subject(s)", "Findings", "Staff Recommendations", "Logged On"] as const;
export interface ExportableRecord { scholarIdNumber: string; name: string; course: string; yearLevel: string; school: string; dateVisited: string; visitType: string; status: string; consultedByName: string; failedSubjects: string; findings: string; staffRecommendations: string; createdAt: string }
/** One row of the export: every column, dates as YYYY-MM-DD (the day logged in Philippine time). */
export function exportRow(r: ExportableRecord): string[] {
  const logged = r.createdAt ? new Date(r.createdAt) : null;
  const loggedDay = logged && !Number.isNaN(logged.getTime()) ? new Date(logged.getTime() + 8 * 3600e3).toISOString().slice(0, 10) : "";      // Philippine time is UTC+8, all year
  return [r.scholarIdNumber, r.name, r.course, r.yearLevel, r.school, r.dateVisited, r.visitType, r.status, r.consultedByName, r.failedSubjects, r.findings, r.staffRecommendations, loggedDay];
}
/** "Daily-Records_2026-09-01_to_2026-09-30_filtered_2026-11-19.xlsx" */
export function exportFileName(f: DailyRecordFiltersLike, today: string): string {
  const range = f.from || f.to ? `_${f.from || "start"}_to_${f.to || "today"}` : "";
  return `Daily-Records${range}${filtersActive(f) ? "_filtered" : ""}_${today}.xlsx`;
}
