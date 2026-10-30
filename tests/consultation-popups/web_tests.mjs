// tests/consultation-popups/web_tests.mjs — the staff calendar's "Booking list" pop-up, and the termination forms list pop-up
// Run:  node tests/consultation-popups/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cpop-"));
const outfile = path.join(tmp, "sort.mjs");
await build({ entryPoints: [path.join(root, "src/lib/removalFormSort.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const S = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The calendar's Booking list");
const tab = src("src/sead/appointments/AppointmentsTab.tsx"), modal = src("src/sead/appointments/BookingListModal.tsx");
test("inside each available morning or afternoon the individual names are gone: there is one 'Booking list' button with the number of bookings", () => {
  assert.ok(tab.includes("Booking list ({bookings.length})") && tab.includes("setListFor({ day, half })"));
  assert.equal(tab.includes("<span className=\"font-bold\">{s.scholarName}</span>"), false, "no individual scholar button on the calendar any more");
  assert.equal(/bookings\.map\(s => \(/.test(tab), false);
});
test("with no bookings the schedule says so instead of showing a button", () => assert.ok(tab.includes('bookings.length === 0 ? <p className="text-[14px] text-slate-700 px-1">No bookings yet.</p>')));
test("the pop-up lists the scholars who booked THAT morning or afternoon of that day, with the type of booking and the status", () => {
  assert.ok(tab.includes("slots.filter(s => s.state !== \"open\" && manilaDay(s.startsAt) === listFor.day && consultHalf(s.startsAt) === listFor.half)"));
  assert.ok(tab.includes("Booking list · ${dayLabel(listFor.day)} ·"));
  assert.ok(modal.includes("{s.scholarName ?? \"—\"}") && modal.includes("{s.typeLabel ?? \"Consultation\"} · {s.minutes ?? 10} min") && modal.includes("STATUS_LABEL[s.state]"));
  for (const label of ["Booked", "Attended", "No-show"]) assert.ok(modal.includes(`: "${label}"`), label);
});
test("the pop-up says how many are booked, attended and no-show", () => assert.ok(modal.includes("{count(\"booked\")} booked · {count(\"attended\")} attended · {count(\"no_show\")} no-show")));
test("the consultation staff can still mark an appointment Attended or No-show: pressing a scholar in the list opens the appointment, above the list; the evaluator's list opens the scholar's renewal", () => {
  assert.ok(tab.includes("openable={s => (readOnly ? !!s.recordId : true)}") && tab.includes("else setSelected(s)") && tab.includes("onOpenRecord?.(s.recordId)"));
  assert.ok(tab.indexOf("<BookingListModal") < tab.indexOf("<SlotDetailModal"), "the appointment pop-up is drawn after, so above, the list");
  assert.ok(/Referral/.test(modal), "a referral booking is marked");
});
test("the list follows the calendar: after a change it shows the new status (it reads the live bookings, not a copy)", () => assert.ok(tab.includes("slots={slots.filter(") && !tab.includes("setListSlots")));

console.log("The termination forms list");
const dash = src("src/sead/pages/ScholarCounselingDashboardTab.tsx"), forms = src("src/sead/components/TerminationFormsModal.tsx");
test("the dashboard has one button for the termination forms (with the numbers) instead of one entry for each scholar", () => {
  assert.ok(dash.includes("Scholarship termination forms ({forms.length})") && dash.includes("setFormsOpen(true)") && dash.includes("<TerminationFormsModal"));
  assert.equal(dash.includes("Download the form (PDF)"), false, "no individual download button on the dashboard");
});
test("the pop-up is a table organized by name, year level, school and program, with the status and the download", () => {
  for (const h of ['label: "Name"', 'label: "Year level"', 'label: "School"', 'label: "Program"']) assert.ok(forms.includes(h), h);
  assert.ok(forms.includes("Download (PDF)") && forms.includes("{i.yearLevel || \"—\"}") && forms.includes("{i.school || \"—\"}") && forms.includes("{i.program || \"—\"}"));
});
test("it lists both the removals still to be approved (no download yet) and the approved ones (download)", () => {
  assert.ok(forms.includes("Waiting for the Division Head's approval") && forms.includes("Not yet available") && forms.includes('i.state === "waiting"'));
  assert.ok(forms.includes("Approved: waiting for your final decision") && forms.includes("Approved: final decision made") && forms.includes("onDownload(i.referralId)"));
});
test("pressing a heading orders the list by it (press again to reverse); the pop-up fits the screen and the table scrolls inside it", () => {
  assert.ok(forms.includes("sortRemovalForms(items, sort.key, sort.dir)") && forms.includes("aria-sort") && forms.includes("extraWide") && forms.includes("overflow-auto"));
});
test("the list asks for the new columns and still works before the database update", () => {
  const api = src("src/lib/removalFormApi.ts");
  assert.ok(api.includes("yearLevel: str(r.year_level)") && api.includes("school: str(r.school)") && api.includes("program: str(r.program)") && api.includes('r.state === "waiting"') && api.includes("r.final_decision_made ?"));
});

console.log("The ordering");
const rows = [
  { name: "Cruz, Ana", yearLevel: "3rd Year", school: "Beta University", program: "BS Nursing" },
  { name: "Abad, Ben", yearLevel: "1st Year", school: "alpha College", program: "BS Civil Engineering" },
  { name: "Dela Cruz, Eli", yearLevel: "10th Year", school: "Alpha College", program: "BS Nursing" },
  { name: "Bautista, Cy", yearLevel: "2nd Year", school: "Beta University", program: "AB History" },
  { name: "Zed, Zoe", yearLevel: "", school: "Alpha College", program: "" },
];
const names = (key, dir) => S.sortRemovalForms(rows, key, dir).map(r => r.name);
test("by name", () => { assert.deepEqual(names("name"), ["Abad, Ben", "Bautista, Cy", "Cruz, Ana", "Dela Cruz, Eli", "Zed, Zoe"]); assert.deepEqual(names("name", -1), [...names("name")].reverse()); });
test("by year level in the natural order (1st, 2nd, 3rd, 10th), a blank year level last", () => assert.deepEqual(names("yearLevel"), ["Abad, Ben", "Bautista, Cy", "Cruz, Ana", "Dela Cruz, Eli", "Zed, Zoe"]));
test("by school (capitals do not matter), equal schools by name", () => assert.deepEqual(names("school"), ["Abad, Ben", "Dela Cruz, Eli", "Zed, Zoe", "Bautista, Cy", "Cruz, Ana"]));
test("by program, equal programs by name; the original list is not changed", () => {
  assert.deepEqual(names("program"), ["Zed, Zoe", "Bautista, Cy", "Abad, Ben", "Cruz, Ana", "Dela Cruz, Eli"]);
  assert.equal(rows[0].name, "Cruz, Ana");
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
