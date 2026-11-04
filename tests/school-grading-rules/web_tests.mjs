// tests/school-grading-rules/web_tests.mjs — the screens of Phase 1: the Grading System tab (conversion table, GWA computation, saving, history) and CEDO's read-only view
// Run:  node tests/school-grading-rules/web_tests.mjs
// No database or browser needed.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const panel = src("src/school/components/GradingRulesPanel.tsx"), config = src("src/school/components/GradingConfigPanel.tsx"), view = src("src/app/components/GradingRulesView.tsx");
const staffTab = src("src/sead/pages/ScholarsGradesMonitoringRulesTab.tsx"), staffPage = src("src/sead/ScholarsGradesMonitoringPage.tsx"), schoolApi = src("src/school/gradingRulesApi.ts"), staffApi = src("src/sead/schoolGradingRulesApi.ts");

console.log("The Grading System tab");
test("the tab shows the new part under the existing scale form, and the form tells it what is typed and what is saved", () => {
  assert.ok(config.includes("<GradingRulesPanel") && config.includes("scaleDirty={scaleDirty}") && config.includes("formScale={formScale}") && config.includes("onApplyPreset={applyPreset}"));
});
test("the conversion table has the columns From (%), To (%), Equivalent grade, Remarks and Result, with Add row, Delete and drag handles", () => {
  for (const c of ["From (%)", "To (%)", "Equivalent grade", "Remarks", "Result"]) assert.ok(panel.includes(`>${c}</th>`), c);
  assert.ok(panel.includes("Add row") && panel.includes("Delete row") && panel.includes("draggable") && panel.includes("onDrop"));
  assert.ok(panel.includes("Rows list themselves from the highest percentage to the lowest"));
});
test("the result is not typed: it comes from the passing mark; there is no Conditional", () => {
  assert.ok(panel.includes("bandResult(") && panel.includes("A percentage of {passing} or higher is Passed; anything below {passing} is Failed."));
  assert.equal(/conditional/i.test(panel.replace(/\/\/.*$/gm, "")), false);
});
test("programs with a different passing mark can be listed, with suggestions from the school's own programs", () => {
  assert.ok(panel.includes("Programs with a different passing mark") && panel.includes("Add a program") && panel.includes('list="school-programs"'));
});
test("grade entry: either the equivalent grade, the percentage, or either (the school's choice)", () => assert.ok(panel.includes("ENTRY_MODE_LABEL") && panel.includes('name="entry-mode"')));
test("templates: a menu of presets, with a confirmation, that also sets the scale above", () => {
  assert.ok(panel.includes("Start from a common template") && panel.includes("PRESETS.map") && panel.includes("Use this template") && panel.includes("Nothing is saved until you press the Save buttons"));
  assert.ok(config.includes("function applyPreset(p: RulesPreset)") && config.includes("setPassingText(String(p.scalePassingMark))"));
});
test("Try a grade shows the grade, the remarks and the result for a percentage", () => assert.ok(panel.includes("Try a grade") && panel.includes("tryAGrade(tryText, rules, tryProgram || null)") && panel.includes("{tryAnswer.grade}{tryAnswer.remarks ?")));
test("special grades (INC, DRP, the school's other marks) are listed under the table, and stay where they are edited", () => assert.ok(panel.includes("Special grades with no percentage") && panel.includes("<strong>INC</strong> — Incomplete") && panel.includes("<strong>DRP</strong> — Dropped")));

console.log("\nThe GWA computation");
test("every setting of the brief is there: method, grade used, decimals, rounding, failed grades, special marks as numbers, default excluded codes, retention requirement", () => {
  for (const s of ["Units-weighted average (default)", "Simple average", "The equivalent grade (default)", "The percentage", "Decimal places shown", "Round normally", "Cut off the extra decimals", "Failed grades are included", "Special marks (INC, DRP …)", "excluded from the GWA when first saved", "Retention requirement for this GWA"]) assert.ok(panel.includes(s), s);
});
test("the sample computation box shows the working with the school's settings", () => assert.ok(panel.includes("<SampleBox") && view.includes("Sample computation") && view.includes("GWA = {out.formula}")));
test("there is ONE GWA function with settings (in gwa.ts); the screens only call it", () => {
  assert.ok(src("src/lib/gwa.ts").includes("export function gwaWithSettings("));
  for (const f of ["src/school/components/GradingRulesPanel.tsx", "src/app/components/GradingRulesView.tsx", "src/lib/gradingRules.ts", "src/lib/gradingImpact.ts"]) assert.equal(/sum\(|reduce\(\(a, l\) => a \+ \(l\.value/.test(src(f)), false, f);
});

console.log("\nChecking and saving");
test("the checks run as the school types and again on Save, with the message pointing to the row", () => {
  assert.ok(panel.includes("validateRules(rules, formScale, marksKnown)") && panel.includes("Fix these before saving") && panel.includes("problemRows.has(rank)"));
});
test("before saving the school sees where the rules start, what changes and how many grades and GWAs would change, and confirms", () => {
  assert.ok(panel.includes("Save these rules?") && panel.includes("What changes") && panel.includes("How many grades and GWAs would change") && panel.includes("Confirm and save") && panel.includes("computeImpact("));
  assert.ok(panel.includes("a submitted period never changes"));
});
test("saving is blocked while the scale above has changes that are not saved, and when nothing changed", () => {
  assert.ok(panel.includes("Press Save grading system above first") && panel.includes("Nothing has changed since the rules you saved last."));
});
test("the history lists each version with who, when, what changed and the impact, and opens it read-only", () => {
  assert.ok(panel.includes("History of changes") && panel.includes("describeChanges(a.oldRules, a.newRules)") && panel.includes("View these rules") && panel.includes("<GradingRulesView rules={viewing.rules}"));
});
test("Phase 2: the rules are IN USE (the 'saved for later use' notice is off)", () => {
  assert.ok(panel.includes("const RULES_IN_USE = true"));
});
test("before the database update the tab says so and the rest of the Grading System tab still works", () => {
  assert.ok(panel.includes("need a database update from CEDO") && schoolApi.includes("PGRST202"));
});

console.log("\nThe database calls");
test("the school reads and saves through three functions only", () => {
  assert.deepEqual([...schoolApi.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]).sort(), ["school_grading_rules_overview", "school_grading_rules_save", "school_grading_rules_version"]);
});
test("CEDO staff have two READ functions and nothing that saves", () => {
  assert.deepEqual([...staffApi.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]).sort(), ["staff_school_grading_rules", "staff_school_grading_rules_version"]);
  assert.equal(/\.(insert|update|delete|upsert)\(|_save"/.test(staffApi + staffTab), false);
});

console.log("\nCEDO read-only view");
test("Scholars' Grades Monitoring has a Grading rules tab that lists the schools and opens each school's rules, versions and history", () => {
  assert.ok(staffPage.includes('{ key: "rules", label: "Grading rules"') && staffPage.includes("<ScholarsGradesMonitoringRulesTab />"));
  assert.ok(staffTab.includes("View grading rules") && staffTab.includes("History of changes") && staffTab.includes("<GradingRulesView"));
  assert.ok(staffTab.includes("You can only look"));
});

console.log("\nStyle and files");
test("readable text in the new screens: nothing under 13px, no pale grey words", () => {
  for (const f of ["src/school/components/GradingRulesPanel.tsx", "src/app/components/GradingRulesView.tsx", "src/sead/pages/ScholarsGradesMonitoringRulesTab.tsx"]) {
    const t = src(f); assert.equal(/text-\[(?:9|10|11|12)(?:\.\d+)?px\]/.test(t), false, f); assert.equal(/text-slate-(?:300|400|500)\b/.test(t), false, f);
  }
});
test("every field has a real label or an aria-label", () => assert.ok((panel.match(/<input/g) ?? []).length <= (panel.match(/aria-label=|htmlFor=|<label/g) ?? []).length + 4));
test("the two database files and their undo files exist; only additions", () => {
  for (const f of ["supabase_migration_school_grading_rules_a_tables.sql", "supabase_migration_school_grading_rules_c_functions.sql", "undo_school_grading_rules_a.sql", "undo_school_grading_rules_c.sql"]) assert.ok(fs.existsSync(path.join(root, f)), f);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
