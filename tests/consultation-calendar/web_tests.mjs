// tests/consultation-calendar/web_tests.mjs — the all-staff (read-only) consultation calendar: the rules of the view (days, the numbers of a morning or afternoon, what is remembered, the note about ranges) and the screen (4 checks)
// Run:  node tests/consultation-calendar/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/calendarDayView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const V = await import(pathToFileURL(f).href);

// 1. days
check("1 Previous / Next move by whole days (across a month and a year), a week starts on Monday (a Sunday belongs to the week before), a typed day is checked",
  V.addDays("2026-11-30", 1) === "2026-12-01" && V.addDays("2026-01-01", -1) === "2025-12-31" && V.addDays("2026-11-20", 7) === "2026-11-27" && V.weekStart("2026-11-20") === "2026-11-16" && V.weekStart("2026-11-22") === "2026-11-16"
  && V.weekStart("2026-11-16") === "2026-11-16" && V.isDay("2026-11-20") && !V.isDay("2026-13-40") && !V.isDay("") && !V.isDay(null) && !V.isDay("20-11-2026"));

// 2. the numbers of a morning or afternoon
const idx = V.indexSummary([
  { day: "2026-11-20", half: "AM", total: 1300, booked: 434, attended: 433, noShow: 433, usedMinutes: 8000 },
  { day: "2026-11-20", half: "PM", total: 200, booked: 200, attended: 0, noShow: 0, usedMinutes: 4000 },
]);
check("2 the numbers of each morning and afternoon are found by day and half (a half with nothing booked is empty), and the note says when not every availability range is shown",
  idx.get(V.halfKey("2026-11-20", "AM")).total === 1300 && idx.get(V.halfKey("2026-11-20", "PM")).usedMinutes === 4000 && idx.get(V.halfKey("2026-11-21", "AM")) === undefined && V.EMPTY_HALF.total === 0
  && V.rangesNote(300, 400) === "Showing 300 of 400 availability ranges. Pick one staff member or a single day to see the rest." && V.rangesNote(12, 12) === null && V.rangesNote(0, 0) === null);

// 3. what is remembered
const ok = V.readRememberedCalendar(JSON.stringify({ view: "day", anchor: "2026-11-20", staff: "0b0f2f9e-1c3a-4e0e-9a43-111111111111" }));
check("3 the view, the day and the staff member are remembered; a broken or odd memory starts fresh (the week view, today, all staff)",
  ok.view === "day" && ok.anchor === "2026-11-20" && ok.staff === "0b0f2f9e-1c3a-4e0e-9a43-111111111111" && V.readRememberedCalendar("{bad") === null && V.readRememberedCalendar(null) === null
  && V.readRememberedCalendar(JSON.stringify({ view: "x", anchor: "nonsense", staff: "<script>" })).view === "week" && V.readRememberedCalendar(JSON.stringify({ view: "x", anchor: "nonsense", staff: "<script>" })).anchor === null
  && V.readRememberedCalendar(JSON.stringify({ view: "x", anchor: "nonsense", staff: "<script>" })).staff === "");

// 4. the screen
const tab = src("src/sead/appointments/AppointmentsTab.tsx"), modal = src("src/sead/appointments/BookingListModal.tsx");
check("4 the all-staff calendar reads only the numbers (summary) and a limited set of ranges, never every booking; it has a date picker, grey placeholders while loading and remembers the view; the booking list is read in pages of 50 when it is opened; a staff member's own calendar still reads their own bookings",
  tab.includes("fetchCalendarSummary(") && tab.includes("fetchCalendarRanges(") && !tab.includes("fetchCalendarSlots") && !tab.includes("fetchCalendarAvailability") && tab.includes("aria-label=\"Go to a day\"") && tab.includes("animate-pulse") && tab.includes("CALENDAR_REMEMBER_KEY")
  && tab.includes("<PagedBookingListModal") && tab.includes("fetchMySlots(from, to)") && tab.includes("fetchMyAvailability(from, to)") && modal.includes("fetchCalendarBookingsPage(") && modal.includes("<ServerPagination") && modal.includes("noun=\"bookings\""));
console.log(`\n${passed} passed`);
