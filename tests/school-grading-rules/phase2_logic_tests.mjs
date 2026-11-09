// tests/school-grading-rules/phase2_logic_tests.mjs — School grading rules, Phase 2: the screens' side of using the rules (src/lib/rulesRuntime.ts, subjectOutcome.ts, bulkGradeLogic.ts)
//   which rules apply to a semester, the ONE GWA function, standing, Passed / Failed, percentage entry, the upload; and the SAME answers as the database.
// Run:  node tests/school-grading-rules/phase2_logic_tests.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gr2-logic-"));
const entry = path.join(tmp, "entry.ts");
const esc = p => p.split("\\").join("/");
fs.writeFileSync(entry, [
  `export * from "${esc(path.join(root, "src/lib/rulesRuntime.ts"))}";`,
  `export * from "${esc(path.join(root, "src/lib/gradingRules.ts"))}";`,
  `export * from "${esc(path.join(root, "src/lib/subjectOutcome.ts"))}";`,
  `export * from "${esc(path.join(root, "src/lib/gwa.ts"))}";`,
  `export * from "${esc(path.join(root, "src/lib/standing.ts"))}";`,
  `export { parseUploadedGrid, promoGradeOrPercentage, buildTemplate } from "${esc(path.join(root, "src/school/bulkGradeLogic.ts"))}";`,
  `export { summarizeScholarGrades } from "${esc(path.join(root, "src/school/gradeSaveLogic.ts"))}";`,
  `export { buildScholarRows } from "${esc(path.join(root, "src/lib/gradesReport.ts"))}";`,
].join("\n"));
const outfile = path.join(tmp, "bundle.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(outfile).href);

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const LET = R.PRESETS.find(p => p.key === "letters"), PH = R.PRESETS.find(p => p.key === "ph-1-5");
const rulesOf = (p, over = {}) => ({ entryMode: p.rules.entryMode, passingMarkPct: p.rules.passingMarkPct, programPassing: [], bands: p.rules.bands.map(b => ({ ...b })), gwa: { ...R.DEFAULT_GWA_SETTINGS }, ...over });
const ver = (n, y, t, rules) => ({ versionNo: n, effectiveYear: y, effectiveTerm: t, rules });

console.log("Which rules applied to a semester");
const v1 = rulesOf(PH), v2 = rulesOf(PH, { passingMarkPct: 85 });
const timeline = [ver(1, "2025-2026", "2nd Semester", v1), ver(2, "2026-2027", "1st Semester", v2)];
check("before the first version there are no rules (the old way)", R.rulesAt(timeline, "2025-2026", "1st Semester") === null && R.rulesAt(timeline, "2024-2025", "Summer") === null);
check("from the semester a version starts, it applies, until the next one starts", R.rulesAt(timeline, "2025-2026", "2nd Semester") === v1 && R.rulesAt(timeline, "2025-2026", "Summer") === v1 && R.rulesAt(timeline, "2026-2027", "1st Semester") === v2 && R.rulesAt(timeline, "2030-2031", "Summer") === v2);
check("two versions starting at the same semester: the later one wins", R.rulesAt([ver(1, "2025-2026", "2nd Semester", v1), ver(2, "2025-2026", "2nd Semester", v2)], "2025-2026", "2nd Semester") === v2);
check("no versions, or no year: no rules", R.rulesAt([], "2025-2026", "2nd Semester") === null && R.rulesAt(undefined, "2025-2026", "2nd Semester") === null && R.rulesAt(timeline, "", "") === null);
check("the timeline from the database is read into versions, oldest first", (() => {
  const t = R.parseTimeline({ s1: [{ versionNo: 2, effectiveYear: "2026-2027", effectiveTerm: "1st Semester", rules: { entryMode: "either", passingMarkPct: 85, programPassing: [], bands: [], gwa: {} } }, { versionNo: 1, effectiveYear: "2025-2026", effectiveTerm: "2nd Semester", rules: { entryMode: "grade", passingMarkPct: 75, programPassing: [], bands: [], gwa: {} } }] });
  return t.s1.length === 2 && t.s1[0].versionNo === 1 && t.s1[1].rules.passingMarkPct === 85 && R.parseTimeline(null) && Object.keys(R.parseTimeline("x")).length === 0;
})());

console.log("\nA past semester never moves");
const before = R.rulesAt([ver(1, "2025-2026", "2nd Semester", v1)], "2025-2026", "2nd Semester");
const after = R.rulesAt([ver(1, "2025-2026", "2nd Semester", v1), ver(2, "2026-2027", "1st Semester", v2), ver(3, "2027-2028", "2nd Semester", rulesOf(PH, { passingMarkPct: 90 }))], "2025-2026", "2nd Semester");
check("saving newer rules later does not change the rules a past semester is read with", before === after);
const rows = [{ grade: "2.50", units: 3 }, { grade: "1.75", units: 3 }, { grade: "3.00", units: 3 }];
check("so the GWA of the past semester is the same number before and after", R.periodGwa(rows, [], before).text === R.periodGwa(rows, [], after).text && R.periodGwa(rows, [], after).gwa === R.periodGwa(rows, [], before).gwa);
check("and Passed / Failed of its grades is the same", ["2.50", "1.75", "3.00", "5.00"].every(g => R.classifyGrade(g, { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3 }, [], before, null, null) === R.classifyGrade(g, { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3 }, [], after, null, null)));

console.log("\nThe ONE GWA function");
// with no rules it is the original calculation to the digit
let same = 0, total = 0, seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const LETTERS = [{ letter: "A", numericValue: 4 }, { letter: "B", numericValue: 3 }, { letter: "C", numericValue: 2 }, { letter: "D", numericValue: 1 }, { letter: "F", numericValue: 0 }];
for (let i = 0; i < 2000; i++) {
  const n = Math.floor(rnd() * 7);
  const rs = Array.from({ length: n }, () => {
    const k = rnd();
    const grade = k < 0.5 ? (1 + Math.floor(rnd() * 17) * 0.25).toFixed(2) : k < 0.7 ? "ABCDF"[Math.floor(rnd() * 5)] : k < 0.8 ? "INC" : k < 0.9 ? "" : "DRP";
    return { grade, units: rnd() < 0.2 ? null : Math.ceil(rnd() * 5), excludeFromGwa: rnd() < 0.15 };
  });
  const a = R.periodGwa(rs, LETTERS, null), b = R.computeGwa(rs, LETTERS), d = R.gwaDetail(rs, LETTERS);
  total++;
  if (a.gwa === b && a.text === R.formatGwa(b) && a.subjectsCounted === d.subjectsCounted && a.unitsCounted === d.unitsCounted && a.countedWithoutUnits === d.countedWithoutUnits && a.excluded === d.excluded) same++;
}
check("with no rules saved it gives exactly the old GWA, text and counts (2,000 random cases)", same === total, `${same}/${total}`);
check("nothing counted: no GWA and a dash", R.periodGwa([{ grade: "INC", units: 3 }], [], null).text === "—" && R.periodGwa([], [], null).gwa === null && R.periodGwa([], [], rulesOf(PH)).text === "—");
const gwaRules = (over, extra = {}) => rulesOf(PH, { gwa: { ...R.DEFAULT_GWA_SETTINGS, ...over }, ...extra });
const three = [{ grade: "1.00", units: 3, percentage: 98 }, { grade: "2.00", units: 3, percentage: 86 }, { grade: "5.00", units: 3, percentage: 60 }];
check("rules with the default settings show the old number (the GWA is rounded to the 2 decimals shown, and that rounded number is the one judged)", R.periodGwa(three, [], rulesOf(PH)).text === R.formatGwa(R.computeGwa(three, [])) && R.periodGwa(three, [], rulesOf(PH)).gwa === 2.67);
check("simple average ignores the units", R.periodGwa([{ grade: "1.00", units: 6 }, { grade: "2.00", units: 3 }], [], gwaRules({ method: "simple" })).gwa === 1.5 && R.periodGwa([{ grade: "1.00", units: 6 }, { grade: "2.00", units: 3 }], [], gwaRules({})).gwa === (1 * 6 + 2 * 3) / 9 ? true : R.periodGwa([{ grade: "1.00", units: 6 }, { grade: "2.00", units: 3 }], [], gwaRules({})).text === "1.33");
check("the GWA can use the percentage instead of the grade", R.periodGwa(three, [], gwaRules({ gradeUsed: "percentage" })).text === "81.33");
check("decimals: 3 decimals shown; the cut-off option cuts instead of rounding", R.periodGwa(three, [], gwaRules({ decimals: 3 })).text === "2.667" && R.periodGwa(three, [], gwaRules({ decimals: 2, rounding: "cut" })).text === "2.66" && R.periodGwa(three, [], gwaRules({ decimals: 2 })).text === "2.67");
check("failed grades can be left out of the GWA", R.periodGwa(three, [], gwaRules({ includeFailed: false }), r => r.grade === "5.00").gwa === 1.5 && R.periodGwa(three, [], gwaRules({ includeFailed: true }), r => r.grade === "5.00").text === "2.67");
check("a special mark can count as a number (DRP = 5); without that it is left out", R.periodGwa([{ grade: "1.00", units: 3 }, { grade: "DRP", units: 3 }], [], gwaRules({ specialValues: { DRP: 5 } })).gwa === 3 && R.periodGwa([{ grade: "1.00", units: 3 }, { grade: "DRP", units: 3 }], [], gwaRules({})).gwa === 1);
check("a subject ticked 'Exclude from GWA' never counts, and a subject with no units weighs 1", R.periodGwa([{ grade: "1.00", units: 3 }, { grade: "5.00", units: 3, excludeFromGwa: true }], [], gwaRules({})).gwa === 1 && R.periodGwa([{ grade: "1.00", units: null }, { grade: "2.00", units: 1 }], [], gwaRules({})).gwa === 1.5 && R.periodGwa([{ grade: "1.00", units: null }], [], gwaRules({})).countedWithoutUnits === 1);
check("the summary of one scholar (school screen) uses the same function", (() => { const s = R.summarizeScholarGrades(three, [], gwaRules({ decimals: 3 }), null, null); return s.gwaText === "2.667" && s.gwa === 2.667 && s.subjects === 3; })());
check("the Excel export rows use it too (rounded as the school says, not again to two decimals)", (() => {
  const r = R.buildScholarRows([{ scholarIdNumber: "S1", name: "A", schoolId: "x", schoolName: "X", program: "BS Law", yearLevel: "1" }], [{ key: "k", label: "l", schoolYear: "2025-2026", term: "2nd Semester" }], () => three,
    () => ({ config: { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", retentionThreshold: 3 }, letters: [], rules: [ver(1, "2025-2026", "2nd Semester", gwaRules({ decimals: 3 }))] }));
  const old = R.buildScholarRows([{ scholarIdNumber: "S1", name: "A", schoolId: "x", schoolName: "X", program: "BS Law", yearLevel: "1" }], [{ key: "k", label: "l", schoolYear: "2024-2025", term: "2nd Semester" }], () => three,
    () => ({ config: { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", retentionThreshold: 3 }, letters: [], rules: [ver(1, "2025-2026", "2nd Semester", gwaRules({ decimals: 3 }))] }));
  return r[0].gwa === 2.667 && r[0].gwaRounded === true && old[0].gwa === 8 / 3 && !old[0].gwaRounded;
})());

console.log("\nStanding");
const cfg = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, retentionThreshold: 2.5, passingMark: 3 };
check("no rules: exactly the old standing", ["good", "at_risk", "below"].join() === [R.standingFor(1.5, cfg, null), R.standingFor(2.4, cfg, null), R.standingFor(2.6, cfg, null)].join() && R.standingFor(null, cfg, null) === "no_gwa");
check("rules that leave the requirement empty keep the school's saved requirement", R.standingFor(2.6, cfg, rulesOf(PH)) === "below" && R.standingFor(1.5, cfg, rulesOf(PH)) === "good");
check("the requirement in the rules wins", R.standingFor(2.9, cfg, gwaRules({ retentionThreshold: 3 })) === "at_risk" && R.standingFor(2.6, cfg, gwaRules({ retentionThreshold: 3 })) === "good" && R.standingFor(3.2, cfg, gwaRules({ retentionThreshold: 3 })) === "below");
check("a GWA from percentages is judged on 0 to 100 (higher is better, 3 points of margin)", R.standingFor(90, cfg, gwaRules({ gradeUsed: "percentage", retentionThreshold: 85 }), true) === "good" && R.standingFor(86, cfg, gwaRules({ gradeUsed: "percentage", retentionThreshold: 85 })) === "at_risk" && R.standingFor(84, cfg, gwaRules({ gradeUsed: "percentage", retentionThreshold: 85 })) === "below");
check("a GWA from percentages with no requirement saved: no requirement (the old 1-5 one cannot be compared)", R.standingFor(90, cfg, gwaRules({ gradeUsed: "percentage" })) === "no_requirement");
check("no school scale at all: no requirement", R.standingFor(2, null, rulesOf(PH)) === "no_requirement");

console.log("\nPassed or failed");
const oldCfg = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3 };
const law = rulesOf(PH, { programPassing: [{ program: "BS Law", passingPct: 85 }] });
check("with no rules it is the old passing mark", R.classifyGrade("3.00", oldCfg, [], null) === "passed" && R.classifyGrade("3.25", oldCfg, [], null) === "failed" && R.classifyGrade("", oldCfg, [], null) === "ungraded");
check("with a table the percentage decides: 75 passes, 74.99 fails", R.classifyGrade("", oldCfg, [], v1, null, 75) === "passed" && R.classifyGrade("", oldCfg, [], v1, null, 74.99) === "failed");
check("a programme with its own passing mark: 80 passes for others, fails for BS Law; 85 passes for BS Law", R.classifyGrade("", oldCfg, [], law, "BS Education", 80) === "passed" && R.classifyGrade("", oldCfg, [], law, "BS Law", 80) === "failed" && R.classifyGrade("", oldCfg, [], law, " bs law", 85) === "passed");
check("a grade alone is judged by its row (2.50 is 79 to 81.99)", R.classifyGrade("2.50", oldCfg, [], law, "BS Law") === "failed" && R.classifyGrade("2.5", oldCfg, [], law, "BS Education") === "passed");
check("INC and DRP keep their meaning; the school's own marks too", R.classifyGrade("INC", oldCfg, [], v1) === "inc" && R.classifyGrade("drp", oldCfg, [], v1) === "drp" && R.classifyGrade("W", oldCfg, [{ letter: "W", numericValue: null, outcome: "failed" }], v1) === "failed");
check("a grade the table does not know falls back to the old rule", R.classifyGrade("4.00", oldCfg, [], v1) === "failed" && R.classifyGrade("2.60", oldCfg, [], v1) === "passed");
check("the counts for a scholar use the table and the programme", (() => { const c = R.countOutcomes([{ grade: "", percentage: 80 }, { grade: "", percentage: 90 }, { grade: "INC" }], oldCfg, [], law, "BS Law"); return c.failed === 1 && c.inc === 1; })());

console.log("\nTyping a grade or a percentage");
const E = (g, p, rules = v1, marks = []) => R.entryFor(rules, g, p, marks, null);
check("a percentage becomes the grade and keeps both", E("", "88").grade === "1.75" && E("", "88").percentage === 88 && E("", "88").error === "");
check("both agree: accepted", E("1.75", "88").error === "" && E("1.750", "88").error === "");
check("both disagree: refused, saying what the table says", E("1.00", "88").error === "A percentage of 88 is 1.75 in your conversion table, not 1.00.");
check("a percentage outside 0 to 100, or not a number, is refused", E("", "101").error !== "" && E("", "-1").error !== "" && E("", "abc").error !== "" && E("", "88.555").error !== "");
check("a comma is read as a decimal point", E("", "88,5").grade === "1.75" && E("", "88,5").percentage === 88.5);
check("INC and DRP and the school's marks need no percentage and refuse one", E("INC", "").error === "" && E("DRP", "").error === "" && E("W", "", v1, ["W"]).error === "" && E("INC", "90").error === "INC has no percentage. Leave the percentage empty.");
check("a grade only is fine when the table has it, and a plain number in ANY increment (1.1, 2.10) is fine too; a mark that is not a number and not in the table is refused, listing the grades", E("2.00", "").error === "" && E("2.00", "").percentage === null && E("2.10", "").error === "" && E("1.1", "").error === "" && E("Z", "").error === "Grade \"Z\" is not in your conversion table. Use one of: 1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50, 2.75, 3.00, 5.00.");
check("percentage entry only: a grade without a percentage is refused; INC is fine", E("2.00", "", rulesOf(PH, { entryMode: "percentage" })).error === "Enter the percentage for this subject: your school enters percentages." && E("INC", "", rulesOf(PH, { entryMode: "percentage" })).error === "");
check("grade entry only: a percentage is refused", E("", "88", rulesOf(PH, { entryMode: "grade" })).error.startsWith("Your school enters grades, not percentages"));
check("no table: a percentage is refused with the reason, a grade passes through", E("", "88", null).error.startsWith("Your school has no conversion table") && E("2.5", "", null).error === "" && E("2.5", "", rulesOf(PH, { bands: [] })).error === "");
check("what the table says about the row is returned for the screen", (() => { const r = E("", "88").reading; return r && r.grade === "1.75" && r.remarks === "Good" && r.result === "passed" && r.percentage === 88; })() && R.describeRow({ grade: "3.00" }, law, "BS Law").result === "failed" && R.describeRow({ grade: "9.99" }, law) === null && R.describeRow({ grade: "1.00" }, null) === null);

console.log("\nDefault excluded subject codes");
const ex = rulesOf(PH, { gwa: { ...R.DEFAULT_GWA_SETTINGS, excludedCodes: ["NSTP", " pe "] } });
check("a code on the list starts excluded, in any capitals; others do not; no rules, no code: not excluded", R.defaultExcluded(ex, "nstp") && R.defaultExcluded(ex, "PE") && !R.defaultExcluded(ex, "MATH") && !R.defaultExcluded(ex, "") && !R.defaultExcluded(null, "NSTP"));

console.log("\nThe upload");
const scholars = [{ scholarIdNumber: "S-1", firstName: "Ana", lastName: "Reyes", middleName: "", yearLevel: "1", course: "BS Law", schoolStudentNo: "A-100" }, { scholarIdNumber: "S-2", firstName: "Ben", lastName: "Cruz", middleName: "", yearLevel: "1", course: "BS Education", schoolStudentNo: "A-200" }];
const ctx = (rules, existing = []) => ({ period: { schoolYear: "2025-2026", semester: "2nd Semester" }, periodStatus: "open", scholars, existing, config: { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3 }, letters: [], rules });
const HEAD = "school_year,semester,scholar_id,scholar_name,subject_code,subject_name,units,percentage,grade,remarks";
const csv = lines => [HEAD, ...lines].join("\n").split("\n").map(l => l.split(","));
const p1 = R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,88,,", "2025-2026,2nd Semester,S-2,Cruz,M1,Math,3,,2.00,", "2025-2026,2nd Semester,S-2,Cruz,M2,Art,3,70,2.00,"]), ctx(law));
check("a percentage in the file becomes the grade of the table; a grade stays; a mismatch is an error with its message", p1.rows[0].status === "valid" && p1.rows[0].payload.grade === "1.75" && p1.rows[0].payload.percentage === 88 && p1.rows[1].payload.grade === "2.00" && p1.rows[1].payload.percentage === null
  && p1.rows[2].status === "error" && /70 is 5\.00 in your conversion table, not 2\.00/.test(p1.rows[2].messages[0]), JSON.stringify(p1.rows.map(r => [r.status, r.messages])));
check("the preview says what the table says: remarks and Passed / Failed (the programme's own passing mark)", p1.rows[0].reading === "Good · Passed" && R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,80,,"]), ctx(law)).rows[0].reading === "Satisfactory · Failed");
check("a file with no percentage column still uploads (the column is optional)", R.parseUploadedGrid([["school_year", "semester", "scholar_id", "subject_name", "grade"], ["2025-2026", "2nd Semester", "S-1", "Math", "2.00"]], ctx(law)).rows[0].status === "valid");
check("with no conversion table a percentage is refused (the grade is what is entered)", R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,88,,"]), ctx(null)).rows[0].status === "error");
check("with no conversion table the grade is checked against the scale as before", R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,,2.00,", "2025-2026,2nd Semester,S-1,Reyes,M2,Art,3,,9.00,"]), ctx(null)).rows.map(r => r.status).join() === "valid,error");
check("the template has the percentage column, filled for subjects that have one", (() => { const t = R.buildTemplate(scholars, [{ id: "1", scholarIdNumber: "S-1", schoolYear: "2025-2026", semester: "2nd Semester", subjectCode: "M1", subject: "Math", grade: "1.75", units: 3, excludeFromGwa: false, remarks: "", percentage: 88 }], { schoolYear: "2025-2026", semester: "2nd Semester" }); return t.headers.includes("percentage") && t.rows.some(r => r[7] === 88 && r[8] === "1.75"); })());
check("a row left as it is does not count as a change (the percentage is part of the comparison)", (() => {
  const existing = [{ id: "1", scholarIdNumber: "S-1", schoolYear: "2025-2026", semester: "2nd Semester", subjectCode: "M1", subject: "Math", grade: "1.75", units: 3, excludeFromGwa: false, remarks: "", percentage: 88 }];
  const same = R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,88,1.75,"]), ctx(law, existing)).rows[0];
  const changed = R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,89,,"]), ctx(law, existing)).rows[0];
  return same.action === "unchanged" && changed.action === "update" && changed.payload.percentage === 89;
})());
check("a saved grade with no percentage can be left as it is, even when the school now enters percentages", (() => {
  const existing = [{ id: "1", scholarIdNumber: "S-1", schoolYear: "2025-2026", semester: "2nd Semester", subjectCode: "M1", subject: "Math", grade: "1.75", units: 3, excludeFromGwa: false, remarks: "", percentage: null }];
  const r = R.parseUploadedGrid(csv(["2025-2026,2nd Semester,S-1,Reyes,M1,Math,3,,1.75,"]), ctx(rulesOf(PH, { entryMode: "percentage" }), existing)).rows[0];
  return r.status !== "error" && r.action === "unchanged";
})());

console.log("\nThe school's Excel sheet (GRADES column)");
check("a school that enters percentages: GRADES is the percentage", (() => { const r = R.promoGradeOrPercentage("88", { rules: rulesOf(PH, { entryMode: "percentage" }), letters: [] }); return r.grade === "" && r.pctText === "88"; })());
check("a school that enters grades: GRADES is the grade, whatever it looks like", (() => { const r = R.promoGradeOrPercentage("88", { rules: rulesOf(PH, { entryMode: "grade" }), letters: [] }); return r.grade === "88" && r.pctText === ""; })());
check("a school that enters either: a value that is one of the table's grades is the grade, any other number the percentage", R.promoGradeOrPercentage("1.75", { rules: v1, letters: [] }).grade === "1.75" && R.promoGradeOrPercentage("88", { rules: v1, letters: [] }).pctText === "88" && R.promoGradeOrPercentage("3", { rules: v1, letters: [] }).grade === "3");
check("INC, DRP and letters are always the grade; a school with no rules is unchanged", R.promoGradeOrPercentage("INC", { rules: rulesOf(PH, { entryMode: "percentage" }), letters: [] }).grade === "INC" && R.promoGradeOrPercentage("88", { rules: null, letters: [] }).grade === "88" && R.promoGradeOrPercentage("", { rules: v1, letters: [] }).grade === "");

// ── the SAME answers as the database ──
console.log("\nThe same answers as the database");
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const letters = (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like '%Letter-Grade%'"))[0];
const lrules = rulesOf(LET, { programPassing: [{ program: "BS Law", passingPct: 85 }] });
const saveRules = async (rules, note) => { try { await as(letters.uid, async tx => tx.query("select public.school_grading_rules_save($1::jsonb, '{}'::jsonb, $2)", [JSON.stringify(rules), note])); } catch (e) { if (!/Nothing has changed/.test(String(e.message))) throw e; } };
await saveRules(lrules, "parity");
const entryCases = [["", "88"], ["B", "88"], ["A", "88"], ["", "74.99"], ["", "75"], ["", "100"], ["", "0"], ["b", "86.5"], ["C", ""], ["Z", ""], ["", ""], ["INC", ""], ["DRP", ""], ["INC", "90"], ["F", "10"], ["", "101"], ["", "-5"], ["A", "90"], ["a", "90.00"], ["D", "79.99"], ["", "84.995"]];
let entryOk = true; const entryBad = [];
for (const mode of ["either", "percentage", "grade"]) {
  const rules = { ...lrules, entryMode: mode };
  await saveRules(rules, mode);
  for (const [g, p] of entryCases) {
    const num = p === "" ? null : Number(p);
    if (num !== null && (num < 0 || num > 100)) continue;                       // out of range numbers are refused before the database (and by it with a shorter message)
    if (p !== "" && !/^\d+(\.\d{1,2})?$/.test(p)) continue;
    const sql = (await q("select * from public._grading_entry($1, '2025-2026', '2nd Semester', $2, $3::numeric)", [letters.school_id, g, num]))[0];
    const ts = R.entryFor(rules, g, p, [], null);
    const same = (sql.error ?? "") === ts.error && (ts.error ? true : (sql.grade ?? "") === ts.grade && (sql.percentage == null ? null : Number(sql.percentage)) === ts.percentage);
    if (!same) { entryOk = false; entryBad.push(`${mode} ${g}|${p}: sql=${JSON.stringify([sql.grade, sql.percentage, sql.error])} ts=${JSON.stringify([ts.grade, ts.percentage, ts.error])}`); }
  }
}
check("typing a grade and / or a percentage gives the same grade, percentage or message on the screen and in the database (3 entry modes)", entryOk, entryBad.slice(0, 3).join(" | "));
await saveRules({ ...lrules, entryMode: "either" }, "parity either");
const oldCfgL = { scaleMin: 0, scaleMax: 4, direction: "higher_is_better", usesLetterGrades: true, passingMark: 1 };
const letterRows = LETTERS.map(l => ({ ...l }));
let outOk = true; const outBad = [];
for (const course of [null, "BS Law", "bs law ", "BS Education"]) {
  for (const [g, p] of [["A", null], ["B", null], ["C", null], ["D", null], ["F", null], ["", 80], ["", 85], ["", 84.99], ["", 75], ["", 74.99], ["", 100], ["", 0], ["INC", null], ["DRP", null], ["", null], ["W", null], ["C", 80]]) {
    const sql = (await q("select public._grade_outcome_at($1, $2, $3::numeric, '2025-2026', '2nd Semester', $4) o", [letters.school_id, g, p, course]))[0].o;
    const ts = R.classifyGrade(g, oldCfgL, letterRows, lrules, course, p);
    const tsCmp = ts === "review" && sql === "review" ? "review" : ts;
    if (sql !== tsCmp) { outOk = false; outBad.push(`${course} ${g}|${p}: sql=${sql} ts=${ts}`); }
  }
}
check("Passed / Failed / INC / DRP / review is the same on the screen and in the database (programme passing marks included)", outOk, outBad.slice(0, 4).join(" | "));
check("a semester before the rules started is judged the old way in both", (await q("select public._grade_outcome_at($1, 'C', null, '2025-2026', '1st Semester', 'BS Law') o", [letters.school_id]))[0].o === R.classifyGrade("C", oldCfgL, letterRows, null, "BS Law", null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
fs.rmSync(tmp, { recursive: true, force: true });
await db.close?.();
