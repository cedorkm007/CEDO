// tests/consultation-bulk-records/web_tests.mjs — Bulk Add Daily Records: reading the spreadsheet (columns, every kind of date, the example row), the template file, and the screen (5 checks)
// Run:  node tests/consultation-bulk-records/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-"));
const bundle = async (entry, out) => { const f = path.join(tmp, out); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } }); return import(pathToFileURL(f).href); };
const B = await bundle("src/lib/bulkDailyRecords.ts", "b.mjs");
const X = await bundle("src/lib/xlsxLite.ts", "x.mjs");

check("1 every way of writing a date is turned into YYYY-MM-DD: 2026-09-15, 2026/9/5, 09/15/2026, 15/9/2026 (a number over 12 first is the day), 9/5/26, 'September 15, 2026', '15 Sep 2026', Excel's own number 46280; what cannot be read gives nothing",
  B.parseFlexibleDate("2026-09-15") === "2026-09-15" && B.parseFlexibleDate("2026/9/5") === "2026-09-05" && B.parseFlexibleDate("09/15/2026") === "2026-09-15" && B.parseFlexibleDate("15/9/2026") === "2026-09-15"
  && B.parseFlexibleDate("9/5/26") === "2026-09-05" && B.parseFlexibleDate("September 15, 2026") === "2026-09-15" && B.parseFlexibleDate("15 Sep 2026") === "2026-09-15" && B.parseFlexibleDate("46280") === "2026-09-15"
  && B.parseFlexibleDate("2026-02-30") === null && B.parseFlexibleDate("13/13/2026") === null && B.parseFlexibleDate("soon") === null && B.parseFlexibleDate("") === null);

const grid = [
  ["", "", ""],
  ["Scholar ID Number", "Date Visited", "Status", "Visit Type", "Failed Subject(s)", "Findings", "Staff Recommendations"],
  ["EXAMPLE (delete this row)", "2026-09-15", "Regular", "Office", "Calculus 2", "x", "y"],
  ["2409-01020", "09/15/2026", "regular", "home visit", "Calc", "Struggling", "Check in"],
  ["", "", "", "", "", "", ""],
  ["2409-01021", "not a date", "", "", "", "", ""],
  ["2409-01022", "46280", "", "", "", "", ""],
];
const p = B.parseDailyRecordGrid(grid);
check("2 the file is read from its column names (in any order and spelling such as 'Failed Subjects'), the example row and the empty rows are left out, the row numbers are those of the spreadsheet, and an unreadable date is marked on its row",
  !p.headerError && p.rows.length === 3 && p.skippedExample === 1 && p.rows[0].rowNumber === 4 && p.rows[0].input.date === "2026-09-15" && p.rows[0].input.visit_type === "home visit" && p.rows[0].input.failed === "Calc"
  && p.rows[1].rowNumber === 6 && /cannot be read/.test(p.rows[1].problem ?? "") && p.rows[2].input.date === "2026-09-15" && p.rows[2].problem === null
  && B.parseDailyRecordGrid([["Name", "Date Visited"], ["a", "b"]]).headerError?.includes("Scholar ID") && B.parseDailyRecordGrid([["Scholar ID", "Findings"], ["a", "b"]]).headerError?.includes("Date Visited") && B.parseDailyRecordGrid([]).headerError === "The file is empty."
  && B.parseDailyRecordGrid([["ID Number", "Date", "Recommendation"], ["1", "2026-01-02", "r"]]).rows[0].input.recommendations === "r", JSON.stringify(p.rows.map(r => r.rowNumber)));

// the template is a real .xlsx that this app can read back
const tpl = await X.buildXlsx({ name: "Daily Records", rows: [B.BULK_TEMPLATE_HEADERS.map(h => ({ value: h, style: "header" })), [...B.BULK_TEMPLATE_EXAMPLE]], widths: [26, 16, 16, 14, 24, 40, 40] });
const back = await X.readXlsx(tpl);
const fromTemplate = B.parseDailyRecordGrid([...back, ["2409-01020", "2026-09-15", "", "", "", "", ""]]);
check("3 the Excel template can be filled in and read back: its columns are the ones the importer looks for, and its example row is ignored", back[0].join("|") === B.BULK_TEMPLATE_HEADERS.join("|") && fromTemplate.skippedExample === 1 && fromTemplate.rows.length === 1 && fromTemplate.rows[0].input.id === "2409-01020");

const ready = { rowNumber: 2, input: { id: "a", date: "2026-09-15", status: "", visit_type: "", failed: "", findings: "", recommendations: "" }, problem: null };
const res = (o = {}) => ({ i: 1, ok: true, duplicate: false, error: null, scholarId: "a", name: "A B", status: "Regular", visitType: "Office", date: "2026-09-15", ...o });
const results = new Map([[2, res()], [3, res({ duplicate: true })], [4, res({ ok: false, error: "No scholar has the Scholar ID \"x\"." })]]);
const rows3 = [ready, { ...ready, rowNumber: 3 }, { ...ready, rowNumber: 4 }, { ...ready, rowNumber: 5, problem: "The date cannot be read." }];
const sum = B.summarize(rows3, results);
check("4 each row is 'ready', 'already recorded (skipped)' or 'error' from what the database said (or the unreadable date), and the counts add up",
  B.rowState(ready, results.get(2)).state === "ready" && B.rowState(rows3[1], results.get(3)).state === "duplicate" && B.rowState(rows3[2], results.get(4)).state === "error" && B.rowState(rows3[3], undefined).state === "error"
  && sum.ready === 1 && sum.duplicate === 1 && sum.error === 2 && B.rowState(ready, undefined).state === "ready");

const tab = src("src/sead/pages/ScholarCounselingTab.tsx"), modal = src("src/sead/components/BulkDailyRecordsModal.tsx"), api = src("src/sead/scholarCounselingApi.ts");
check("5 the Daily Records tab has a 'Bulk Add Records' button beside 'Add Daily Record'; the window takes an Excel or CSV file, shows a preview checked by the database (nothing saved yet), asks before adding, adds only the good rows 200 at a time with a progress bar, and says how many were added, skipped and refused",
  /Bulk Add Records/.test(tab) && /<BulkDailyRecordsModal onClose=\{\(\) => setShowBulk\(false\)\} onDone=\{load\} \/>/.test(tab) && /\.xlsx\$\//.test(modal) && /parseCsv\(/.test(modal) && /input: x\.input \}\)\), true\)/.test(modal)
  && /window\.confirm\(`Add /.test(modal) && /checkOrAddBulkRecords\(ready\.map/.test(modal) && /could not be added/.test(modal) && /already recorded and skipped/.test(modal) && /Download Excel template/.test(modal)
  && /counseling_bulk_records/.test(api) && /const CHUNK = 200;/.test(api) && /p_dry_run: dryRun/.test(api) && /needs the latest database update/.test(api));
console.log(`\n${passed} passed`);
