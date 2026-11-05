// tests/school-update/promo_report_tests.mjs — School Portal: the bulk upload of grades with the schools' own "Promotional Report / Enrollment List" (Excel)
//   reading the .xlsx and the CSV saved from it, the period at the top, the student blocks, STUDENT NO. matching and the name-based links, the remarks, the template, the error report.
// Run:  node tests/school-update/promo_report_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "promo-"));
const bundle = async (entry, name) => {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
};
const X = await bundle("src/lib/xlsxLite.ts", "x.mjs");
const P = await bundle("src/school/promoReport.ts", "p.mjs");
const B = await bundle("src/school/bulkGradeLogic.ts", "b.mjs");
const C = await bundle("src/sead/csvUtils.ts", "c.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const PERIOD = { schoolYear: "2025-2026", semester: "1st Semester" };
const CONFIG = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3 };
const sch = (id, last, first, middle, no = "", course = "BS Test Studies", yl = "1st Year") => ({ scholarIdNumber: id, lastName: last, firstName: first, middleName: middle, yearLevel: yl, course, schoolStudentNo: no });
const SCHOLARS = [
  sch("TEST-0001", "De La Cruz", "Juan", "Sanchez", "2022-001"),
  sch("TEST-0002", "Santos", "Maria", "Reyes", "2022-002"),
  sch("TEST-0003", "Garcia", "Ana", "", ""),                 // no School ID yet
  sch("TEST-0004", "Lopez", "Pedro", "", ""),
  sch("TEST-0005", "Lopez", "Pedro", "", ""),                // two scholars with the same name, neither with an ID
  sch("TEST-0006", "Tan", "Lia", "", "2022-006"),
];
const ctx = (over = {}) => ({ period: PERIOD, periodStatus: "open", scholars: SCHOLARS, existing: [], config: CONFIG, letters: [], ...over });
const sheetGrid = (rows, { year = "SY 2025-2026", term = "FIRST SEMESTER" } = {}) => [
  ["PROMOTIONAL REPORT / ENROLLMENT LIST"], [year], [term], [], ["SCHOOL NAME:", "Test College"], [], [], [], [], [], [],
  P.PROMO_COLUMNS.slice(), ...rows, [], ["SUMMARY OF STUDENTS PER PROGRAM:"], ["", "BS Test Studies", "3"],
];
//        program, major, no, year, last, first, middle, ext, sex, nat, code, description, units, grade, remarks
const R = (no, last, first, middle, code, desc, grade, remarks = "", units = "3") => ["BS Test Studies", "", no, "1st", last, first, middle, "", "", "", code, desc, units, grade, remarks];
const CONT = (code, desc, grade, remarks = "", units = "3") => ["", "", "", "", "", "", "", "", "", "", code, desc, units, grade, remarks];

console.log("Reading the school's own template");
const official = fs.readFileSync(path.join(root, "tests/school-update/fixtures/promo-report-template.xlsx"));
const officialGrid = await X.readXlsx(new Uint8Array(official));
await test("the .xlsx is read: the title block, the headings on row 12 and the sample student", () => {
  assert.equal(officialGrid[0][0], "PROMOTIONAL REPORT / ENROLLMENT LIST");
  assert.equal(officialGrid[1][0], "SY 2022-2023");
  assert.equal(officialGrid[11][2], "STUDENT NO.");
  assert.equal(officialGrid[12][4], "DE LA CRUZ");
  assert.equal(officialGrid[13][10], "MATH 1");
});
await test("the sheet is recognised as the promotional report, the period and the four sample subjects are found, the summary at the bottom is not data", () => {
  assert.equal(P.looksLikePromoReport(officialGrid), true);
  const sheet = P.readPromoReport(officialGrid);
  assert.equal(sheet.schoolYear, "2022-2023"); assert.equal(sheet.semester, "1st Semester");
  assert.equal(sheet.entries.length, 4);
  assert.deepEqual(sheet.entries.map(e => e.rowNumber), [13, 14, 15, 16]);
  assert.deepEqual(sheet.entries.map(e => e.grade), ["1", "5", "DRP", "INC"]);
  assert.deepEqual(sheet.entries.map(e => e.remarks), ["PASSED", "FAILED", "DROPPED", "INCOMPLETE"]);
});
await test("the student's details on the first row are carried down to the next subjects of the block", () => {
  const sheet = P.readPromoReport(officialGrid);
  for (const e of sheet.entries) { assert.equal(e.last, "DE LA CRUZ"); assert.equal(e.first, "JUAN"); assert.equal(e.middle, "SANCHEZ"); assert.equal(e.yearLevel, "1ST"); }
  assert.equal(sheet.entries[3].code, "FIL 1");
});
await test("a legacy CSV (school_year, semester, scholar_id …) is not mistaken for the promotional report", () => {
  assert.equal(P.looksLikePromoReport([["school_year", "semester", "scholar_id", "scholar_name", "subject_code", "subject_name", "units", "grade", "remarks"], ["2025-2026", "1st Semester", "TEST-0001", "x", "A", "B", "3", "1", ""]]), false);
});

console.log("\nThe checks on a promotional report");
await test("each student is found by STUDENT NO.; the rows are saved with the CEDO scholar behind it, and the grade scale is applied", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "SANCHEZ", "PE 1", "Physical Ed", "1.5", "PASSED"), CONT("MATH 1", "Mathematics", "2.0", "PASSED")]), ctx());
  assert.equal(r.fileError, undefined); assert.equal(r.format, "promo");
  assert.equal(r.rows.length, 2); assert.deepEqual(r.rows.map(x => x.status), ["valid", "valid"]);
  assert.equal(r.rows[1].payload.scholarIdNumber, "TEST-0001");
  assert.equal(r.rows[1].payload.subject, "Mathematics"); assert.equal(r.rows[1].payload.subjectCode, "MATH 1");
  assert.equal(r.rows[1].payload.schoolYear, "2025-2026"); assert.equal(r.rows[1].payload.semester, "1st Semester");
  assert.equal(r.rows[1].rowNumber, 14);            // the row number is the row in Excel (heading on 12, first student on 13)
  assert.deepEqual(r.links, []);
});
await test("the Student No. is compared without capital letters or spaces", () => {
  const r = B.parsePromoUpload(sheetGrid([R(" 2022-001 ", "x", "y", "", "A", "Subj", "2")]), ctx());
  assert.equal(r.rows[0].payload.scholarIdNumber, "TEST-0001");
});
await test("a grade outside the scale is an error on that row only", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "9"), CONT("B", "Subj B", "2")]), ctx());
  assert.deepEqual(r.rows.map(x => x.status), ["error", "valid"]);
});
await test("DRP and INC are accepted marks", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "DRP", "DROPPED"), CONT("B", "Subj B", "INC", "INCOMPLETE")]), ctx());
  assert.deepEqual(r.rows.map(x => x.status), ["valid", "valid"]);
});
await test("a missing STUDENT NO. is an error that says so", () => {
  const r = B.parsePromoUpload(sheetGrid([R("", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2")]), ctx());
  assert.equal(r.rows[0].status, "error"); assert.match(r.rows[0].messages.join(" "), /STUDENT NO\. is required/);
});
await test("the same subject twice for a student is a duplicate error, like before", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2"), CONT("A", "Subj A", "3")]), ctx());
  assert.deepEqual(r.rows.map(x => x.status), ["error", "error"]); assert.match(r.rows[0].messages.join(" "), /Duplicate/);
});
await test("a name that has nothing to do with the scholar behind the Student No. gives a warning (the row is matched by number)", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "ZZZ", "QQQ", "", "A", "Subj A", "2")]), ctx());
  assert.equal(r.rows[0].status, "warning"); assert.match(r.rows[0].messages.join(" "), /does not look like the scholar with Student No\. 2022-001/);
  assert.equal(r.rows[0].payload.scholarIdNumber, "TEST-0001");
});

console.log("\nThe REMARKS column");
await test("the remark is saved with the grade", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "PASSED")]), ctx());
  assert.equal(r.rows[0].payload.remarks, "PASSED");
});
await test("a blank remark leaves the stored remark alone (it is not cleared)", () => {
  const existing = [{ id: "g1", scholarIdNumber: "TEST-0001", schoolYear: "2025-2026", semester: "1st Semester", subjectCode: "A", subject: "Subj A", grade: "2", units: 3, excludeFromGwa: false, remarks: "NSTP" }];
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "")]), ctx({ existing }));
  assert.equal(r.rows[0].payload.remarks, null); assert.equal(r.rows[0].action, "unchanged");
});
await test("a remark that says FAILED next to a passing grade gives a warning, and is still saved as typed", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "1.5", "FAILED")]), ctx());
  assert.equal(r.rows[0].status, "warning"); assert.match(r.rows[0].messages.join(" "), /remark says FAILED, but the grade 1\.5 is a pass/);
  assert.equal(r.rows[0].payload.remarks, "FAILED");
});
await test("PASSED / FAILED / DROPPED / INCOMPLETE that agree with the grade give no warning", () => {
  const r = B.parsePromoUpload(sheetGrid([
    R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "A", "1", "PASSED"), CONT("B", "B", "5", "FAILED"), CONT("C", "C", "DRP", "DROPPED"), CONT("D", "D", "INC", "INCOMPLETE"), CONT("E", "E", "2", "NSTP"),
  ]), ctx());
  assert.deepEqual(r.rows.map(x => x.status), ["valid", "valid", "valid", "valid", "valid"]);
});
await test("a remark with no grade yet is not compared", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "", "FAILED")]), ctx());
  assert.equal(r.rows[0].status, "valid");
});

console.log("\nA new Student No. (Option A: matched by name, confirmed by the school)");
await test("a Student No. nobody has yet is matched to the one scholar of that name without a School ID, and shown as a link to confirm", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-003", "GARCIA", "ANA", "", "A", "Subj A", "2"), CONT("B", "Subj B", "1.5")]), ctx());
  assert.deepEqual(r.rows.map(x => x.status), ["warning", "warning"]);
  assert.equal(r.rows[0].payload.scholarIdNumber, "TEST-0003");
  assert.deepEqual(r.links, [{ scholarIdNumber: "TEST-0003", studentNo: "2022-003", scholarName: "Garcia, Ana" }]);
  assert.match(r.rows[0].messages.join(" "), /will be linked to Garcia, Ana \(TEST-0003\)/);
});
await test("the middle name settles it only when both have one and they differ", () => {
  const ok = B.parsePromoUpload(sheetGrid([R("2022-003", "GARCIA", "ANA", "B", "A", "Subj A", "2")]), ctx());
  assert.equal(ok.links.length, 1);                                 // the scholar has no middle name on record
  const no = B.parsePromoUpload(sheetGrid([R("2022-002x", "SANTOS", "MARIA", "Z", "A", "Subj A", "2")]), ctx());
  assert.equal(no.links.length, 0);                                 // Maria Reyes Santos already has an ID anyway
});
await test("two scholars with the same name and no School ID: not guessed, an error that says what to do", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-004", "LOPEZ", "PEDRO", "", "A", "Subj A", "2")]), ctx());
  assert.equal(r.rows[0].status, "error"); assert.match(r.rows[0].messages.join(" "), /more than one scholar/); assert.deepEqual(r.links, []);
});
await test("a name nobody has is not one of the school's scholars: the student is left out (no error), and listed so the school can check", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2"), R("2022-099", "NOBODY", "NAMED", "", "A", "Subj A", "2"), CONT("B", "Subj B", "1.5")]), ctx());
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].status, "valid");
  assert.deepEqual(r.leftOut, [{ studentNo: "2022-099", name: "NOBODY, NAMED", rows: 2 }]);
});
await test("the scholar already has another School ID: the error says which one and does not overwrite it", () => {
  const r = B.parsePromoUpload(sheetGrid([R("9999", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2")]), ctx());
  assert.equal(r.rows[0].status, "error"); assert.match(r.rows[0].messages.join(" "), /already has the School ID 2022-001/); assert.deepEqual(r.links, []);
});
await test("one scholar cannot be linked to two Student Nos. in the same file", () => {
  const r = B.parsePromoUpload(sheetGrid([R("N-1", "GARCIA", "ANA", "", "A", "Subj A", "2"), R("N-2", "GARCIA", "ANA", "", "B", "Subj B", "2")]), ctx());
  assert.equal(r.links.length, 1); assert.equal(r.rows[0].status, "warning"); assert.equal(r.rows[1].status, "error");
});
await test("a link is not offered when every row of that student has an error", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-003", "GARCIA", "ANA", "", "A", "Subj A", "99")]), ctx());
  assert.deepEqual(r.links, []);
});

console.log("\nThe period and the state of the period");
await test("a file for another period is rejected as a whole, saying what it says", () => {
  const r = B.parsePromoUpload(sheetGrid([R("2022-001", "x", "y", "", "A", "Subj A", "2")], { year: "SY 2022-2023" }), ctx());
  assert.match(r.fileError, /does not match the period you chose/); assert.match(r.fileError, /2022-2023/);
  const r2 = B.parsePromoUpload(sheetGrid([R("2022-001", "x", "y", "", "A", "Subj A", "2")], { term: "SECOND SEMESTER" }), ctx());
  assert.match(r2.fileError, /does not match the period you chose/);
});
await test("a sheet that does not say its period is rejected with a clear message", () => {
  const grid = sheetGrid([R("2022-001", "x", "y", "", "A", "Subj A", "2")]); grid[1] = []; grid[2] = [];
  assert.match(B.parsePromoUpload(grid, ctx()).fileError, /does not say its school year and semester/);
});
await test("a Closed period and a missing grading scale are refused as before", () => {
  assert.match(B.parsePromoUpload(sheetGrid([R("2022-001", "x", "y", "", "A", "S", "2")]), ctx({ periodStatus: "closed" })).fileError, /Open period/);
  assert.match(B.parsePromoUpload(sheetGrid([R("2022-001", "x", "y", "", "A", "S", "2")]), ctx({ config: null })).fileError, /grading scale/);
});
await test("a sheet with only students and no subjects is rejected as grades, and points to 'School IDs only'; a sheet with no student at all says nothing is filled in", () => {
  assert.match(B.parsePromoUpload(sheetGrid([R("2022-001", "x", "y", "", "", "", "", "", "")]), ctx()).fileError, /choose "School IDs only"/);
  assert.match(B.parsePromoUpload(sheetGrid([]), ctx()).fileError, /Nothing is filled in/);
});

console.log("\nCSV saved from the sheet, and the earlier CSV");
await test("a CSV saved from the Excel sheet is read the same way (parseUploadedGrid chooses the layout)", () => {
  const grid = sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2", "PASSED")]);
  const csv = grid.map(r => r.map(c => `"${c}"`).join(",")).join("\r\n");
  const r = B.parseUploadedGrid(C.parseCsv(csv), ctx());
  assert.equal(r.format, "promo"); assert.equal(r.rows[0].payload.scholarIdNumber, "TEST-0001");
});
await test("the earlier CSV layout still goes the old way", () => {
  const text = "school_year,semester,scholar_id,scholar_name,subject_code,subject_name,units,grade,remarks\r\n2025-2026,1st Semester,TEST-0001,Juan,A,Subj A,3,2,\r\n";
  const r = B.parseUploadedGrid(C.parseCsv(text), ctx());
  assert.equal(r.format, "csv"); assert.equal(r.rows[0].status, "valid"); assert.equal(r.rows[0].rowNumber, 2); assert.equal(r.rows[0].payload.remarks, "");
});

console.log("\nThe error report");
await test("the report starts with the school year and semester, and the corrected file can be uploaded again as it is", () => {
  const first = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "9"), CONT("B", "Subj B", "2")]), ctx());
  const report = B.buildUploadErrorReport(first, PERIOD, []);
  assert.ok(report.startsWith('"SY 2025-2026"\r\n"1ST SEMESTER"\r\n\r\nrow_number,problem,PROGRAM NAME'));
  const again = B.parseUploadedGrid(C.parseCsv(report), ctx());
  assert.equal(again.format, "promo"); assert.equal(again.rows.length, 1); assert.equal(again.rows[0].payload, null);       // the bad grade is still there to be fixed
  assert.equal(again.rows[0].scholarId, "TEST-0001");
});
await test("nothing to report when every row is fine", () => {
  const ok = B.parsePromoUpload(sheetGrid([R("2022-001", "DE LA CRUZ", "JUAN", "", "A", "Subj A", "2")]), ctx());
  assert.equal(B.buildUploadErrorReport(ok, PERIOD, []), null);
});

console.log("\nThe template (built, saved as .xlsx and read back)");
const readBack = async sheet => { const bytes = await X.buildXlsx(sheet); return { bytes, grid: await X.readXlsx(bytes) }; };
await test("the pre-filled template has the school year, semester and school name, one block per scholar with the School ID, and the declared subjects with their grades and remarks", async () => {
  const existing = [
    { id: "1", scholarIdNumber: "TEST-0001", schoolYear: "2025-2026", semester: "1st Semester", subjectCode: "PE 1", subject: "Physical Ed", grade: "1.5", units: 2, excludeFromGwa: false, remarks: "PASSED" },
    { id: "2", scholarIdNumber: "TEST-0001", schoolYear: "2025-2026", semester: "1st Semester", subjectCode: "MATH 1", subject: "Mathematics", grade: "", units: 3, excludeFromGwa: false, remarks: "" },
  ];
  const { grid } = await readBack(P.buildPromoTemplate({ schoolName: "Test College", period: PERIOD, scholars: SCHOLARS, existing, blank: false }));
  assert.equal(grid[0][0], "PROMOTIONAL REPORT / ENROLLMENT LIST"); assert.equal(grid[1][0], "SY 2025-2026"); assert.equal(grid[2][0], "1ST SEMESTER");
  assert.equal(grid[5][1], "Test College");
  assert.equal(grid[4][11], "TOTAL NO. OF STUDENTS: 6");
  assert.deepEqual(grid[11], P.PROMO_COLUMNS.slice());
  const sheet = P.readPromoReport(grid);
  assert.equal(sheet.schoolYear, "2025-2026"); assert.equal(sheet.semester, "1st Semester"); assert.equal(sheet.schoolName, "Test College");
  assert.equal(sheet.entries.length, 2);                                   // only TEST-0001 has subjects; the others are students without a subject yet
  assert.equal(sheet.ignoredBlank, 5);
  assert.deepEqual(sheet.entries.map(e => [e.studentNo, e.last, e.code, e.grade, e.remarks]), [["2022-001", "De La Cruz", "PE 1", "1.5", "PASSED"], ["2022-001", "De La Cruz", "MATH 1", "", ""]]);
  assert.equal(grid.find(r => (r[0] ?? "").startsWith("SUMMARY OF STUDENTS")) !== undefined, true);
});
await test("a pre-filled template uploaded unchanged is all 'No change' (nothing is saved twice)", async () => {
  const existing = [{ id: "1", scholarIdNumber: "TEST-0001", schoolYear: "2025-2026", semester: "1st Semester", subjectCode: "PE 1", subject: "Physical Ed", grade: "1.5", units: 2, excludeFromGwa: false, remarks: "PASSED" }];
  const { grid } = await readBack(P.buildPromoTemplate({ schoolName: "Test College", period: PERIOD, scholars: SCHOLARS, existing, blank: false }));
  const r = B.parseUploadedGrid(grid, ctx({ existing }));
  assert.equal(r.fileError, undefined); assert.deepEqual(r.rows.map(x => x.action), ["unchanged"]); assert.equal(r.ignoredBlank, 5);
});
await test("the blank template has the title block, the headings and empty rows, no scholars", async () => {
  const { grid } = await readBack(P.buildPromoTemplate({ schoolName: "Test College", period: PERIOD, scholars: SCHOLARS, existing: [], blank: true }));
  const sheet = P.readPromoReport(grid);
  assert.equal(sheet.schoolYear, "2025-2026"); assert.equal(sheet.semester, "1st Semester"); assert.equal(sheet.entries.length, 0);
  assert.ok(!JSON.stringify(grid).includes("De La Cruz"));
});
await test("a blank template filled in by hand (a few rows typed under the headings) is read like any other", async () => {
  const { grid } = await readBack(P.buildPromoTemplate({ schoolName: "Test College", period: PERIOD, scholars: SCHOLARS, existing: [], blank: true }));
  grid[12] = R("2022-001", "DE LA CRUZ", "JUAN", "", "PE 1", "Physical Ed", "2");
  grid[13] = CONT("MATH 1", "Mathematics", "1.5");
  const r = B.parseUploadedGrid(grid, ctx());
  assert.deepEqual(r.rows.map(x => x.status), ["valid", "valid"]); assert.equal(r.rows[1].payload.scholarIdNumber, "TEST-0001");
});
await test("text with & < > and quotes survives the round trip; text that looks like a number keeps its zeros", async () => {
  const { grid } = await readBack({ name: "S", rows: [["A & B <c> \"d\"", { value: "00123", style: "box" }, 1.5]], widths: [10] });
  assert.equal(grid[0][0], 'A & B <c> "d"'); assert.equal(grid[0][1], "00123"); assert.equal(grid[0][2], "1.5");
});
await test("a file that is not an Excel file is refused with a plain message", async () => {
  await assert.rejects(() => X.readXlsx(new Uint8Array([1, 2, 3, 4])), /does not look like an Excel/);
});
await test("column letters and cell references", () => {
  assert.equal(X.columnLetters(0), "A"); assert.equal(X.columnLetters(25), "Z"); assert.equal(X.columnLetters(26), "AA"); assert.equal(X.columnLetters(14), "O");
  assert.deepEqual(X.cellRef("O12"), { col: 14, row: 11 }); assert.deepEqual(X.cellRef("AA1"), { col: 26, row: 0 });
});

console.log("\nThe database field and the screens' source");
await test("the School ID column exists in the type and is read from the database", () => {
  assert.ok(src("src/school/types.ts").includes("schoolStudentNo: string") && src("src/school/schoolApi.ts").includes("school_student_no") && src("src/school/schoolApi.ts").includes("school_set_student_no") && src("src/school/schoolApi.ts").includes("school_link_student_nos"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
