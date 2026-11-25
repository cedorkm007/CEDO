// tests/grading-program-marks/web_tests.mjs — Grading setup: a passing mark for a specific program (3 checks, short on purpose)
// Run:  node tests/grading-program-marks/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gpm-"));
const bundle = async (entry, name) => { const outfile = path.join(tmp, name); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } }); return pathToFileURL(outfile).href; };
const O = await import(await bundle("src/lib/subjectOutcome.ts", "outcome.mjs"));
const G = await import(await bundle("src/lib/gwa.ts", "gwa.mjs"));
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const cfg = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3, setByStaff: true, programMarks: [{ program: "BS Nursing", passingMark: 2.5 }] };

test("the screens judge a grade like the database: the program's own mark for that program (any case, spaces), the school's for other programs and when the program is unknown, and the program marks only count while the setup is the one staff made", () => {
  const c = (g, program, config = cfg) => O.classifyGrade(g, config, [], null, program);
  assert.equal(c("2.75", "BS Nursing"), "failed");
  assert.equal(c("2.5", "bs NURSING "), "passed");
  assert.equal(c("2.75", "BS Test Studies"), "passed");
  assert.equal(c("2.75", null), "passed");
  assert.equal(c("2.75", ""), "passed");
  assert.equal(c("INC", "BS Nursing"), "inc");
  assert.equal(c("DRP", "BS Nursing"), "drp");
  assert.equal(c("2.75", "BS Nursing", { ...cfg, setByStaff: false }), "passed", "the school saved its own: its mark applies");
  assert.equal(c("2.75", "BS Nursing", { ...cfg, programMarks: [] }), "passed");
  const higher = { scaleMin: 60, scaleMax: 100, direction: "higher_is_better", usesLetterGrades: false, passingMark: 75, setByStaff: true, programMarks: [{ program: "BSN", passingMark: 85 }] };
  assert.equal(c("80", "BSN", higher), "failed"); assert.equal(c("85", "BSN", higher), "passed"); assert.equal(c("80", "BSE", higher), "passed");
  assert.equal(O.passingMarkFor(cfg, "BS Nursing"), 2.5); assert.equal(O.passingMarkFor(cfg, "Other"), 3); assert.equal(O.passingMarkFor(null, "BS Nursing"), null);
  const counts = O.countOutcomes([{ grade: "2.75" }, { grade: "2.0" }, { grade: "3.0" }], cfg, [], null, "BS Nursing");
  assert.equal(counts.failed, 2);
  assert.deepEqual(G.parseProgramMarks([{ program: " BS Nursing ", passing_mark: "2.5" }, { program: "", passing_mark: 1 }, { program: "X", passing_mark: "abc" }, null]), [{ program: "BS Nursing", passingMark: 2.5 }]);
  assert.deepEqual(G.parseProgramMarks("nonsense"), []);
});

test("every screen that reads the school's grading setup is given the program marks (the school's own screen, the scholar's grades and grade check, the staff's scholar and school screens), and the staff screens still work before the database update", () => {
  const schoolApi = src("src/school/schoolApi.ts"), scholarApi = src("src/scholar/scholarApi.ts"), staffApi = src("src/sead/scholarsGradesMonitoringApi.ts"), data = src("src/sead/scholarsMonitoringData.ts"), rules = src("src/scholar/useMyGradeRules.ts");
  assert.ok(schoolApi.includes("programMarks: parseProgramMarks(data.staff_program_marks)") && schoolApi.includes("setByStaff: !!data.set_by_staff"));
  assert.ok(scholarApi.includes('rpc("get_scholar_grading_program_marks")') && scholarApi.includes("effectivePassingMark") && rules.includes("cfg.effectivePassingMark !== undefined ? cfg.effectivePassingMark : cfg.passingMark"));
  assert.ok(staffApi.includes('rpc("get_scholar_grading_program_marks_for_staff"'));
  assert.ok(data.includes("set_by_staff, staff_program_marks") && data.includes("cfgWithMarks.error ? await supabase.from(\"school_grading_configs\").select(\"school_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold, passing_mark\")"));
  assert.ok(data.includes("programMarks: parseProgramMarks("));
});

test("the Grading setup pop-up has 'Programs with their own passing mark' (pick one of the school's programs, type its mark on the school's scale, remove, add), the list of schools says how many programs have their own mark, the marks are saved with the setup, and the section is left out until the database update has been run", () => {
  const tab = src("src/sead/pages/ScholarsGradesMonitoringSetupTab.tsx"), api = src("src/sead/enteredGradesApi.ts");
  assert.ok(tab.includes("Programs with their own passing mark") && tab.includes("Choose the program…") && tab.includes("Add a program") && tab.includes("Remove program") && tab.includes("Passing mark of program"));
  assert.ok(tab.includes("programMarksAvailable && (") && tab.includes("with their own passing mark") && tab.includes("same scale as the school"));
  assert.ok(api.includes("program_marks: (setup.programMarks ?? [])") && api.includes("programMarksAvailable: Array.isArray(d.programs)") && api.includes("programMarks: num(r.program_marks)"));
  assert.ok(tab.includes("saveGradingSetup(school.schoolId, form)"), "the marks travel with the form");
});
console.log(`\n${passed} passed`);
