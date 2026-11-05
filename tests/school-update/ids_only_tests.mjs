// tests/school-update/ids_only_tests.mjs — School Portal upload update (2026-11-05):
//   1. "School IDs only": the school's Excel list is used only to save each scholar's School ID (STUDENT NO.); grades stay blank / are not read.
//   2. the Excel list holds every student of the school: only the scholars are kept, the others are left out (and listed), not reported as errors.
// Run:  node tests/school-update/ids_only_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ids-"));
const bundle = async (entry, name) => {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
};
const P = await bundle("src/school/promoReport.ts", "p.mjs");
const B = await bundle("src/school/bulkGradeLogic.ts", "b.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const PERIOD = { schoolYear: "2025-2026", semester: "1st Semester" };
const CONFIG = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3 };
const sch = (id, last, first, middle, no = "") => ({ scholarIdNumber: id, lastName: last, firstName: first, middleName: middle, yearLevel: "1st Year", course: "BS Test Studies", schoolStudentNo: no });
const SCHOLARS = [
  sch("TEST-0001", "De La Cruz", "Juan", "Sanchez", "2022-001"),    // has a School ID
  sch("TEST-0002", "Santos", "Maria", "Reyes", ""),                 // none yet
  sch("TEST-0003", "Garcia", "Ana", "", ""),                        // none yet
  sch("TEST-0004", "Lopez", "Pedro", "", ""),
  sch("TEST-0005", "Lopez", "Pedro", "", ""),                       // same name as TEST-0004
];
const ctx = (over = {}) => ({ period: PERIOD, periodStatus: "open", scholars: SCHOLARS, existing: [], config: CONFIG, letters: [], ...over });
const sheetGrid = (rows, { year = "SY 2025-2026", term = "FIRST SEMESTER" } = {}) => [
  ["PROMOTIONAL REPORT / ENROLLMENT LIST"], [year], [term], [], ["SCHOOL NAME:", "Test College"], [], [], [], [], [], [],
  P.PROMO_COLUMNS.slice(), ...rows, [], ["SUMMARY OF STUDENTS PER PROGRAM:"], ["", "BS Test Studies", "3"],
];
//        program, major, no, year, last, first, middle, ext, sex, nat, code, description, units, grade, remarks
const R = (no, last, first, middle, code = "", desc = "", grade = "", remarks = "", units = "") => ["BS Test Studies", "", no, "1st", last, first, middle, "", "", "", code, desc, units, grade, remarks];
const CONT = (code, desc, grade = "", units = "3") => ["", "", "", "", "", "", "", "", "", "", code, desc, units, grade, ""];

console.log("The Excel list holds every student: only the scholars are kept (grades upload)");
await test("students who are not scholars are left out, not errors; the scholars' rows are still checked", () => {
  const r = B.parsePromoUpload(sheetGrid([
    R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "", "3"), CONT("B", "Subj B", "1.5"),
    R("2022-050", "REYES", "PAOLO", "", "A", "Subj A", "1", "", "3"),            // not a scholar
    R("2022-051", "TAN", "LIA", "", "A", "Subj A", "2", "", "3"), CONT("B", "Subj B", "2"),
  ]), ctx());
  assert.equal(r.fileError, undefined);
  assert.equal(r.rows.length, 2); assert.deepEqual(r.rows.map(x => x.status), ["valid", "valid"]);
  assert.deepEqual(r.leftOut.map(l => [l.studentNo, l.name, l.rows]), [["2022-050", "REYES, PAOLO", 1], ["2022-051", "TAN, LIA", 2]]);
});
await test("a student with no Student No. who is not a scholar is left out; one who IS a scholar by name still gets the 'STUDENT NO. is required' error", () => {
  const r = B.parsePromoUpload(sheetGrid([
    R("", "NOBODY", "NAMED", "", "A", "Subj A", "2", "", "3"),
    R("", "GARCIA", "ANA", "", "A", "Subj A", "2", "", "3"),
    R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "", "3"),
  ]), ctx());
  assert.equal(r.leftOut.length, 1); assert.equal(r.leftOut[0].name, "NOBODY, NAMED");
  const bad = r.rows.find(x => x.studentNo === ""); assert.equal(bad.status, "error"); assert.match(bad.messages.join(" "), /STUDENT NO\. is required/);
});
await test("a scholar of the school with the same name as another row is NOT left out when something is wrong with them (still an error the school can fix)", () => {
  const r = B.parsePromoUpload(sheetGrid([R("9999", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "", "3"), R("2022-004", "LOPEZ", "PEDRO", "", "A", "Subj A", "2", "", "3")]), ctx());
  assert.equal(r.leftOut.length, 0); assert.deepEqual(r.rows.map(x => x.status), ["error", "error"]);
  assert.match(r.rows[0].messages.join(" "), /already has the School ID 2022-001/); assert.match(r.rows[1].messages.join(" "), /more than one scholar/);
});
await test("when nobody on the file is a scholar, the file is rejected with a clear message (and some of the names)", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-050", "REYES", "PAOLO", "", "A", "Subj A", "1", "", "3"), R("2022-051", "TAN", "LIA", "", "A", "Subj A", "2", "", "3")]), ctx());
  assert.match(r.fileError, /None of the students in this file is one of your scholars/); assert.match(r.fileError, /REYES, PAOLO/);
});
await test("a file with grades is not flagged as 'no grades'; a file with none is", () => {
  const withG = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "", "3")]), ctx());
  assert.equal(withG.noGradesInFile, false);
  const noG = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "", "", "3")]), ctx());
  assert.equal(noG.noGradesInFile, true);
});
await test("a list of students with no subject or grade at all, uploaded as grades, is rejected with a pointer to 'School IDs only' (and the screen can offer the switch)", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", ""), R("2022-002", "SANTOS", "MARIA", "")]), ctx());
  assert.match(r.fileError, /choose "School IDs only"/); assert.equal(r.noGradesInFile, true);
  const empty = B.parsePromoUpload(sheetGrid([]), ctx()); assert.match(empty.fileError, /Nothing is filled in yet/); assert.notEqual(empty.noGradesInFile, true);
});
await test("the earlier CSV layout is not changed: an unknown Scholar ID is still an error there", () => {
  const rows = [["school_year", "semester", "scholar_id", "scholar_name", "subject_code", "subject_name", "units", "grade"], ["2025-2026", "1st Semester", "TEST-9999", "X", "A", "Subj A", "3", "2"]];
  const r = B.parseGradeGrid(rows, ctx());
  assert.equal(r.rows[0].status, "error"); assert.match(r.rows[0].messages.join(" "), /not one of your school's scholars/); assert.deepEqual(r.leftOut, []);
});

console.log("\nSchool IDs only");
const ids = grid => B.parseSchoolIdsUpload(grid, SCHOLARS);
await test("the sheet's students are read with no grades at all: scholars are found, new IDs become links, non-scholars are left out", () => {
  const r = ids(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", ""), R("2022-002", "SANTOS", "MARIA", ""), R("2022-003", "GARCIA", "ANA", ""), R("2022-050", "REYES", "PAOLO", "")]));
  assert.equal(r.fileError, undefined); assert.equal(r.sheetStudents, 4);
  assert.deepEqual(r.rows.map(x => [x.studentNo, x.status, x.scholarId]), [["2022-001", "same", "TEST-0001"], ["2022-002", "link", "TEST-0002"], ["2022-003", "link", "TEST-0003"]]);
  assert.deepEqual(r.links.map(l => [l.scholarIdNumber, l.studentNo]), [["TEST-0002", "2022-002"], ["TEST-0003", "2022-003"]]);
  assert.deepEqual(r.leftOut.map(l => l.studentNo), ["2022-050"]);
});
await test("students with no subject rows at all (only the student's details) are still read, and the grades of other rows are not read", () => {
  const r = ids(sheetGrid([R("2022-002", "SANTOS", "MARIA", ""), R("2022-003", "GARCIA", "ANA", "", "A", "Subj A", "1.5", "", "3")]));
  assert.equal(r.rows.length, 2); assert.equal(r.links.length, 2); assert.equal(r.gradesNotRead, 1);
});
await test("no grade or subject comes out of a School IDs only upload (nothing to save but the links)", () => {
  const r = ids(sheetGrid([R("2022-002", "SANTOS", "MARIA", "", "A", "Subj A", "1.5", "", "3")]));
  for (const row of r.rows) assert.deepEqual(Object.keys(row).sort(), ["fileName", "message", "rowNumber", "scholarId", "scholarName", "status", "studentNo"].sort());
  assert.equal(r.rows.some(x => "payload" in x || "grade" in x), false);
});
await test("a scholar who already has another School ID is not overwritten: an error that says which one", () => {
  const r = ids(sheetGrid([R("9999", "DE LA CRUZ", "JUAN", "")]));
  assert.equal(r.rows[0].status, "error"); assert.match(r.rows[0].message, /already has the School ID 2022-001/); assert.deepEqual(r.links, []);
});
await test("two scholars with the same name and no School ID are not guessed", () => {
  const r = ids(sheetGrid([R("2022-004", "LOPEZ", "PEDRO", "")]));
  assert.equal(r.rows[0].status, "error"); assert.match(r.rows[0].message, /more than one scholar/); assert.deepEqual(r.links, []);
});
await test("one scholar listed twice with different Student Nos.: the first is linked, the second is an error", () => {
  const r = ids(sheetGrid([R("N-1", "GARCIA", "ANA", ""), R("N-2", "GARCIA", "ANA", "")]));
  assert.deepEqual(r.rows.map(x => x.status), ["link", "error"]); assert.equal(r.links.length, 1);
});
await test("the period at the top of the sheet does not matter, and the period does not have to be open", () => {
  const r = ids(sheetGrid([R("2022-002", "SANTOS", "MARIA", "")], { year: "SY 2019-2020", term: "SECOND SEMESTER" }));
  assert.equal(r.fileError, undefined); assert.equal(r.links.length, 1);
});
await test("a file that is not the school's list is refused, an empty one too", () => {
  assert.match(ids([["a", "b"], ["c", "d"]]).fileError, /Could not find the heading row/);
  assert.match(ids([]).fileError, /empty/);
  assert.match(ids(sheetGrid([])).fileError, /No students were found/);
});
await test("a sheet with no scholar at all lists nobody to save and everyone as left out", () => {
  const r = ids(sheetGrid([R("2022-050", "REYES", "PAOLO", "")]));
  assert.equal(r.rows.length, 0); assert.equal(r.leftOut.length, 1); assert.equal(r.links.length, 0);
});
await test("the list of problems and left-out students is a CSV; none when there is nothing to list", () => {
  const some = B.buildIdsReport(ids(sheetGrid([R("9999", "DE LA CRUZ", "JUAN", ""), R("2022-050", "REYES", "PAOLO", "")])));
  assert.match(some, /Needs attention/); assert.match(some, /Left out: not one of your scholars/); assert.match(some, /REYES, PAOLO/);
  assert.equal(B.buildIdsReport(ids(sheetGrid([R("2022-002", "SANTOS", "MARIA", "")]))), null);
});

console.log("\nThe screens");
await test("the upload window asks what to upload, uses the School IDs only screen, and offers it for a file with no grades", () => {
  const modal = src("src/school/components/BulkGradeUploadModal.tsx");
  assert.match(modal, /What do you want to upload\?/); assert.match(modal, /School IDs only/); assert.match(modal, /<SchoolIdsUpload /);
  assert.match(modal, /noGradesInFile/); assert.match(modal, /left out — not on your scholars list/);
});
await test("the School IDs only screen saves only through the existing link function, after the school ticks the confirmation", () => {
  const s = src("src/school/components/SchoolIdsUpload.tsx");
  assert.match(s, /linkStudentNos\(/); assert.doesNotMatch(s, /bulkUpsertGrades/);
  assert.match(s, /disabled=\{parsed\.links\.length === 0 \|\| !linksOk/);
});
await test("no database file is needed: the existing link function is used", () => {
  assert.match(src("supabase_migration_school_student_no.sql"), /function public\.school_link_student_nos/);
  assert.equal(fs.readdirSync(root).some(f => /ids_only|school_ids_only/i.test(f)), false);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed`);
