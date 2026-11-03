// tests/school-renewal-tab/logic_tests.mjs — School Portal: the Renewal tab's rules (groups, progress bar, filters, words) and the screen's source
// Run:  node tests/school-renewal-tab/logic_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "srt-"));
const outfile = path.join(tmp, "logic.mjs");
await build({ entryPoints: [path.join(root, "src/school/renewalMonitorLogic.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const L = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const row = (over = {}) => ({ scholarIdNumber: "TEST-0001", schoolStudentNo: "", lastName: "Dela Cruz", firstName: "Juan", middleName: "Santos", yearLevel: "2nd Year", program: "BS Test", scholarStatus: "Regular", stage: null, isLate: false,
  group: "not_applied", probation: false, gradesState: "ready", failed: 0, inc: 0, review: 0, ...over });
const summary = (over = {}) => ({ total: 10, applied: 3, renewed: 4, removed: 1, notApplied: 2, notRequired: 0, probation: 2, withIncOrFailed: 3, basisSchoolYear: "2025-2026", basisTerm: "2nd Semester", ...over });

console.log("The progress bar");
test("done = renewed + removed + not required; the percent is of all the school's scholars", () => {
  const p = L.renewalProgress(summary({ notRequired: 1, notApplied: 1 }));
  assert.equal(p.processed, 6); assert.equal(p.total, 10); assert.equal(p.percent, 60);
});
test("the four parts of the bar add up to the whole (renewed + not required, removed, applied, not applied)", () => {
  const p = L.renewalProgress(summary({ notRequired: 1, notApplied: 1 }));
  assert.deepEqual(p.segments.map(s => s.key), ["renewed", "removed", "applied", "not_applied"]);
  assert.equal(p.segments.reduce((n, s) => n + s.count, 0), 10); assert.ok(Math.abs(p.segments.reduce((n, s) => n + s.percent, 0) - 100) < 0.001);
});
test("a school with no scholars in the renewal gets 0%, not a division by zero", () => {
  const p = L.renewalProgress(summary({ total: 0, applied: 0, renewed: 0, removed: 0, notApplied: 0, probation: 0, withIncOrFailed: 0 }));
  assert.equal(p.percent, 0); assert.ok(p.segments.every(s => s.percent === 0));
});

console.log("\nThe buttons and their numbers");
test("each button shows the number the summary has; probation counts across the groups", () => {
  const s = summary();
  assert.deepEqual(["all", "in_process", "renewed", "probation", "removed", "not_applied", "not_required"].map(k => L.countFor(s, k)), [10, 3, 4, 2, 1, 2, 0]);
  assert.deepEqual(L.FILTER_BUTTONS.map(b => b.label), ["All", "Applied", "Renewed", "Probation", "Removed", "Not applied yet", "Not required"]);
});

console.log("\nThe words");
test("the grade result in words: all passed, failed, INC, both, not in yet, needs review", () => {
  assert.equal(L.gradesText(row()), "All passed");
  assert.equal(L.gradesText(row({ failed: 1 })), "1 failed");
  assert.equal(L.gradesText(row({ inc: 1 })), "INC");
  assert.equal(L.gradesText(row({ inc: 2 })), "2 INC");
  assert.equal(L.gradesText(row({ failed: 2, inc: 1 })), "2 failed + INC");
  assert.equal(L.gradesText(row({ gradesState: "waiting" })), "Grades not in yet");
  assert.equal(L.gradesText(row({ gradesState: null })), "Not checked yet");
  assert.equal(L.gradesText(row({ review: 1 })), "Needs review");
});
test("the name is 'Last, First M.'", () => {
  assert.equal(L.fullName(row()), "Dela Cruz, Juan S."); assert.equal(L.fullName(row({ middleName: "" })), "Dela Cruz, Juan");
});
test("a clearance is needed for an INC or a failed grade, not for a removed scholar", () => {
  assert.equal(L.needsClearance(row({ failed: 1 })), true); assert.equal(L.needsClearance(row({ inc: 1 })), true);
  assert.equal(L.needsClearance(row()), false); assert.equal(L.needsClearance(row({ failed: 1, group: "removed" })), false);
});

console.log("\nThe filters");
const people = [
  row({ scholarIdNumber: "A-1", lastName: "Santos", firstName: "Maria", schoolStudentNo: "2022-001", yearLevel: "1st Year", program: "BSED", group: "renewed" }),
  row({ scholarIdNumber: "A-2", lastName: "Reyes", firstName: "Ana", yearLevel: "2nd Year", program: "BSED", group: "in_process", probation: true }),
  row({ scholarIdNumber: "A-3", lastName: "Tan", firstName: "Lia", yearLevel: "3rd Year", program: "BSCrim", group: "removed" }),
  row({ scholarIdNumber: "A-4", lastName: "Cruz", firstName: "José", yearLevel: "2nd Year", program: "BSCrim", group: "not_applied" }),
];
const ids = f => L.filterRows(people, { ...L.EMPTY_FILTERS, ...f }).map(r => r.scholarIdNumber).join();
test("by group, and probation across the groups", () => {
  assert.equal(ids({}), "A-1,A-2,A-3,A-4"); assert.equal(ids({ filter: "renewed" }), "A-1"); assert.equal(ids({ filter: "removed" }), "A-3"); assert.equal(ids({ filter: "probation" }), "A-2");
});
test("by year level and by program, together with the group", () => {
  assert.equal(ids({ yearLevel: "2nd Year" }), "A-2,A-4"); assert.equal(ids({ program: "BSCrim" }), "A-3,A-4"); assert.equal(ids({ program: "BSCrim", yearLevel: "2nd Year" }), "A-4");
  assert.equal(ids({ program: "BSED", filter: "in_process" }), "A-2");
});
test("by name in any order, by Scholar ID or by School ID, without capitals or accents", () => {
  assert.equal(ids({ query: "maria santos" }), "A-1"); assert.equal(ids({ query: "SANTOS, maria" }), "A-1"); assert.equal(ids({ query: "a-3" }), "A-3"); assert.equal(ids({ query: "2022-001" }), "A-1"); assert.equal(ids({ query: "jose" }), "A-4");
  assert.equal(ids({ query: "nobody" }), "");
});
test("the year levels come in order and the programs alphabetically, without repeats", () => {
  assert.deepEqual(L.yearLevelOptions([...people, row({ yearLevel: "10th Year" }), row({ yearLevel: "" })]), ["1st Year", "2nd Year", "3rd Year", "10th Year"]);
  assert.deepEqual(L.programOptions(people), ["BSCrim", "BSED"]);
});
test("pages of 25", () => {
  const many = Array.from({ length: 60 }, (_, i) => i);
  assert.equal(L.pageCount(60), 3); assert.equal(L.pageCount(0), 1); assert.equal(L.pageOf(many, 3).length, 10); assert.equal(L.pageOf(many, 1)[0], 0); assert.equal(L.pageOf(many, 2)[0], 25);
});

console.log("\nThe screen");
const panel = src("src/school/components/RenewalMonitorPanel.tsx"), page = src("src/school/pages/SchoolPortalPage.tsx"), api = src("src/school/renewalMonitorApi.ts");
test("a Renewal tab sits between Scholars and Corrections", () => {
  const labels = [...page.matchAll(/\{ key: "([\w-]+)", label: ([^,]+),/g)].map(m => m[1]);
  assert.deepEqual(labels.slice(0, 3), ["scholars", "renewal", "corrections"]); assert.ok(page.includes('{panel === "renewal" && <RenewalMonitorPanel />}'));
});
test("the list has the columns Scholar ID, School ID, Name, Year, Program, Scholarship, Renewal, Grades", () => {
  const cols = [...panel.matchAll(/<th scope="col" className=\{TH\}>([^<]+)<\/th>/g)].map(m => m[1]);
  assert.deepEqual(cols, ["Scholar ID", "School ID", "Name", "Year", "Program", "Scholarship", "Renewal", "Grades"]);
});
test("the filters are the name / ID search, the year level and the program, and the buttons for the groups", () => {
  assert.ok(panel.includes('aria-label="Search scholars by name or ID"') && panel.includes('aria-label="Year level"') && panel.includes('aria-label="Program"') && panel.includes('aria-label="Show scholars by renewal status"'));
});
test("the progress bar is a real progressbar with words, numbers and a legend (not colour alone)", () => {
  assert.ok(panel.includes('role="progressbar"') && panel.includes("scholars are done with the renewal") && panel.includes("progress.segments.map"));
});
test("the school can only read: only the three read functions are called, nothing is written", () => {
  assert.deepEqual([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]).sort(), ["school_renewal_list", "school_renewal_summary", "school_renewal_windows"]);
  assert.equal(/\.(insert|update|delete|upsert)\(/.test(api + panel), false);
});
test("before the database update the tab says so instead of failing", () => assert.ok(panel.includes("The Renewal tab needs a database update from CEDO") && api.includes("PGRST202")));
test("readable text: nothing under 13px and no pale grey words in the new screen", () => {
  assert.equal(/text-\[(?:9|10|11|12)(?:\.\d+)?px\]/.test(panel), false); assert.equal(/text-slate-(?:300|400|500)\b/.test(panel), false);
});
test("the file and its undo exist; the file adds read functions only", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase_migration_school_renewal_tab.sql")) && fs.existsSync(path.join(root, "undo_school_renewal_tab.sql")));
  assert.equal(/(alter table|drop table|delete from|truncate|create table|insert into|update public)/i.test(src("supabase_migration_school_renewal_tab.sql").replace(/--.*$/gm, "")), false);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
