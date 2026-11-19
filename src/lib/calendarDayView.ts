// ─────────────────────────────────────────────────────────────
// src/lib/calendarDayView.ts
// The consultation calendar (Appointments): the plain rules of the view: calendar arithmetic on days, the numbers of a morning or afternoon taken from the database's summary,
// what is remembered, and how many availability ranges are shown. No React / Supabase, so tests can run it alone.
// ─────────────────────────────────────────────────────────────

export type CalendarView = "week" | "day";
export type Half = "AM" | "PM";

/** Adds days to a YYYY-MM-DD date (calendar arithmetic only, so no time-zone surprises). */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The Monday of the week containing a date. */
export function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();      // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}
export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** The numbers of one morning or afternoon, as the database counted them. */
export interface HalfCount { total: number; booked: number; attended: number; noShow: number; usedMinutes: number }
export interface SummaryRow extends HalfCount { day: string; half: Half }
export const EMPTY_HALF: HalfCount = { total: 0, booked: 0, attended: 0, noShow: 0, usedMinutes: 0 };
export const halfKey = (day: string, half: Half): string => `${day}|${half}`;
export function indexSummary(rows: SummaryRow[]): Map<string, HalfCount> {
  const m = new Map<string, HalfCount>();
  for (const r of rows) m.set(halfKey(r.day, r.half), { total: r.total, booked: r.booked, attended: r.attended, noShow: r.noShow, usedMinutes: r.usedMinutes });
  return m;
}

/** What the screen says when the database did not send every availability range: "Showing 300 of 412 availability ranges…"; null when all of them are shown. */
export function rangesNote(shown: number, total: number): string | null {
  return total > shown ? `Showing ${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} availability ranges. Pick one staff member or a single day to see the rest.` : null;
}

// ── remembered (for the all-staff calendar): the view, the day and the staff member ──
export interface RememberedCalendar { view: CalendarView; anchor: string | null; staff: string }
export const CALENDAR_REMEMBER_KEY = "cedo.renewal.calendar.view";
export function readRememberedCalendar(raw: string | null): RememberedCalendar | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedCalendar>;
    if (!v || typeof v !== "object") return null;
    return { view: v.view === "day" ? "day" : "week", anchor: isDay(v.anchor) ? v.anchor : null, staff: typeof v.staff === "string" && /^[0-9a-f-]{36}$/i.test(v.staff) ? v.staff : "" };
  } catch { return null; }
}
