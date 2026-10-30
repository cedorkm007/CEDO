// tests/entered-grades/web_tests.mjs — the website side of scholar-entered grades (checks, words, who sees what, the screens, the grading setup)
// Run:  node tests/entered-grades/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egw-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const R = await bundle("renewal", "src/lib/renewal.ts");
const A = await bundle("access", "src/lib/renewalAccess.ts");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const row = (code, subject, units, grade) => ({ code, subject, units, grade });

console.log("What is checked before the grades are sent");
test("at least one subject, at most 25; every subject needs a code, a name, a grade and sensible units; a code cannot repeat", () => {
  assert.equal(R.validateSelfGradeLines([row("M1", "Algebra", "3", "1.5")]), null);
  assert.match(R.validateSelfGradeLines([]), /at least one subject/);
  assert.match(R.validateSelfGradeLines(Array.from({ length: 26 }, (_, i) => row("C" + i, "S", "3", "A"))), /at most 25/);
  assert.match(R.validateSelfGradeLines([row("", "Algebra", "3", "1.5")]), /Subject 1/);
  assert.match(R.validateSelfGradeLines([row("M1", "Algebra", "0", "1.5")]), /units/);
  assert.match(R.validateSelfGradeLines([row("M1", "Algebra", "abc", "1.5")]), /units/);
  assert.match(R.validateSelfGradeLines([row("M1", "Algebra", "13", "1.5")]), /units/);
  assert.equal(R.validateSelfGradeLines([row("M1", "Algebra", "1,5", "1.5")]), null, "a comma as the decimal sign is accepted");
  assert.match(R.validateSelfGradeLines([row("m1", "A", "3", "1"), row("M1", "B", "3", "2")]), /listed twice/);
});
test("images: JPG / PNG / WEBP only, 10 MB at most, 5 at most, not empty", () => {
  const img = (type, size, name = "a.png") => ({ name, type, size });
  assert.equal(R.validateSelfGradeImage(img("image/png", 1000), 0), null);
  assert.equal(R.validateSelfGradeImage(img("image/jpeg", 1000), 4), null);
  assert.match(R.validateSelfGradeImage(img("image/png", 1000), 5), /at most 5/);
  assert.match(R.validateSelfGradeImage(img("application/pdf", 1000, "x.pdf"), 0), /only JPG, PNG or WEBP/);
  assert.match(R.validateSelfGradeImage(img("image/png", 11 * 1024 * 1024), 0), /too big/);
  assert.match(R.validateSelfGradeImage(img("image/png", 0), 0), /empty/);
});
test("the tick the scholar gives says wrong or false information means disciplinary action or removal from the City Scholarship Program", () => {
  assert.match(R.SELF_GRADES_WARNING, /wrong or false information/); assert.match(R.SELF_GRADES_WARNING, /disciplinary action or removal from the City Scholarship Program/);
});

console.log("\nThe words");
test("a difference reads as one line, in the three cases", () => {
  assert.equal(R.selfGradeDifferenceText({ code: "M1", subject: "Algebra", entered: "1.5", school: "2.0", kind: "different" }), "M1 Algebra: you entered 1.5, the school has 2.0");
  assert.match(R.selfGradeDifferenceText({ code: "M2", subject: "Physics", entered: "A", school: null, kind: "missing_in_school" }), /the school has no grade for it/);
  assert.match(R.selfGradeDifferenceText({ code: "M3", subject: "Art", entered: null, school: "B", kind: "missing_in_entered" }), /you did not enter it/);
});
test("the status words: waiting for the Grades Approver, approved, returned for correction", () => {
  assert.deepEqual(R.selfGradesStatusText("pending"), { text: "Waiting for the Grades Approver", tone: "warn" });
  assert.deepEqual(R.selfGradesStatusText("approved"), { text: "Approved", tone: "good" });
  assert.deepEqual(R.selfGradesStatusText("returned"), { text: "Returned for correction", tone: "bad" });
});

console.log("\nWho sees what");
test("only an account with the Grades Approver tag can approve; it.admin1 appoints it from Staff Accounts (it is in the list of tool tags)", () => {
  const u = (tags, extra = {}) => ({ tags, role: "staff", division: "OTHER", username: "x", ...extra });
  assert.equal(A.canApproveScholarGrades(u(["scholar_grades_approver"])), true);
  assert.equal(A.canApproveScholarGrades(u(["scholar_renewal_evaluator"])), false);
  assert.equal(A.canApproveScholarGrades(u([], { username: "it.admin1" })), false);
  assert.match(src("src/app/staffToolTags.ts"), /key: "scholar_grades_approver"/);
  assert.match(src("src/app/staffToolTags.ts"), /label: "Grades Approver"/);
});
test("an approver with no other renewal tag can open Scholar Renewal, and lands on the Entered grades tab", () => {
  assert.equal(A.canSeeScholarRenewal({ tags: ["scholar_grades_approver"], role: "staff", division: "OTHER", username: "x" }), true);
  const page = src("src/sead/ScholarRenewalPage.tsx");
  assert.match(page, /isGradesApprover \? "enteredGrades" : "certificate"/);
  assert.match(page, /key: "enteredGrades", label: "Entered grades"/);
  assert.match(page, /t\.key === "enteredGrades" \? \(isEvaluator \|\| isGradesApprover\)/);
  assert.match(page, /<RenewalEnteredGradesTab refreshKey=\{refreshKey\} onChanged=\{bump\} \/>/);
  assert.match(src("src/app/App.tsx"), /isGradesApprover=\{canApproveScholarGrades\(currentUser\)\}/);
});

console.log("\nThe screens");
test("the scholar's form: subject code, subject name, units and grade per subject; images; the tick; sent only with the tick", () => {
  const f = src("src/scholar/components/dashboard/SelfGradesSection.tsx");
  const form = src("src/scholar/components/dashboard/SelfGradesForm.tsx");
  assert.match(f, /<SelfGradesForm /, "the tracker card uses the shared form");
  for (const label of ["Subject code", "Subject name", "Units", "Grade"]) assert.ok(form.includes(`placeholder="${label}"`), label);
  assert.match(form, /Screenshot or image of your grades/);
  assert.match(form, /\{SELF_GRADES_WARNING\}/);
  assert.match(f, /disabled=\{busy \|\| !ack\}/, "the Send button waits for the tick");
  assert.match(f, /Send my grades for approval/);
  assert.match(f, /Correct and send again/);
  assert.match(f, /They match the grades you entered/);
  assert.match(f, /differ from what you entered/);
  assert.equal(/text-slate-[45]00/.test(f), false, "no faint text");
});
test("the form shows up in the scholar's tracker, and the summary says when the grades are the scholar's own", () => {
  const p = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.match(p, /<SelfGradesSection record=\{record\} ev=\{ev\} scholarIdNumber=\{overview\.scholar\.scholarIdNumber\} onChanged=\{onChanged\} \/>/);
  assert.match(p, /These are the grades you entered, approved by the Grades Approver/);
});
test("the images go to the scholar's own folder first, the database saves the try, and the images are removed again if saving fails", () => {
  const api = src("src/scholar/renewalApi.ts");
  assert.match(api, /\/grade-entries\//);
  assert.match(api, /rpc\("renewal_self_grades_submit"/);
  assert.match(api, /storage\.from\(RENEWAL_DOCUMENT_BUCKET\)\.remove\(uploaded\.map/);
});
test("the approver's tab: the images, the subjects, the differences with the school's grades, approve / return (a reason for a return), buttons only for those who may decide, a warning when the school has no passing mark", () => {
  const tab = src("src/sead/renewal/RenewalEnteredGradesTab.tsx");
  assert.match(tab, /required=\{!deciding\.approve\}/);
  assert.match(tab, /\{r\.canDecide && \(/);
  assert.match(tab, /Screenshots \(/);
  assert.match(tab, /were compared with these/);
  assert.match(tab, /no passing mark yet/);
  assert.match(tab, /Grading setup/);
  assert.equal(/text-slate-[45]00/.test(tab) || /text-slate-[45]00/.test(src("src/sead/enteredGradesApi.ts")), false, "no faint text");
  const api = src("src/sead/enteredGradesApi.ts");
  for (const fn of ["renewal_self_grades_list", "renewal_self_grades_counts", "renewal_self_grades_decide", "grading_setup_schools", "grading_setup_get", "grading_setup_save"]) assert.ok(api.includes(`rpc("${fn}"`), fn);
});
test("the Grades Monitoring tool has a Grading setup tab: the scale, the passing mark, the letters, the other marks with what they mean, and a warning before it replaces a school's own setup", () => {
  assert.match(src("src/sead/ScholarsGradesMonitoringPage.tsx"), /key: "setup", label: "Grading setup"/);
  const tab = src("src/sead/pages/ScholarsGradesMonitoringSetupTab.tsx");
  for (const s of ["Lowest grade", "Highest grade", "Passing mark", "Letter grades and the number each one stands for", "what they mean for renewal", "Set by staff (temporary)", "Set by the school", "Saving here replaces it"]) assert.ok(tab.includes(s), s);
  assert.match(tab, /INC and DRP are built in/);
});
test("the evaluator's application page says when the grades are the scholar's own entered grades", () => {
  assert.match(src("src/sead/renewal/RenewalDetailView.tsx"), /These are the grades the scholar entered/);
});

console.log("\nGrades inside the application form");
test("the form offers the grades step only when the database says it can carry them, and not when the school already uploaded", () => {
  const p = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.match(p, /preview\?\.grades_in_form/);
  assert.match(p, /offerGrades = gradesInForm && !schoolGrades/);
  assert.match(p, /You cannot apply for renewal without your grades/);
  assert.doesNotMatch(p, /Apply without entering my grades/, "entering the grades is a must, not a choice");
  assert.match(p, /<SelfGradesForm /);
});
test("the application cannot go on until the grades form is complete (or the school uploaded the grades)", () => {
  const p = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.match(p, /const enterGrades = offerGrades/);
  assert.match(p, /Still needed before you can go on/);
  assert.match(p, /disabled={!preview || !gate\.open}/);      // the gate (renewalNextGate) includes the unfinished-grades check
});
test("an SDP reconsideration is not offered until the grades are entered or the school's are in; the Next button waits for a complete grades form", () => {
  const p = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.match(p, /gradesReady = !gradesInForm \|\| schoolGrades/);
  assert.match(p, /canAskReconsideration && !gradesReady/);
  assert.match(p, /disabled=\{!preview \|\| !gate\.open\}/);      // the gate (renewalNextGate) includes the unfinished-grades check
});
test("the application sends the grades with the images uploaded first and removed again if the application is refused", () => {
  const a = src("src/scholar/renewalApi.ts");
  assert.match(a, /p_grade_lines/); assert.match(a, /p_grade_files/); assert.match(a, /p_grade_ack/);
  assert.match(a, /grade-entries/);
  assert.match(a, /await undo\(\)/);
});
test("the approver cannot approve an SDP reconsideration while the grades are not complete (deny stays)", () => {
  const a = src("src/sead/sdpReconsiderationApi.ts"), tab = src("src/sead/renewal/RenewalSdpReconsiderationTab.tsx");
  assert.match(a, /grades_complete/); assert.match(a, /Cannot be approved yet/);
  assert.match(tab, /disabled=\{r\.status === "pending" && !!sdpApprovalBlockedText\(r\)\}/);
});

console.log("\nThe database files");
test("three files and their undo files exist; none deletes anything from an existing table; B changes only the grading setup table", () => {
  const files = ["a_tables", "b_grading_columns", "c_functions"].map(n => src(`supabase_migration_entered_grades_${n}.sql`).replace(/--.*$/gm, ""));
  for (const n of ["a", "b", "c"]) assert.ok(fs.existsSync(path.join(root, `undo_entered_grades_${n}.sql`)), `undo ${n}`);
  assert.equal(/alter table public\.(?!school_grading_configs)/i.test(files[1]), false);
  assert.equal(/\b(truncate|drop table)\b/i.test(files.join("\n")), false);
  assert.match(files[2], /renewal_self_grades_submit/); assert.match(files[2], /renewal_self_grades_decide/); assert.match(files[2], /_renewal_self_grades_on_school_submit/);
  assert.match(files[2], /can_approve_scholar_grades\(\)/);
  assert.match(files[0], /acknowledged_at\s+timestamptz not null/);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
