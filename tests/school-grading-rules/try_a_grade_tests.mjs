// tests/school-grading-rules/try_a_grade_tests.mjs — "Try a grade" in the Grading System tab answers whenever it can, and says what is wrong when it cannot.
// Run:  node tests/school-grading-rules/try_a_grade_tests.mjs     (no database or browser needed)
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const out = path.join(root, ".try_tmp.mjs");
await build({ entryPoints: [path.join(root, "src/lib/gradingRules.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const G = await import(pathToFileURL(out).href); fs.rmSync(out);

const PH = G.PRESETS.find(p => p.key === "ph-1-5");
const rules = (over = {}) => ({ entryMode: PH.rules.entryMode, passingMarkPct: PH.rules.passingMarkPct, programPassing: [], bands: PH.rules.bands.map(b => ({ ...b })), gwa: { ...G.DEFAULT_GWA_SETTINGS }, ...over });

console.log("What is typed");
test("87.5, 87,5, 87.5% and ' 87.5 % ' are all 87.5; text, negative and above 100 are not a percentage", () => {
  for (const t of ["87.5", "87,5", "87.5%", " 87.5 % "]) assert.equal(G.parseTryPercentage(t), 87.5, t);
  for (const t of ["abc", "-5", "101", "100.5", "8 7", "%", ""]) assert.ok(Number.isNaN(G.parseTryPercentage(t)), t);
  assert.equal(G.parseTryPercentage("100"), 100); assert.equal(G.parseTryPercentage("0"), 0);
});

console.log("\nA finished table");
test("the grade, the remarks and Passed / Failed", () => {
  const a = G.tryAGrade("88", rules());
  assert.deepEqual([a.kind, a.grade, a.remarks, a.result], ["grade", "1.75", "Good", "passed"]);
  const f = G.tryAGrade("74.99", rules()); assert.deepEqual([f.grade, f.result], ["5.00", "failed"]);
  assert.equal(G.tryAGrade("75", rules()).result, "passed");
});
test("a program's own passing mark", () => {
  const r = rules({ programPassing: [{ program: "BS Law", passingPct: 85 }] });
  assert.equal(G.tryAGrade("80", r, "BS Law").result, "failed"); assert.equal(G.tryAGrade("80", r, "BS Education").result, "passed"); assert.equal(G.tryAGrade("85", r, " bs law ").result, "passed");
});
test("nothing typed, or something that is not a percentage", () => {
  assert.equal(G.tryAGrade("", rules()).kind, "empty"); assert.equal(G.tryAGrade("  ", rules()).kind, "empty");
  assert.equal(G.tryAGrade("abc", rules()).kind, "bad_number"); assert.equal(G.tryAGrade("150", rules()).kind, "bad_number");
});

console.log("\nA table that is not finished: it still answers");
test("no passing mark yet: the grade and remarks are shown, without Passed / Failed", () => {
  const a = G.tryAGrade("88", rules({ passingMarkPct: null }));
  assert.deepEqual([a.kind, a.grade, a.remarks, a.result], ["grade", "1.75", "Good", null]);
});
test("a table with a gap: a percentage in a row works, one in the gap says no row covers it", () => {
  const r = rules(); r.bands = r.bands.filter(b => b.equivalentGrade !== "2.00");        // 85 to 87.99 is now missing
  assert.equal(G.tryAGrade("95", r).grade, "1.25");
  const gap = G.tryAGrade("86", r); assert.deepEqual([gap.kind, gap.percentage], ["no_row", 86]);
});
test("rows that overlap, or a passing mark inside a row: still answers (the first row that covers it)", () => {
  const r = rules(); r.bands.find(b => b.equivalentGrade === "1.25").from = 93;            // overlaps 1.50
  assert.equal(G.tryAGrade("93.5", r).kind, "grade");
  assert.equal(G.tryAGrade("80", rules({ passingMarkPct: 80 })).kind, "grade");
});
test("a half-typed row (empty or not a number) is skipped, and the other rows still answer", () => {
  const r = rules(); r.bands.push({ from: Number.NaN, to: Number.NaN, equivalentGrade: "", remarks: "" });
  assert.equal(G.tryAGrade("88", r).grade, "1.75");
});
test("no rows at all says so", () => assert.equal(G.tryAGrade("88", rules({ bands: [] })).kind, "no_rows"));
test("a program passing mark that is not a number yet falls back to no result, not to a wrong one", () => {
  const r = rules({ programPassing: [{ program: "BS Law", passingPct: Number.NaN }] });
  assert.equal(G.tryAGrade("88", r, "BS Law").result, null);
});

console.log("\nThe screen");
const panel = fs.readFileSync(path.join(root, "src/school/components/GradingRulesPanel.tsx"), "utf8").split("\r\n").join("\n");
test("the box uses tryAGrade, shows what is still wrong with the table beside the answer, and no longer refuses with 'Finish the table'", () => {
  assert.ok(panel.includes("tryAGrade(tryText, rules, tryProgram || null)") && panel.includes("The table still has a problem to fix before you can save it: {tableProblem.message}"));
  assert.equal(panel.includes("Finish the table (no gaps or overlaps, a passing mark) to try a grade."), false);
  assert.ok(panel.includes("No row of the table covers {tryAnswer.percentage}%") && panel.includes("type the Passing mark above to also see Passed or Failed"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
