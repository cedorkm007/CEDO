// tests/school-grading-rules/phase2_web_tests.mjs — School grading rules, Phase 2: the screens use the rules (grade entry, upload, school / scholar / staff GWA, exports)
// Run:  node tests/school-grading-rules/phase2_web_tests.mjs     (no database or browser needed)
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const modal = src("src/school/components/ScholarGradeEntryModal.tsx"), bulk = src("src/school/bulkGradeLogic.ts"), bulkUi = src("src/school/components/BulkGradeUploadModal.tsx");
const runtime = src("src/lib/rulesRuntime.ts"), outcome = src("src/lib/subjectOutcome.ts"), schoolData = src("src/school/useSchoolData.ts"), save = src("src/school/gradeSaveLogic.ts");

console.log("One GWA function, used everywhere");
const SCREENS = ["src/school/useSchoolData.ts", "src/school/gradeSaveLogic.ts", "src/school/components/ScholarGradeEntryModal.tsx", "src/school/components/ScholarsTable.tsx", "src/scholar/components/dashboard/SubjectsGradesPanel.tsx",
  "src/sead/components/ScholarGradesTable.tsx", "src/sead/scholarsMonitoringData.ts", "src/sead/gradesExport.ts", "src/lib/gradesReport.ts"];
test("no screen or export calls the old GWA calculation directly any more: every one goes through periodGwa()", () => {
  for (const f of SCREENS) assert.equal(/\b(computeGwa|gwaDetail|formatGwa)\(/.test(src(f)), false, `${f} still calls the old calculation`);
  for (const f of ["src/school/gradeSaveLogic.ts", "src/school/components/ScholarGradeEntryModal.tsx", "src/scholar/components/dashboard/SubjectsGradesPanel.tsx", "src/sead/components/ScholarGradesTable.tsx", "src/sead/scholarsMonitoringData.ts", "src/lib/gradesReport.ts"]) assert.ok(src(f).includes("periodGwa("), `${f} does not use periodGwa`);
});
test("the one function lives in rulesRuntime.ts and falls back to the original calculation when the school has no rules", () => {
  assert.ok(runtime.includes("export function periodGwa(") && runtime.includes("gwaDetail(rows, letters)") && runtime.includes("gwaWithSettings("));
});
test("every screen reads the rules of the semester it shows (rulesAt), never 'the latest rules'", () => {
  for (const f of ["src/school/useSchoolData.ts", "src/scholar/components/dashboard/SubjectsGradesPanel.tsx", "src/sead/components/ScholarGradesTable.tsx", "src/sead/scholarsMonitoringData.ts", "src/lib/gradesReport.ts", "src/school/components/BulkGradeUploadModal.tsx"]) assert.ok(src(f).includes("rulesAt("), f);
});
test("the standing uses the retention requirement of the rules (standingFor); the old function is only called inside it", () => {
  for (const f of ["src/school/useSchoolData.ts", "src/sead/scholarsMonitoringData.ts", "src/lib/gradesReport.ts"]) { const t = src(f); assert.ok(t.includes("standingFor("), f); assert.equal(/\bscholarStanding\(/.test(t), false, f); }
});
test("rules are read through one call, grading_rules_timeline, with no write", () => {
  const api = src("src/lib/gradeRulesApi.ts");
  assert.deepEqual([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]), ["grading_rules_timeline"]);
  assert.equal(/\.(insert|update|delete|upsert)\(/.test(api), false);
});

console.log("\nGrade entry");
test("the entry window shows a Percentage box when the school enters percentages and fills in the grade, remarks and result from the table as it is typed", () => {
  assert.ok(modal.includes("const showPct = table && rules.entryMode !== \"grade\"") && modal.includes("aria-label={`Percentage, row ${i + 1}`}") && modal.includes("function updatePercentage(") && modal.includes("describeRow("));
  assert.ok(modal.includes("{reading.percentage != null ? `${reading.percentage}% = ` : \"\"}"));
});
test("with percentage-only entry the grade box fills itself (and stays free for INC and DRP); typing a grade by hand clears the percentage", () => {
  assert.ok(modal.includes("const pctOnly = table && rules.entryMode === \"percentage\"") && modal.includes("disabled={!editable || (pctOnly && r.percentageText.trim() !== \"\")}") && modal.includes('if (field === "grade") next.percentageText = ""'));
});
test("a new subject starts excluded when its code is on the school's list; what the school ticks wins; saved subjects are never touched", () => {
  assert.ok(modal.includes("defaultExcluded(rules, value)") && modal.includes("excludeTouched") && modal.includes("r.isNew && !r.excludeTouched"));
});
test("Save sends the grade of the table and the percentage; a row whose grade did not change is not checked against the table again", () => {
  assert.ok(modal.includes("percentage,\n      });") || modal.includes("remarks: r.remarks, percentage"));
  assert.ok(modal.includes("const unchanged = (r: EditableRow)") && modal.includes("table && !unchanged(r) ? entryOf(r) : null"));
});
test("the GWA preview, the Passed / Failed highlighting and the passing mark text come from the rules", () => {
  assert.ok(modal.includes("periodGwa(input, letterGrades, rules") && modal.includes("classifyGrade(r.grade, config, letterGrades, rules, scholar.course, pctOf(r))") && modal.includes("passing mark ${passingFor(scholar.course, rules)}%"));
});
test("a school that has not had the database update still saves grades: the percentage is only sent when there is one", () => {
  const api = src("src/school/schoolApi.ts");
  assert.ok(api.includes("...(input.percentage != null ? { p_percentage: input.percentage } : {})") && api.includes("...(r.percentage != null ? { percentage: r.percentage } : {})"));
});
test("the portal reads the rules again right after the school saves them", () => {
  assert.ok(src("src/school/components/GradingRulesPanel.tsx").includes("onRulesSaved?.()") && src("src/school/components/GradingConfigPanel.tsx").includes("onRulesSaved={onSaved}"));
  assert.ok(src("src/school/components/GradingRulesPanel.tsx").includes("const RULES_IN_USE = true"));
});

console.log("\nUpload");
test("the CSV template has a percentage column, and a file without it still uploads", () => {
  assert.ok(bulk.includes('"units", "percentage", "grade", "remarks"') && bulk.includes("percentage: [\"percentage\", \"percent\""));
  assert.equal(/missing.*percentage/.test(bulk), false);
});
test("the Excel GRADES column is read as the percentage for a school that enters percentages", () => {
  assert.ok(bulk.includes("export function promoGradeOrPercentage(") && bulk.includes("const { grade, pctText } = promoGradeOrPercentage(e.grade, ctx)"));
  assert.ok(bulkUi.includes("is read as the percentage") && bulkUi.includes("percentageEntry="));
  assert.ok(src("src/school/promoReport.ts").includes("opts.percentageEntry && g?.percentage != null"));
});
test("the preview shows the percentage, the grade it gives and what the table says (remarks, Passed / Failed)", () => {
  assert.ok(bulkUi.includes("{r.percentage ? <span") && bulkUi.includes("r.reading ?") && bulk.includes("readingText("));
});

console.log("\nPassed or failed");
test("the shared rule judges by the table (and the programme's passing mark) before the old passing mark; INC, DRP and the school's marks keep their meaning", () => {
  assert.ok(outcome.includes("tableResult({ grade: g, percentage }, rules, program)") && outcome.indexOf("tableResult(") > outcome.indexOf("own?.outcome"));
  assert.ok(runtime.includes("export function tableResult(") && runtime.includes("passingFor(program, rules)"));
});
test("the school's and the staff screens give the scholar's programme to the rule", () => {
  assert.ok(schoolData.includes("countOutcomes(scholarRows, config, letters, rules, scholar.course)") && src("src/sead/scholarsMonitoringData.ts").includes("countOutcomes(grades, setup?.config ?? null, letters, rules, s.program)"));
});

console.log("\nThe database files");
test("file B only adds one empty column, in its own file, and gives up cleanly if the table is busy", () => {
  const b = src("supabase_migration_school_grading_rules_b_percentage.sql");
  assert.ok(b.includes("set lock_timeout = '5s'") && b.includes("add column if not exists percentage numeric(5,2)"));
  assert.equal(/\b(drop|delete|truncate|update)\b/i.test(b.replace(/--.*$/gm, "")), false);
});
test("file D checks what must be there first, patches the three renewal functions by exact find-and-replace (stopping if the live function differs) and deletes nothing", () => {
  const d = src("supabase_migration_school_grading_rules_d_functions.sql");
  assert.ok(d.includes("STOPPED, nothing changed") && d.includes("if n <> 1 then") && d.includes("_renewal_evaluate(text,text,text)") && d.includes("_renewal_recheck(uuid)") && d.includes("_school_renewal_rows(text,text)"));
  assert.equal(/\b(delete from|truncate|drop table|drop column)\b/i.test(d.replace(/--.*$/gm, "")), false);
});
test("each file has an undo file", () => {
  for (const f of ["undo_school_grading_rules_b.sql", "undo_school_grading_rules_d.sql"]) assert.ok(fs.existsSync(path.join(root, f)), f);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
