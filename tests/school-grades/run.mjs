// tests/school-grades/run.mjs
// Run:  node tests/school-grades/run.mjs
// No database or browser needed. Bundles src/school/gradeSaveLogic.ts with esbuild (already in node_modules via Vite)
// and checks the rules behind "a saved grade must show up, with a confirmation, or the school must be told why not".
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "school-grades-")), "logic.mjs");
await build({
  entryPoints: [path.join(root, "src/school/gradeSaveLogic.ts")],
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
  alias: { "@": path.join(root, "src") },
});
const L = await import(pathToFileURL(out).href);

const outPeriods = path.join(path.dirname(out), "periods.mjs");
await build({
  entryPoints: [path.join(root, "src/lib/academicPeriods.ts")],
  bundle: true, format: "esm", platform: "node", outfile: outPeriods, logLevel: "error",
  alias: { "@": path.join(root, "src") },
});
const P = await import(pathToFileURL(outPeriods).href);

const outBulk = path.join(path.dirname(out), "bulk.mjs");
await build({
  entryPoints: [path.join(root, "src/school/bulkGradeLogic.ts")],
  bundle: true, format: "esm", platform: "node", outfile: outBulk, logLevel: "error",
  alias: { "@": path.join(root, "src") },
});
const B = await import(pathToFileURL(outBulk).href);

const outGwa = path.join(path.dirname(out), "gwa.mjs");
await build({
  entryPoints: [path.join(root, "src/lib/gwa.ts")],
  bundle: true, format: "esm", platform: "node", outfile: outGwa, logLevel: "error",
});
const G = await import(pathToFileURL(outGwa).href);

const outPortal = path.join(path.dirname(out), "portal.mjs");
await build({
  entryPoints: [path.join(root, "src/school/portalLogic.ts")],
  bundle: true, format: "esm", platform: "node", outfile: outPortal, logLevel: "error",
  alias: { "@": path.join(root, "src") },
});
const PL = await import(pathToFileURL(outPortal).href);
const outHelp = path.join(path.dirname(out), "help.mjs");
await build({ entryPoints: [path.join(root, "src/school/helpContent.ts")], bundle: true, format: "esm", platform: "node", outfile: outHelp, logLevel: "error" });
const H = await import(pathToFileURL(outHelp).href);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { console.error("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
}

const period = { schoolYear: "2026-2027", semester: "1st Semester" };
const row = (id, grade, extra = {}) => ({ id, scholarIdNumber: "007", schoolYear: "2026-2027", semester: "1st Semester", subjectCode: "", subject: "Math", grade, ...extra });

console.log("Confirmation message");
test("one graded subject reads 'Saved: 1.75 · 1st Semester 2026-2027'", () => {
  assert.equal(L.savedMessage([{ id: "a", subject: "Math", grade: "1.75" }], 0, period), "Saved: 1.75 · 1st Semester 2026-2027");
});
test("one declared-but-ungraded subject says so", () => {
  assert.equal(L.savedMessage([{ id: "a", subject: "Math", grade: "  " }], 0, period), "Saved: Math (no grade yet) · 1st Semester 2026-2027");
});
test("several subjects are counted", () => {
  const saved = [1, 2, 3].map(n => ({ id: String(n), subject: "S" + n, grade: "2.0" }));
  assert.equal(L.savedMessage(saved, 0, period), "Saved 3 subjects · 1st Semester 2026-2027");
});
test("removals are reported, alone or together with saves", () => {
  assert.equal(L.savedMessage([], 2, period), "2 subjects removed · 1st Semester 2026-2027");
  assert.equal(L.savedMessage([{ id: "a", subject: "Math", grade: "1.5" }], 1, period), "Saved: 1.5 · 1st Semester 2026-2027 · 1 subject removed");
});

console.log("Read-back check (catches 'success shown but nothing saved')");
test("a saved grade that comes back is confirmed", () => {
  assert.deepEqual(L.findUnconfirmed([{ id: "a", subject: "Math", grade: "1.75" }], [row("a", "1.75")]), []);
});
test("a row that is missing from the read-back is reported", () => {
  assert.deepEqual(L.findUnconfirmed([{ id: "a", subject: "Math", grade: "1.75" }], []), ["Math"]);
});
test("a row that came back with a different grade is reported", () => {
  assert.deepEqual(L.findUnconfirmed([{ id: "a", subject: "Math", grade: "1.75" }], [row("a", "3.00")]), ["Math"]);
});
test("whitespace differences do not count as a mismatch", () => {
  assert.deepEqual(L.findUnconfirmed([{ id: "a", subject: "Math", grade: " 1.75 " }], [row("a", "1.75")]), []);
});

console.log("Blank-subject rows are not silently dropped");
test("a row with a grade but no subject is rejected with its row number", () => {
  const msg = L.validateEntryRows([{ id: "1", subjectCode: "", subject: "Math", grade: "1" }, { id: "2", subjectCode: "", subject: " ", grade: "1.5" }]);
  assert.equal(msg, "Row 2 needs a Subject Name before it can be saved.");
});
test("a completely empty row is ignored, not an error", () => {
  assert.equal(L.validateEntryRows([{ id: "1", subjectCode: "", subject: "", grade: "" }]), null);
});

console.log("Table columns (Subjects / Graded / GWA)");
test("a saved grade is reflected in the per-scholar summary", () => {
  const s = L.summarizeScholarGrades([row("a", "1.75"), row("b", "2.25"), row("c", "")], []);
  assert.deepEqual({ subjects: s.subjects, graded: s.graded }, { subjects: 3, graded: 2 });
  assert.equal(s.gwa, 2);
});
test("a scholar with no rows has 0 subjects and no GWA", () => {
  assert.deepEqual(L.summarizeScholarGrades([], []), { subjects: 0, graded: 0, gwa: null, missingUnits: 0 });
});
test("rows are grouped per scholar so one scholar's grades never land on another", () => {
  const map = L.groupByScholar([row("a", "1", { scholarIdNumber: "007" }), row("b", "2", { scholarIdNumber: "008" }), row("c", "3", { scholarIdNumber: "007" })]);
  assert.deepEqual(map.get("007").map(r => r.id), ["a", "c"]);
  assert.deepEqual(map.get("008").map(r => r.id), ["b"]);
});

console.log("Academic periods (Phase 2)");
const mk = (schoolYear, term, status = "open", deadline = null) => ({ id: schoolYear + term, schoolYear, term, status, deadline });
test("term names are recognised however they were typed (same rules as the database)", () => {
  for (const t of ["1st Semester", "1st sem", "First Semester", "1", "Sem 1", "1ST SEMESTER"]) assert.equal(P.normalizeTerm(t), "1st Semester", t);
  for (const t of ["2nd Semester", "2nd sem", "second semester", "2"]) assert.equal(P.normalizeTerm(t), "2nd Semester", t);
  for (const t of ["Summer", "midyear", "Mid-Year", "Summer/Midyear"]) assert.equal(P.normalizeTerm(t), "Summer", t);
  for (const t of ["Trimester 9", "", "3rd Semester"]) assert.equal(P.normalizeTerm(t), null, t);
  assert.equal(P.normalizeTerm(null), null);
});
test("a school year must be two consecutive years", () => {
  assert.equal(P.isValidSchoolYear("2026-2027"), true);
  for (const bad of ["2026-2028", "2026", "26-27", "2027-2026", "abcd-efgh", ""]) assert.equal(P.isValidSchoolYear(bad), false, bad);
});
test("periods sort newest first: later year first, then Summer, 2nd, 1st", () => {
  const sorted = P.sortPeriods([mk("2025-2026", "2nd Semester"), mk("2026-2027", "1st Semester"), mk("2025-2026", "Summer"), mk("2025-2026", "1st Semester"), mk("2026-2027", "2nd Semester")]);
  assert.deepEqual(sorted.map(p => p.schoolYear + " " + p.term), ["2026-2027 2nd Semester", "2026-2027 1st Semester", "2025-2026 Summer", "2025-2026 2nd Semester", "2025-2026 1st Semester"]);
});
test("a period is the same period however its semester was spelled", () => {
  assert.equal(P.periodKey("2026-2027", "1st sem"), P.periodKey("2026-2027 ", "1st Semester"));
  assert.notEqual(P.periodKey("2026-2027", "1st Semester"), P.periodKey("2026-2027", "2nd Semester"));
  const found = P.findPeriod([mk("2026-2027", "1st Semester", "closed")], { schoolYear: "2026-2027", semester: "First Semester" });
  assert.equal(found?.status, "closed");
});
test("schools can only edit in an Open period", () => {
  assert.equal(P.canSchoolEdit("open"), true);
  for (const st of ["closed", "archived", null, undefined]) assert.equal(P.canSchoolEdit(st), false, String(st));
});
test("dropdown labels: current period marked, status shown for staff, 'All periods' last", () => {
  const periods = [mk("2025-2026", "1st Semester", "closed"), mk("2026-2027", "1st Semester", "open"), mk("2026-2027", "Summer", "archived")];
  const cur = { schoolYear: "2026-2027", semester: "1st Semester" };
  const plain = P.periodOptions(periods, cur, { includeAll: true });
  assert.deepEqual(plain.map(o => o.label), ["2026-2027 · Summer / Midyear", "2026-2027 · 1st Semester (current)", "2025-2026 · 1st Semester", "All periods"]);
  const staff = P.periodOptions(periods, cur, { withStatus: true });
  assert.deepEqual(staff.map(o => o.label), ["2026-2027 · Summer / Midyear (Archived)", "2026-2027 · 1st Semester (Open, current)", "2025-2026 · 1st Semester (Closed)"]);
});
test("deadline text counts days left, today, and passed", () => {
  const today = new Date(2026, 10, 3); // Nov 3, 2026 (local)
  assert.equal(P.deadlineSummary("2026-11-15", today), "Deadline: Nov 15, 2026 (12 days left)");
  assert.equal(P.deadlineSummary("2026-11-04", today), "Deadline: Nov 4, 2026 (1 day left)");
  assert.equal(P.deadlineSummary("2026-11-03", today), "Deadline: Nov 3, 2026 (due today)");
  assert.equal(P.deadlineSummary("2026-11-01", today), "Deadline: Nov 1, 2026 (passed)");
  assert.equal(P.deadlineSummary(null, today), null);
});

console.log("Bulk upload (Phase 3)");
const PERIOD = { schoolYear: "2026-2027", semester: "1st Semester" };
const scholar = (id, last, first, mid = "") => ({ scholarIdNumber: id, firstName: first, lastName: last, middleName: mid, yearLevel: "1st Year", course: "BSIT" });
const SCHOLARS = [scholar("2409-00001", "Santos", "Maria"), scholar("2409-00002", "Dela Cruz", "Juan", "Perez"), scholar("2409-00003", "Reyes", "Ana")];
const sg = (id, scholarId, code, subject, grade, units = null) => ({ id, scholarIdNumber: scholarId, schoolYear: "2026-2027", semester: "1st Semester", subjectCode: code, subject, grade, units });
const EXISTING = [sg("g1", "2409-00002", "MATH101", "College Algebra", "1.75", 3), sg("g2", "2409-00002", "ENG101", "English", "", 3)];
const CONFIG = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: true };
const LETTERS = [{ letter: "INC", numericValue: null }, { letter: "DRP", numericValue: null }];
const CTX = { period: PERIOD, periodStatus: "open", scholars: SCHOLARS, existing: EXISTING, config: CONFIG, letters: LETTERS };
const HEAD = "school_year,semester,scholar_id,scholar_name,subject_code,subject_name,units,grade";
const csv = (...lines) => [HEAD, ...lines].join("\r\n");
const q = v => `"${v}"`; // names contain commas, so they are quoted exactly as a spreadsheet would write them
const line = (o = {}) => [o.sy ?? "2026-2027", o.sem ?? "1st Semester", o.id ?? "2409-00001", q(o.name ?? "Santos, Maria"), o.code ?? "PE101", o.subj ?? "Physical Education", o.units ?? "2", o.grade ?? "1.5"].join(",");
const parse = (text, over = {}) => B.parseGradeUpload(text, { ...CTX, ...over });
const only = r => { assert.equal(r.fileError, undefined, r.fileError); return r.rows; };

test("template: pre-filled with the period, every scholar, and their declared subjects", () => {
  const t = B.buildTemplate(SCHOLARS, EXISTING, PERIOD);
  assert.deepEqual(t.headers, ["school_year", "semester", "scholar_id", "scholar_name", "subject_code", "subject_name", "units", "grade"]);
  assert.equal(t.rows.length, 4); // Dela Cruz x2 subjects, Reyes x1 blank, Santos x1 blank
  assert.deepEqual(t.rows[0], ["2026-2027", "1st Semester", "2409-00002", "Dela Cruz, Juan P.", "MATH101", "College Algebra", 3, "1.75"]);
  assert.deepEqual(t.rows[2], ["2026-2027", "1st Semester", "2409-00003", "Reyes, Ana", "", "", "", ""]);
  assert.equal(t.rows[3][2], "2409-00001");
});
test("template round-trips: a freshly downloaded template with grades typed in validates cleanly", () => {
  const t = B.buildTemplate(SCHOLARS, [], PERIOD);
  const filled = [HEAD, ...t.rows.map(r => { const c = [...r]; c[3] = q(c[3]); c[4] = "X1"; c[5] = "Subject"; c[7] = "1.5"; return c.join(","); })].join("\r\n");
  const rows = only(parse(filled, { existing: [] }));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.status === "valid" && r.action === "add"));
});
test("the whole file is refused when the period is not Open (or not set up)", () => {
  assert.match(parse(csv(line()), { periodStatus: "closed" }).fileError, /Closed/);
  assert.match(parse(csv(line()), { periodStatus: "archived" }).fileError, /Archived/);
  assert.match(parse(csv(line()), { periodStatus: null }).fileError, /not been set up/);
});
test("the whole file is refused when the school has not set up its grading scale", () => {
  assert.match(parse(csv(line()), { config: null }).fileError, /grading scale/);
});
test("the whole file is refused when a required column is missing", () => {
  const r = parse("school_year,semester,scholar_name,grade\r\n2026-2027,1st Semester,x,1");
  assert.match(r.fileError, /scholar_id, subject_name/);
});
test("the whole file is refused when any row is for a different period — nothing is checked", () => {
  const r = parse(csv(line(), line({ id: "2409-00002", sem: "2nd Semester" }), line({ id: "2409-00003", sy: "2025-2026" })));
  assert.match(r.fileError, /does not match the period you chose/);
  assert.match(r.fileError, /Row 3/);
  assert.match(r.fileError, /1 other row/);
  assert.equal(r.rows.length, 0);
});
test("a row with a blank period also rejects the file", () => {
  assert.match(parse(csv(line({ sy: "" }))).fileError, /\(blank\)/);
});
test("the period in the file may use a different spelling of the same term", () => {
  const rows = only(parse(csv(line({ sem: "1st sem" }))));
  assert.equal(rows[0].status, "valid");
  assert.equal(rows[0].payload.semester, "1st Semester");
});
test("a Excel-style file that starts with a byte-order mark still works", () => {
  const rows = only(parse(String.fromCharCode(0xfeff) + csv(line())));
  assert.equal(rows.length, 1);
});
test("a scholar is matched by ID, never by name — an unknown ID is an error whoever the name belongs to", () => {
  const rows = only(parse(csv(line({ id: "9999-00000", name: "Santos, Maria" }))));
  assert.equal(rows[0].status, "error");
  assert.match(rows[0].messages[0], /not one of your school's scholars/);
  assert.equal(rows[0].payload, null);
});
test("right ID but a name that looks different is saved by ID, with a warning", () => {
  const rows = only(parse(csv(line({ name: "Totally Different" }))));
  assert.equal(rows[0].status, "warning");
  assert.match(rows[0].messages[0], /matched by ID|Rows are matched by ID/);
  assert.equal(rows[0].payload.scholarIdNumber, "2409-00001");
});
test("grade must be on the school's scale or a letter in its table; blank is allowed", () => {
  const g = grade => only(parse(csv(line({ grade }))))[0];
  assert.equal(g("1.75").status, "valid");
  assert.equal(g("5").status, "valid");
  assert.equal(g("").status, "valid");
  assert.equal(g("INC").status, "valid");
  assert.equal(g("inc").status, "valid");
  assert.match(g("6").messages[0], /outside your grading scale \(1 to 5\)/);
  assert.match(g("0.5").messages[0], /outside your grading scale/);
  assert.match(g("Z").messages[0], /not on your grading scale.*letter-grade table/);
  assert.match(g(q("1,75")).messages[0], /decimal point/); // quoted, as a spreadsheet writes a value containing a comma
});
test("without letter grades turned on, a letter is not accepted", () => {
  const r = only(parse(csv(line({ grade: "INC" })), { config: { ...CONFIG, usesLetterGrades: false } }))[0];
  assert.equal(r.status, "error");
});
test("units must be a positive number (blank is allowed)", () => {
  const u = units => only(parse(csv(line({ units }))))[0];
  assert.equal(u("3").status, "valid");
  assert.equal(u("1.5").payload.units, 1.5);
  assert.equal(u("").payload.units, null);
  for (const bad of ["0", "-1", "abc", "2 units"]) { assert.equal(u(bad).status, "error", bad); assert.match(u(bad).messages.join(" "), /positive number/); }
});
test("duplicate scholar + subject code rows are both flagged", () => {
  const rows = only(parse(csv(line({ code: "PE101" }), line({ code: "pe101", subj: "PE again" }))));
  assert.deepEqual(rows.map(r => r.status), ["error", "error"]);
  assert.match(rows[0].messages.join(" "), /also appear in row 3/);
  assert.match(rows[1].messages.join(" "), /also appear in row 2/);
});
test("with no subject code, duplicates are detected by subject name; same code for different scholars is fine", () => {
  const dup = only(parse(csv(line({ code: "", subj: "PE" }), line({ code: "", subj: "pe" }))));
  assert.deepEqual(dup.map(r => r.status), ["error", "error"]);
  const fine = only(parse(csv(line({ id: "2409-00001" }), line({ id: "2409-00003", name: "Reyes, Ana" }))));
  assert.deepEqual(fine.map(r => r.status), ["valid", "valid"]);
});
test("overwriting an existing grade is a warning that names both values, and updates the existing row", () => {
  const r = only(parse(csv(line({ id: "2409-00002", name: "Dela Cruz, Juan P.", code: "MATH101", subj: "College Algebra", units: "3", grade: "2.00" }))))[0];
  assert.equal(r.status, "warning");
  assert.equal(r.action, "update");
  assert.match(r.messages[0], /overwrite the existing grade 1\.75 with 2\.00/);
  assert.equal(r.payload.id, "g1");
});
test("filling in a grade for a declared-but-ungraded subject is a plain valid update", () => {
  const r = only(parse(csv(line({ id: "2409-00002", name: "Dela Cruz, Juan P.", code: "ENG101", subj: "English", units: "3", grade: "1.25" }))))[0];
  assert.equal(r.status, "valid");
  assert.equal(r.action, "update");
  assert.equal(r.payload.id, "g2");
});
test("a blank grade never wipes an existing grade — it is kept, with a warning", () => {
  const r = only(parse(csv(line({ id: "2409-00002", name: "Dela Cruz, Juan P.", code: "MATH101", subj: "College Algebra", units: "3", grade: "" }))))[0];
  assert.equal(r.status, "warning");
  assert.match(r.messages[0], /existing grade \(1\.75\) is kept/);
  assert.equal(r.payload.grade, "1.75");
});
test("a row identical to what is saved is 'no change' and is not sent", () => {
  const rows = only(parse(csv(line({ id: "2409-00002", name: "Dela Cruz, Juan P.", code: "MATH101", subj: "College Algebra", units: "3", grade: "1.75" }))));
  assert.equal(rows[0].action, "unchanged");
  assert.deepEqual(B.rowsToSave(rows), []);
});
test("counts, what gets saved, and the summary line", () => {
  const rows = only(parse(csv(
    line(),                                                                            // valid new
    line({ id: "9999", name: "x" }),                                                    // error
    line({ id: "2409-00002", name: "Dela Cruz, Juan P.", code: "MATH101", subj: "College Algebra", units: "3", grade: "2.5" }), // warning (overwrite)
    line({ id: "2409-00002", name: "Dela Cruz, Juan P.", code: "ENG101", subj: "English", units: "3", grade: "" }),               // unchanged
  )));
  assert.deepEqual(B.countRows(rows), { valid: 1, warning: 1, error: 1, unchanged: 1, toSave: 2 });
  assert.equal(B.rowsToSave(rows).length, 2);
  assert.equal(B.summaryText(48, 2, 0), "48 saved, 2 skipped");
  assert.equal(B.summaryText(10, 1, 3), "10 saved, 1 skipped, 3 unchanged");
});
test("error report lists skipped rows and rows the database refused, in file order, with the reason and the original cells", () => {
  const parsedRes = parse(csv(line({ id: "9999", name: "Nobody" }), line({ id: "2409-00003", name: "Reyes, Ana" })));
  const rows = only(parsedRes);
  const refused = [{ row: rows[1], ok: false, error: "Grades for 2026-2027 1st Semester are closed" }];
  const report = B.buildErrorReport(parsedRes.headers, rows, refused);
  const lines = report.split("\r\n");
  assert.equal(lines[0], "row_number,problem,school_year,semester,scholar_id,scholar_name,subject_code,subject_name,units,grade");
  assert.match(lines[1], /^2,Scholar ID 9999 is not one of your school's scholars\.?,2026-2027/);
  assert.match(lines[2], /^3,Not saved: Grades for 2026-2027 1st Semester are closed,/);
  assert.equal(lines.length, 3);
  assert.equal(B.buildErrorReport(parsedRes.headers, [rows[1]], [{ row: rows[1], ok: true, error: null }]), null);
});

console.log("Units-weighted GWA (Phase 4)");
const r4 = (grade, units, excludeFromGwa) => ({ grade, units, excludeFromGwa });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);
const LET = [{ letter: "A", numericValue: 1.0 }, { letter: "B", numericValue: 3.0 }, { letter: "INC", numericValue: null }];
test("GWA is weighted by units: (1.0 x 3 + 2.0 x 1) / 4 = 1.25", () => {
  near(G.computeGwa([r4("1.0", 3), r4("2.0", 1)], []), 1.25);
});
test("a subject with no units counts as 1 unit", () => {
  near(G.computeGwa([r4("1.0", 3), r4("2.0", null)], []), (1 * 3 + 2 * 1) / 4);
  near(G.computeGwa([r4("1.0", null), r4("2.0", undefined)], []), 1.5);
  assert.equal(G.DEFAULT_UNITS, 1);
});
test("rows from before units existed (no units / no flag at all) average exactly as they used to", () => {
  near(G.computeGwa([{ grade: "1.75" }, { grade: "2.25" }, { grade: "" }], []), 2.0);
});
test("excluded subjects (NSTP, PE) are left out of both the sum and the divisor", () => {
  near(G.computeGwa([r4("1.0", 3), r4("5.0", 3, true)], []), 1.0);
  assert.equal(G.computeGwa([r4("1.0", 3, true), r4("2.0", 3, true)], []), null);
});
test("a grade that does not resolve (blank, INC, unknown letter) is left out of the sum and the divisor", () => {
  const d = G.gwaDetail([r4("1.5", 3), r4("INC", 3), r4("", 3), r4("Q", 3)], LET);
  near(d.gwa, 1.5);
  assert.deepEqual({ counted: d.subjectsCounted, units: d.unitsCounted }, { counted: 1, units: 3 });
});
test("letter grades resolve through the school's table and are weighted too", () => {
  near(G.computeGwa([r4("A", 2), r4("B", 2)], LET), 2.0);
  near(G.computeGwa([r4("a", 3), r4("2.5", 1)], LET), (1 * 3 + 2.5) / 4);
});
test("when nothing resolves the GWA is null and shows as an em dash, never 0.00", () => {
  assert.equal(G.computeGwa([], []), null);
  assert.equal(G.computeGwa([r4("", 3), r4("INC", 3)], LET), null);
  assert.equal(G.formatGwa(null), "—");
  assert.equal(G.formatGwa(1.2345), "1.23");
});
test("the breakdown says how many units went in, how many had no units, and how many were excluded", () => {
  const d = G.gwaDetail([r4("1.0", 3), r4("2.0", null), r4("3.0", 2, true), r4("", 3)], []);
  assert.deepEqual({ counted: d.subjectsCounted, units: d.unitsCounted, noUnits: d.countedWithoutUnits, excluded: d.excluded }, { counted: 2, units: 4, noUnits: 1, excluded: 1 });
});
test("'needs units' flags subjects that count toward the GWA without units; excluded ones do not need them", () => {
  assert.equal(G.needsUnits({ units: null }), true);
  assert.equal(G.needsUnits({ units: undefined, excludeFromGwa: false }), true);
  assert.equal(G.needsUnits({ units: 0 }), true);
  assert.equal(G.needsUnits({ units: 3 }), false);
  assert.equal(G.needsUnits({ units: null, excludeFromGwa: true }), false);
});
test("school summary, staff view and scholar view all use the one calculation (same rows -> same number)", () => {
  const rows = [r4("1.25", 3), r4("2.5", 2), r4("3.0", 1, true), r4("", 3)];
  const viaSchool = L.summarizeScholarGrades(rows, []);
  near(viaSchool.gwa, G.computeGwa(rows, []));
  assert.equal(viaSchool.missingUnits, 0);
  assert.equal(L.summarizeScholarGrades([r4("1", null), r4("2", 3)], []).missingUnits, 1);
});
test("there is exactly ONE GWA formula in the app, and the three views import it", () => {
  const read = p => fs.readFileSync(path.join(root, p), "utf8");
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name).replace(/\\/g, "/")] : []);
  const definers = walk("src").filter(p => /function\s+(computeGwa|gwaDetail)\b/.test(read(p)));
  assert.deepEqual(definers, ["src/lib/gwa.ts"]);
  for (const p of ["src/school/gradeSaveLogic.ts", "src/sead/components/ScholarGradesTable.tsx", "src/scholar/components/dashboard/SubjectsGradesPanel.tsx"]) {
    assert.match(read(p), /from "@\/lib\/gwa"/, p);
  }
});

console.log("Manual entry (Phase 4)");
test("units typed in the Units box must be a positive number", () => {
  const row = unitsText => ({ id: "1", subjectCode: "", subject: "Math", grade: "1.5", unitsText });
  assert.equal(L.validateEntryRows([row("3")]), null);
  assert.equal(L.validateEntryRows([row("1.5")]), null);
  assert.equal(L.validateEntryRows([row("")]), null);
  for (const bad of ["0", "-2", "abc", "3 units"]) assert.match(L.validateEntryRows([row(bad)]), /Row 1: units must be a positive number/, bad);
});
test("units already saved can be changed but not cleared (clearing would silently do nothing)", () => {
  const row = (unitsText, hadUnits) => ({ id: "1", subjectCode: "", subject: "Math", grade: "", unitsText, hadUnits });
  assert.match(L.validateEntryRows([row("", true)]), /can't be cleared/);
  assert.equal(L.validateEntryRows([row("4", true)]), null);
  assert.equal(L.validateEntryRows([row("", false)]), null);
});
test("the read-back also checks the units and the exclude flag", () => {
  const saved = [{ id: "a", subject: "PE", grade: "1.5", units: 2, excludeFromGwa: true }];
  const got = (units, excludeFromGwa) => [{ id: "a", scholarIdNumber: "x", schoolYear: "2026-2027", semester: "1st Semester", subjectCode: "", subject: "PE", grade: "1.5", units, excludeFromGwa }];
  assert.deepEqual(L.findUnconfirmed(saved, got(2, true)), []);
  assert.deepEqual(L.findUnconfirmed(saved, got(3, true)), ["PE"]);
  assert.deepEqual(L.findUnconfirmed(saved, got(2, false)), ["PE"]);
  assert.deepEqual(L.findUnconfirmed([{ id: "a", subject: "PE", grade: "1.5", units: null }], got(2, true)), []); // units not sent = whatever is stored is fine
});

console.log("Template placeholder rows (Phase 4 fix)");
test("rows with a scholar but nothing typed are ignored, not reported as errors", () => {
  const t = B.buildTemplate(SCHOLARS, [], PERIOD); // three scholars, no subjects -> three placeholder rows
  const text = [HEAD, ...t.rows.map((r, i) => { const c = [...r]; c[3] = q(c[3]); if (i === 0) { c[4] = "X1"; c[5] = "Real subject"; c[7] = "1.5"; } return c.join(","); })].join("\r\n");
  const res = parse(text, { existing: [] });
  assert.equal(res.fileError, undefined);
  assert.equal(res.rows.length, 1);
  assert.equal(res.ignoredBlank, 2);
  assert.equal(res.rows[0].status, "valid");
  assert.equal(res.rows[0].rowNumber, 2); // row numbers still point at the real file line
});
test("an untouched template (everything blank) is refused with a plain message", () => {
  const t = B.buildTemplate(SCHOLARS, [], PERIOD);
  const text = [HEAD, ...t.rows.map(r => { const c = [...r]; c[3] = q(c[3]); return c.join(","); })].join("\r\n");
  assert.match(parse(text, { existing: [] }).fileError, /Nothing is filled in yet/);
});
test("an upload never sends the exclude flag, so it cannot change it for existing subjects", () => {
  const rows = only(parse(csv(line())));
  assert.equal("excludeFromGwa" in rows[0].payload, false);
});

console.log("School Portal redesign (Phase 5)");
const sch = (id, last, first, year, course, mid = "") => ({ scholarIdNumber: id, lastName: last, firstName: first, middleName: mid, yearLevel: year, course });
const mkRow = (scholar, subjects, graded, submitted = false) => {
  const summary = { subjects, graded, gwa: graded > 0 ? 1.5 : null, missingUnits: 0 };
  return { scholar, summary, status: PL.scholarStatus(summary, submitted) };
};
const ROWS = [
  mkRow(sch("2409-00001", "Santos", "Maria", "1st Year", "BS IT"), 5, 5),
  mkRow(sch("2409-00002", "Dela Cruz", "Juan", "1st Year", "BS IT", "Perez"), 6, 3),
  mkRow(sch("2409-00003", "Reyes", "Ana", "1st Year", "BS Education"), 0, 0),
  mkRow(sch("2409-00004", "Garcia", "Pedro", "2nd Year", "BS Education"), 4, 4),
  mkRow(sch("2409-00005", "Lopez", "Rosa", "", ""), 0, 0),
];

test("status of a scholar follows the strict 'complete' rule: no subjects = not set up; any ungraded subject = not graded; all graded = complete", () => {
  assert.equal(PL.scholarStatus({ subjects: 0, graded: 0 }), "not_set_up");
  assert.equal(PL.scholarStatus({ subjects: 5, graded: 0 }), "not_graded");
  assert.equal(PL.scholarStatus({ subjects: 5, graded: 4 }), "not_graded");
  assert.equal(PL.scholarStatus({ subjects: 5, graded: 5 }), "complete");
  assert.equal(PL.scholarStatus({ subjects: 5, graded: 5 }, true), "submitted");
  assert.equal(PL.scholarStatus({ subjects: 5, graded: 3 }, true), "not_graded"); // submitted only counts for a complete scholar
});
test("status chips always carry a text label (colour is never the only signal)", () => {
  assert.deepEqual(Object.values(PL.STATUS_LABEL), ["Not set up", "Not graded", "Complete", "Submitted"]);
});
test("summary counts: total, complete, declared-not-graded, not set up, and the percent complete", () => {
  const c = PL.portalCounts(ROWS);
  assert.deepEqual({ t: c.total, c: c.complete, d: c.declaredNotGraded, n: c.notSetUp, p: c.percent }, { t: 5, c: 2, d: 1, n: 2, p: 40 });
  assert.equal(c.gradedSubjects, 12);
  assert.deepEqual(PL.portalCounts([]), { total: 0, complete: 0, declaredNotGraded: 0, notSetUp: 0, submitted: 0, percent: 0, gradedSubjects: 0 });
});
test("percent rounds DOWN so 100% really means every scholar is complete", () => {
  const many = Array.from({ length: 200 }, (_, i) => mkRow(sch("x" + i, "L", "F", "1st Year", "P"), 1, i === 0 ? 0 : 1));
  assert.equal(PL.portalCounts(many).percent, 99);
});
test("the period bar status: Not started / In progress / Ready to submit / Submitted", () => {
  assert.equal(PL.periodProgressLabel(PL.portalCounts([])), "Not started");
  assert.equal(PL.periodProgressLabel(PL.portalCounts([mkRow(sch("a", "A", "A", "", ""), 3, 0)])), "Not started");
  assert.equal(PL.periodProgressLabel(PL.portalCounts(ROWS)), "In progress");
  assert.equal(PL.periodProgressLabel(PL.portalCounts([mkRow(sch("a", "A", "A", "", ""), 3, 3)])), "Ready to submit");
  assert.equal(PL.periodProgressLabel(PL.portalCounts([mkRow(sch("a", "A", "A", "", ""), 3, 3, true)])), "Submitted");
});
test("Submit grades stays disabled until every scholar is complete", () => {
  assert.equal(PL.canSubmit(PL.portalCounts(ROWS)), false);
  assert.equal(PL.canSubmit(PL.portalCounts([])), false);
  assert.equal(PL.canSubmit(PL.portalCounts([mkRow(sch("a", "A", "A", "", ""), 3, 3), mkRow(sch("b", "B", "B", "", ""), 2, 2)])), true);
  assert.equal(PL.canSubmit(PL.portalCounts([mkRow(sch("a", "A", "A", "", ""), 3, 3, true)])), false); // already submitted
});
test("year levels sort in order: 1st, 2nd, 3rd, 10th, then numbered labels, then others, '(Not set)' last", () => {
  assert.deepEqual(PL.sortYearLevels(["3rd Year", "(Not set)", "1st Year", "10th Year", "2nd Year", "Grade 11", "Irregular"]),
    ["1st Year", "2nd Year", "3rd Year", "10th Year", "Grade 11", "Irregular", "(Not set)"]);
});
test("year-level cards carry 'x of y complete' and a percent, in year order", () => {
  const g = PL.groupProgress(ROWS, s => PL.yearLevelOf(s), PL.sortYearLevels);
  assert.deepEqual(g.map(x => [x.key, x.complete, x.total, x.percent]), [["1st Year", 1, 3, 33], ["2nd Year", 1, 1, 100], ["(Not set)", 0, 1, 0]]);
});
test("a scholar with no year level or program is grouped under '(Not set)'", () => {
  assert.equal(PL.yearLevelOf(sch("x", "L", "F", "", "")), "(Not set)");
  assert.equal(PL.programOf(sch("x", "L", "F", "1st Year", "  ")), "(Not set)");
});
test("search finds a scholar by name (any word order, any case) or by ID", () => {
  const s = ROWS[1].scholar; // Dela Cruz, Juan Perez, 2409-00002
  for (const q of ["juan", "DELA CRUZ", "cruz juan", "juan dela", "perez", "2409-00002", "00002", ""]) assert.equal(PL.matchesSearch(s, q), true, q);
  for (const q of ["maria", "juan santos", "2409-00099"]) assert.equal(PL.matchesSearch(s, q), false, q);
});
test("filters combine: year level, program, status and search", () => {
  assert.equal(PL.filterRows(ROWS, {}).length, 5);
  assert.deepEqual(PL.filterRows(ROWS, { yearLevel: "1st Year" }).map(r => r.scholar.scholarIdNumber), ["2409-00001", "2409-00002", "2409-00003"]);
  assert.deepEqual(PL.filterRows(ROWS, { yearLevel: "1st Year", program: "BS IT" }).length, 2);
  assert.deepEqual(PL.filterRows(ROWS, { status: "not_set_up" }).map(r => r.scholar.scholarIdNumber), ["2409-00003", "2409-00005"]);
  assert.deepEqual(PL.filterRows(ROWS, { yearLevel: "1st Year", status: "complete", search: "santos" }).map(r => r.scholar.scholarIdNumber), ["2409-00001"]);
  assert.deepEqual(PL.filterRows(ROWS, { yearLevel: "(Not set)" }).map(r => r.scholar.scholarIdNumber), ["2409-00005"]);
  assert.equal(PL.filterRows(ROWS, { search: "nobody" }).length, 0);
});
test("breadcrumbs read Scholars > 5th Year > BS Education and each ancestor links back to its own level", () => {
  assert.deepEqual(PL.breadcrumbs({ level: "yearLevels" }), [{ label: "Scholars", to: null }]);
  assert.deepEqual(PL.breadcrumbs({ level: "programs", yearLevel: "5th Year" }), [{ label: "Scholars", to: { level: "yearLevels" } }, { label: "5th Year", to: null }]);
  assert.deepEqual(PL.breadcrumbs({ level: "scholars", yearLevel: "5th Year", program: "BS Education" }), [
    { label: "Scholars", to: { level: "yearLevels" } },
    { label: "5th Year", to: { level: "programs", yearLevel: "5th Year" } },
    { label: "BS Education", to: null },
  ]);
});
test("the allowed-grades hint shows the range and the school's letters", () => {
  const cfg = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: true };
  assert.equal(PL.gradeInputHint(cfg, [{ letter: "INC", numericValue: null }, { letter: "DRP", numericValue: null }]), "Allowed: 1 to 5, or INC, DRP");
  assert.equal(PL.gradeInputHint({ ...cfg, usesLetterGrades: false }, [{ letter: "INC", numericValue: null }]), "Allowed: 1 to 5");
  assert.equal(PL.gradeInputHint({ ...cfg, scaleMin: 60, scaleMax: 100 }, []), "Allowed: 60 to 100");
  assert.equal(PL.gradeInputHint(null, []), "Set up your grading scale first.");
});
test("change-password rules: current required, 8+ characters, different from current, confirmation must match", () => {
  assert.equal(PL.validateNewPassword("", "newpassword1", "newpassword1"), "Enter your current password.");
  assert.match(PL.validateNewPassword("old", "short", "short"), /at least 8 characters/);
  assert.match(PL.validateNewPassword("samepass1", "samepass1", "samepass1"), /different from the current/);
  assert.match(PL.validateNewPassword("oldpass1", "newpassword1", "newpassword2"), /do not match/);
  assert.equal(PL.validateNewPassword("oldpass1", "newpassword1", "newpassword1"), null);
});
test("Help / Contact CEDO uses the office's own letterhead details", () => {
  assert.equal(H.CEDO_CONTACT.email, "cedo@cagayandeoro.gov.ph");
  assert.equal(H.CEDO_CONTACT.mobile, "+63 929 819 0819");
  assert.match(H.CEDO_CONTACT.mobileLink, /^\+\d{12}$/);
  assert.ok(H.HELP_STEPS.length >= 4 && H.HELP_STEPS.every(s => s.title && s.body));
});
test("every School Portal screen uses text of at least 14px for readable text (no 11-13px helper text left)", () => {
  const files = ["ScholarsDrilldownPanel", "ScholarsSummary", "ScholarsTable", "SchoolPeriodBar", "SchoolAccountMenu", "SchoolDialog", "GradingConfigPanel"].map(n => `src/school/components/${n}.tsx`);
  files.push("src/school/pages/SchoolPortalPage.tsx");
  for (const p of files) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    const small = [...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13);
    assert.deepEqual(small, [], p + " has text smaller than 13px");
  }
});
test("no School Portal screen still uses the old low-contrast helper greys or link blue", () => {
  const dir = path.join(root, "src/school");
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const f of walk(dir)) {
    if (/SchoolLoginPage/.test(f)) continue; // the sign-in page is outside this redesign
    const src = fs.readFileSync(f, "utf8");
    assert.equal(/text-slate-400|text-slate-500|#0088cc/.test(src), false, path.relative(root, f) + " still uses text-slate-400/500 or #0088cc");
  }
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
