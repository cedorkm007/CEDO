// tests/renewal/run.mjs
// Run:  node tests/renewal/run.mjs
// No database or browser needed. Checks the website side of the Scholar Renewal System's grade rules (Phase 1):
// passed / failed / INC / DRP, the school's passing mark, remarks in the CSV, and that the website and the database agree
// (the shared case table tests/renewal/outcome_cases.json is also run against the database function by tests/renewal/db/run_db_tests.mjs).
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "renewal-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const O = await bundle("outcome", "src/lib/subjectOutcome.ts");
const B = await bundle("bulk", "src/school/bulkGradeLogic.ts");
const PL = await bundle("portal", "src/school/portalLogic.ts");

const cases = JSON.parse(fs.readFileSync(path.join(root, "tests/renewal/outcome_cases.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`); }
}
const school = name => cases.schools[name];
const classify = (schoolName, grade) => O.classifyGrade(grade, school(schoolName), school(schoolName).letters);

console.log("Subject outcome (Phase 1)");
test(`every shared case gives the expected outcome (${cases.cases.length} cases)`, () => {
  const wrong = cases.cases.filter(c => classify(c.school, c.grade) !== c.outcome).map(c => `${c.school} "${c.grade}" -> ${classify(c.school, c.grade)} (expected ${c.outcome})`);
  assert.deepEqual(wrong, []);
});
test("a grade EQUAL to the passing mark passes, one step worse fails (both directions)", () => {
  assert.equal(classify("lower", "3.0"), "passed");
  assert.equal(classify("lower", "3.01"), "failed");
  assert.equal(classify("higher", "75"), "passed");
  assert.equal(classify("higher", "74.99"), "failed");
});
test("INC and DRP are reserved marks: any case, any spacing, whatever the school's scale or letter table", () => {
  for (const s of ["lower", "higher", "letters", "nomark"]) {
    for (const g of ["INC", "inc", " Inc ", "iNc"]) assert.equal(classify(s, g), "inc", `${s} ${g}`);
    for (const g of ["DRP", "drp", " Drp "]) assert.equal(classify(s, g), "drp", `${s} ${g}`);
  }
  assert.equal(O.reservedMark(" inc "), "INC");
  assert.equal(O.reservedMark("drp"), "DRP");
  assert.equal(O.reservedMark("A"), null);
  assert.equal(O.reservedMark(""), null);
});
test("DRP counts as FAILED; INC is NOT failed (it is tracked separately)", () => {
  assert.equal(O.isFailed("drp"), true);
  assert.equal(O.isFailed("failed"), true);
  assert.equal(O.isFailed("inc"), false);
  assert.equal(O.isFailed("passed"), false);
  assert.equal(O.isFailed("review"), false);
  assert.equal(O.isFailed("no_passing_mark"), false);
});
test("a school with no passing mark is never guessed at: graded subjects are 'no_passing_mark', INC / DRP / blank are still recognised", () => {
  assert.equal(classify("nomark", "1.0"), "no_passing_mark");
  assert.equal(classify("nomark", "5.0"), "no_passing_mark");
  assert.equal(O.classifyGrade("2.0", null, []), "no_passing_mark");
  assert.equal(O.classifyGrade("INC", null, []), "inc");
  assert.equal(O.classifyGrade("", null, []), "ungraded");
});
test("a mark nobody can read (W, a typo, a letter with no number) goes to review, not to failed or passed", () => {
  assert.equal(classify("lower", "W"), "review");
  assert.equal(classify("letters", "W"), "review");
  assert.equal(classify("letters", "Z"), "review");
  assert.equal(classify("lower", "2,5"), "review");
});

console.log("Counting failed / INC for a scholar (scenarios 7, 8, 9, 10, 13, 15, 26, 27)");
const row = (grade, extra = {}) => ({ grade, units: 3, ...extra });
const countsOf = (schoolName, rows) => O.countOutcomes(rows, school(schoolName), school(schoolName).letters);
test("scenario 7: 1 DRP counts as 1 failed subject", () => {
  assert.deepEqual(countsOf("lower", [row("1.5"), row("DRP")]), { failed: 1, drp: 1, inc: 0, review: 0, noPassingMark: 0 });
});
test("scenario 8: 1 DRP + 1 failed grade = 2 failed", () => {
  const c = countsOf("lower", [row("DRP"), row("4.0"), row("1.0")]);
  assert.equal(c.failed, 2);
  assert.equal(c.drp, 1);
});
test("scenario 9: a failed grade in an 'Exclude from GWA' subject (e.g. NSTP) STILL counts as failed", () => {
  const c = countsOf("lower", [row("1.5"), row("5.0", { excludeFromGwa: true })]);
  assert.equal(c.failed, 1);
});
test("scenario 10: an INC-only scholar has 0 failed and 1 INC", () => {
  const c = countsOf("lower", [row("1.5"), row("INC")]);
  assert.equal(c.failed, 0);
  assert.equal(c.inc, 1);
});
test("scenario 13: when the INC is later resolved with a failing grade it becomes 1 failed; with a passing grade, nothing", () => {
  assert.equal(countsOf("lower", [row("1.5"), row("4.0")]).failed, 1);
  assert.deepEqual(countsOf("lower", [row("1.5"), row("2.0")]), { failed: 0, drp: 0, inc: 0, review: 0, noPassingMark: 0 });
});
test("scenario 15: 1 failed + 1 INC are counted separately", () => {
  const c = countsOf("lower", [row("4.0"), row("INC"), row("1.0")]);
  assert.equal(c.failed, 1);
  assert.equal(c.inc, 1);
});
test("scenario 26: a lower-is-better school (1-5, pass 3.0) and a higher-is-better school (60-100, pass 75) use their own scale", () => {
  assert.equal(countsOf("lower", [row("3.0"), row("3.5")]).failed, 1);
  assert.equal(countsOf("higher", [row("75"), row("74")]).failed, 1);
  assert.equal(countsOf("higher", [row("3.5")]).failed, 1); // 3.5 on a 60-100 scale is far below the passing mark
});
test("scenario 27: a letter-grade school uses its letter table (C = 3.0 passes, D = 4.0 fails, W needs review)", () => {
  const c = countsOf("letters", [row("A"), row("C"), row("D"), row("W"), row("INC")]);
  assert.deepEqual(c, { failed: 1, drp: 0, inc: 1, review: 1, noPassingMark: 0 });
});
test("with no passing mark, graded subjects are counted as 'no passing mark' (so the screen can ask the school to set it), INC/DRP still flagged", () => {
  const c = countsOf("nomark", [row("1.0"), row("5.0"), row("INC"), row("DRP")]);
  assert.deepEqual(c, { failed: 1, drp: 1, inc: 1, review: 0, noPassingMark: 2 });
});
test("the summary line reads naturally and is empty when there is nothing to flag", () => {
  assert.equal(O.outcomeSummaryText({ failed: 1, drp: 0, inc: 1, review: 0, noPassingMark: 0 }), "1 failed · 1 INC");
  assert.equal(O.outcomeSummaryText({ failed: 2, drp: 1, inc: 0, review: 1, noPassingMark: 0 }), "2 failed · 1 to review");
  assert.equal(O.outcomeSummaryText({ failed: 0, drp: 0, inc: 0, review: 0, noPassingMark: 3 }), "");
});

console.log("School entry: INC / DRP, remarks, CSV (Phase 1)");
const CONFIG = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false };
test("a school can enter INC and DRP even with no letter table; other unknown marks are still refused", () => {
  for (const g of ["INC", "inc", "DRP", " drp "]) assert.equal(B.validateGradeValue(g, CONFIG, []), null, g);
  assert.match(B.validateGradeValue("XYZ", CONFIG, []), /not on your grading scale/);
  assert.match(B.validateGradeValue("9", CONFIG, []), /outside your grading scale/);
});
test("the grade hint always lists INC and DRP once, after the school's own letters", () => {
  const cfg = { ...CONFIG, usesLetterGrades: true };
  assert.equal(PL.gradeInputHint(CONFIG, []), "Allowed: 1 to 5, or INC, DRP");
  assert.equal(PL.gradeInputHint(cfg, [{ letter: "A", numericValue: 1 }]), "Allowed: 1 to 5, or A, INC, DRP");
  assert.equal(PL.gradeInputHint(cfg, [{ letter: "INC", numericValue: null }]), "Allowed: 1 to 5, or INC, DRP");
});

const PERIOD = { schoolYear: "2026-2027", semester: "1st Semester" };
const SCHOLARS = [{ scholarIdNumber: "S-1", firstName: "Juan", lastName: "Dela Cruz", middleName: "P", yearLevel: "1st Year", course: "BSIT" }];
const HEAD_WITH = "school_year,semester,scholar_id,scholar_name,subject_code,subject_name,units,grade,remarks";
const HEAD_WITHOUT = "school_year,semester,scholar_id,scholar_name,subject_code,subject_name,units,grade";
const parse = (text, existing = []) => B.parseGradeUpload(text, { period: PERIOD, periodStatus: "open", scholars: SCHOLARS, existing, config: CONFIG, letters: [] });
const line = (cells) => cells.join(",");
test("the template now has an optional remarks column, pre-filled with each subject's stored remark", () => {
  assert.equal(B.TEMPLATE_HEADERS.at(-1), "remarks");
  const t = B.buildTemplate(SCHOLARS, [{ id: "g1", scholarIdNumber: "S-1", schoolYear: "2026-2027", semester: "1st Semester", subjectCode: "NSTP1", subject: "NSTP", grade: "1.5", units: 3, excludeFromGwa: true, remarks: "NSTP" }], PERIOD);
  assert.equal(t.rows[0].at(-1), "NSTP");
  assert.equal(t.rows[0].length, t.headers.length);
});
test("a CSV with a remarks column sends the remarks; a CSV without the column sends none (stored remarks are kept)", () => {
  const withCol = parse([HEAD_WITH, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5", "Repeated"])].join("\r\n"));
  assert.equal(withCol.rows[0].status, "valid");
  assert.equal(withCol.rows[0].payload.remarks, "Repeated");
  const without = parse([HEAD_WITHOUT, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5"])].join("\r\n"));
  assert.equal(without.rows[0].payload.remarks, null);
});
test("a remark that is too long is an error on that row", () => {
  const r = parse([HEAD_WITH, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5", "x".repeat(201)])].join("\r\n"));
  assert.equal(r.rows[0].status, "error");
  assert.match(r.rows[0].messages.join(" "), /Remarks are too long/);
});
test("INC and DRP rows upload as valid grades", () => {
  const r = parse([HEAD_WITH, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "INC", ""]), line(["2026-2027", "1st Semester", "S-1", "Juan", "M2", "Physics", "3", "DRP", ""])].join("\r\n"));
  assert.deepEqual(r.rows.map(x => x.status), ["valid", "valid"]);
  assert.deepEqual(r.rows.map(x => x.payload.grade), ["INC", "DRP"]);
});
test("a row whose only change is its remark is NOT 'unchanged', and one with the same remark is", () => {
  const existing = [{ id: "g1", scholarIdNumber: "S-1", schoolYear: "2026-2027", semester: "1st Semester", subjectCode: "M1", subject: "Math", grade: "1.5", units: 3, excludeFromGwa: false, remarks: "NSTP" }];
  const changed = parse([HEAD_WITH, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5", "Repeated"])].join("\r\n"), existing);
  assert.equal(changed.rows[0].action, "update");
  const same = parse([HEAD_WITH, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5", "NSTP"])].join("\r\n"), existing);
  assert.equal(same.rows[0].action, "unchanged");
  const noCol = parse([HEAD_WITHOUT, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5"])].join("\r\n"), existing);
  assert.equal(noCol.rows[0].action, "unchanged");
});
test("header aliases for the remarks column (remark / tag / tags) are understood", () => {
  for (const name of ["remark", "Tag", "tags", "REMARKS"]) {
    const r = parse([HEAD_WITHOUT + "," + name, line(["2026-2027", "1st Semester", "S-1", "Juan", "M1", "Math", "3", "1.5", "NSTP"])].join("\r\n"));
    assert.equal(r.rows[0].payload.remarks, "NSTP", name);
  }
});

console.log("Source guards (Phase 1)");
test("the new highlighting components use readable text (13px or larger) and never rely on colour alone", () => {
  const src = fs.readFileSync(path.join(root, "src/app/components/OutcomeBadge.tsx"), "utf8");
  assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), []);
  for (const word of ["Failed", "DRP", "INC", "Needs review"]) assert.ok(src.includes(word), word);
});
test("the staff, school and scholar grade screens all use the ONE shared outcome rule (no second pass/fail formula)", () => {
  for (const p of ["src/school/components/ScholarGradeEntryModal.tsx", "src/sead/components/ScholarGradesTable.tsx", "src/scholar/components/dashboard/SubjectsGradesPanel.tsx", "src/sead/scholarsMonitoringData.ts"]) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.match(src, /@\/lib\/subjectOutcome/, p);
    assert.equal(/passingMark\s*[<>]/.test(src), false, `${p} must not compare against the passing mark itself`);
  }
});


const R = await bundle("renewal", "src/lib/renewal.ts");
console.log("Renewal wording and helpers (Phase 2)");
test("every stage the database allows has a title, a tone and a short label (and nothing extra)", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p2_application.sql"), "utf8");
  const block = /stage\s+text not null check \(stage in \(([\s\S]*?)\)\),/.exec(sql)[1];
  const dbStages = [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual([...R.RENEWAL_STAGES].sort(), dbStages);
  for (const s of R.RENEWAL_STAGES) { assert.ok(R.STAGE_INFO[s].title && R.STAGE_INFO[s].short && R.STAGE_INFO[s].tone, s); assert.equal(R.stageTitle(s), R.STAGE_INFO[s].title); }
});
test("the stage titles in the database's own wording function match the website's", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p2_application.sql"), "utf8");
  for (const s of R.RENEWAL_STAGES) {
    const m = new RegExp("when '" + s + "' then '([^']+)'").exec(sql);
    assert.ok(m, "no database title for " + s);
    assert.equal(m[1], R.STAGE_INFO[s].title, s);
  }
});
test("every stage sits in exactly one board group, so every application is counted once", () => {
  for (const s of R.RENEWAL_STAGES) assert.equal(R.BOARD_GROUPS.filter(g => g.stages.includes(s)).length, 1, s);
});
test("active and closed stages do not overlap, and match the database's active list", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p2_application.sql"), "utf8");
  const block = /select p_stage in \(([\s\S]*?)\);/.exec(sql)[1];
  const dbActive = [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual([...R.ACTIVE_STAGES].sort(), dbActive);
  assert.equal(R.ACTIVE_STAGES.some(s => R.CLOSED_STAGES.includes(s)), false);
});
test("the semester judged for each term (the owner's table)", () => {
  assert.deepEqual(R.renewalBasis("2026-2027", "1st Semester"), { schoolYear: "2025-2026", term: "2nd Semester" });
  assert.deepEqual(R.renewalBasis("2026-2027", "2nd Semester"), { schoolYear: "2026-2027", term: "1st Semester" });
  assert.deepEqual(R.renewalBasis("2026-2027", "Summer"), { schoolYear: "2026-2027", term: "2nd Semester" });
  assert.equal(R.renewalBasis("nonsense", "Summer"), null);
});
test("a renewal window is upcoming, open, late or closed by Philippine date", () => {
  const at = iso => new Date(iso);
  assert.equal(R.windowState("2026-10-01", "2026-10-31", true, at("2026-09-30T10:00:00+08:00")), "upcoming");
  assert.equal(R.windowState("2026-10-01", "2026-10-31", true, at("2026-10-01T00:30:00+08:00")), "open");
  assert.equal(R.windowState("2026-10-01", "2026-10-31", true, at("2026-10-31T23:30:00+08:00")), "open");
  assert.equal(R.windowState("2026-10-01", "2026-10-31", true, at("2026-11-01T00:30:00+08:00")), "late");
  assert.equal(R.windowState("2026-10-01", "2026-10-31", false, at("2026-11-01T00:30:00+08:00")), "closed");
  // 11:30 pm in Manila is still that calendar day even though it is already the next day in some other time zones
  assert.equal(R.manilaToday(at("2026-10-13T23:30:00+08:00")), "2026-10-13");
  assert.equal(R.manilaToday(at("2026-10-13T16:30:00Z")), "2026-10-14");
});
test("days left and the deadline wording (calendar days, Philippine time)", () => {
  const now = new Date("2026-10-13T09:00:00+08:00");
  assert.equal(R.daysUntil("2026-10-25", now), 12);
  assert.equal(R.daysUntil("2026-10-13", now), 0);
  assert.equal(R.daysUntil("2026-10-03", now), -10);
  assert.equal(R.daysUntil(null, now), null);
  assert.equal(R.daysLeftText(null), "Deadline: to be set at consultation");
  assert.equal(R.daysLeftText(12), "12 days left");
  assert.equal(R.daysLeftText(1), "1 day left");
  assert.equal(R.daysLeftText(0), "Due today");
  assert.equal(R.daysLeftText(-1), "1 day past the deadline");
  assert.equal(R.daysLeftText(-10), "10 days past the deadline");
});
test("the file checks match the database's (type, 10 MB, 3 per kind, not empty)", () => {
  const f = (type, size = 100) => ({ name: "a.pdf", type, size });
  assert.equal(R.validateRenewalFile(f("application/pdf"), 0), null);
  assert.equal(R.validateRenewalFile(f("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), 2), null);
  assert.match(R.validateRenewalFile(f("application/zip"), 0), /PDF, Word/);
  assert.match(R.validateRenewalFile(f("application/pdf", 11 * 1024 * 1024), 0), /10 MB/);
  assert.match(R.validateRenewalFile(f("application/pdf", 0), 0), /empty/);
  assert.match(R.validateRenewalFile(f("application/pdf"), 3), /at most 3/);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p2_application.sql"), "utf8");
  for (const mime of ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) assert.ok(sql.includes("'" + mime + "'"), mime);
});
test("the storage path is the folder the database guard expects, and a hostile file name cannot escape it", () => {
  const p = R.renewalDocumentPath("TEST-0003", "rec-1", "study_plan", "../../my plan (final).pdf", "uuid-1");
  assert.ok(p.startsWith("TEST-0003/rec-1/study_plan/uuid-1-"), p);
  assert.equal(p.split("/").length, 4, p);
  assert.equal(p.includes(".."), false, p);
  assert.ok(R.renewalDocumentPath("X", "r", "inc_letter", "ฟ.pdf", "u").endsWith(".pdf"));
});
test("plain next steps for the scholar, in order, for the main cases", () => {
  const ev = (docs = []) => ({ required_documents: docs, sdp: { applicable: true, complied: false, missing: "Formation Program: 2 of 3" }, grades: { reason: "Your school has not submitted its grades for 2nd Semester 2025-2026 yet." } });
  assert.match(R.scholarNextSteps("sdp_on_hold", ev())[0], /Formation Program: 2 of 3/);
  assert.match(R.scholarNextSteps("waiting_grades", ev())[0], /has not submitted/);
  const study = R.scholarNextSteps("needs_study_plan_consultation", ev([{ kind: "study_plan", label: "Study plan", satisfied: false }]));
  assert.match(study[0], /Upload your study plan/); assert.match(study[1], /consultation/);
  const inc = R.scholarNextSteps("needs_inc_letter_consultation", ev([{ kind: "inc_letter", label: "INC letter from your dean", satisfied: false }]));
  assert.match(inc[0], /INC letter from your dean/);
  const wait = R.scholarNextSteps("inc_waiting_compliance", ev(), { incDeadlines: [{ subject: "Math", deadline: "2026-10-25" }, { subject: "Art", deadline: null }] });
  assert.match(wait[0], /Complete your INC in Math by .*2026/); assert.match(wait[1], /Deadline: to be set at consultation/);
  assert.match(R.scholarNextSteps("returned", ev(), { evaluatorComment: "Please fix X" })[0], /Please fix X/);
  assert.match(R.scholarNextSteps("ready_for_confirmation", ev())[0], /Waiting for the evaluator/);
  for (const s of R.RENEWAL_STAGES) assert.ok(R.scholarNextSteps(s, ev()).length >= 1, "no next step for " + s);
});

console.log("Source guards (Phase 2)");
const p2files = [
  "src/lib/renewal.ts", "src/app/components/RenewalStageBadge.tsx", "src/scholar/components/dashboard/RenewalPanel.tsx", "src/scholar/components/dashboard/NotificationBell.tsx",
  "src/sead/ScholarRenewalPage.tsx", "src/sead/renewal/RenewalBoardTab.tsx", "src/sead/renewal/RenewalLateTab.tsx", "src/sead/renewal/RenewalNotAppliedTab.tsx",
  "src/sead/renewal/RenewalIncTab.tsx", "src/sead/renewal/RenewalWindowsTab.tsx", "src/sead/renewal/RenewalDetailView.tsx", "src/sead/renewal/ReasonDialog.tsx",
];
test("the new renewal screens use readable text (13px and up, no pale greys, no pale-blue links)", () => {
  for (const p of p2files) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p + " uses a pale grey or the old link blue");
  }
});
test("the renewal screens only ask the database (no direct writes to renewal tables, no second copy of the rules)", () => {
  const direct = /\.from\("renewal_(records|history|inc_items|windows)"\)\s*\.(insert|update|delete)/;
  for (const p of [...p2files, "src/scholar/renewalApi.ts", "src/sead/renewalApi.ts"]) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.equal(direct.test(src), false, p);
    assert.equal(/failed_effective\s*(>=|>|<|===)\s*[12]/.test(src), false, p + " must not re-implement the failed-subject rule");
  }
});
test("the Scholar Renewal tool is gated by its own tag, in the same places as the other tools", () => {
  const tags = fs.readFileSync(path.join(root, "src/app/staffToolTags.ts"), "utf8");
  assert.match(tags, /key: "scholar_renewal_evaluator"/);
  const app = fs.readFileSync(path.join(root, "src/app/App.tsx"), "utf8");
  assert.match(app, /case "scholarRenewal": return user\.tags\.includes\("scholar_renewal_evaluator"\)/);
  assert.match(app, /page==="scholarRenewal" && currentUser\.tags\.includes\("scholar_renewal_evaluator"\)/);
  assert.match(app, /"scholarRenewal", "scanningTools"\]/, "PAGE_VALUES");
  assert.match(fs.readFileSync(path.join(root, "src/app/components/Sidebar.tsx"), "utf8"), /user\.tags\.includes\("scholar_renewal_evaluator"\)/);
});


console.log("Appointments: wording and helpers (Phase 3)");
test("slot times are shown in Philippine time", () => {
  assert.equal(R.formatTimeOnly("2026-10-20T01:10:00Z"), "9:10 AM");
  assert.equal(R.formatSlot("2026-10-20T01:10:00Z"), "Tue, Oct 20 · 9:10 AM");
  assert.equal(R.formatSlot("2026-10-20T17:30:00Z"), "Wed, Oct 21 · 1:30 AM", "late evening UTC is already the next day in Manila");
  assert.equal(R.formatSlot(null), "—");
  assert.equal(R.manilaDay("2026-10-20T17:30:00Z"), "2026-10-21");
});
test("the 12-hour rule: 13 hours before can still change, 11 hours cannot, exactly 12 can", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  assert.equal(R.canChangeBooking("2026-10-20T13:00:00Z", now), true);
  assert.equal(R.canChangeBooking("2026-10-20T11:00:00Z", now), false);
  assert.equal(R.canChangeBooking("2026-10-20T12:00:00Z", now), true);
  assert.equal(R.CONSULT_CHANGE_CUTOFF_HOURS, 12);
  assert.equal(R.hoursUntil("2026-10-20T11:00:00Z", now), 11);
});
test("the 12-hour rule on the website is the same number the database uses", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p3_appointments.sql"), "utf8");
  assert.ok((sql.match(/interval '12 hours'/g) ?? []).length >= 5);
  assert.equal(/interval '(1[013]|[2-9]) hours'/.test(sql), false, "no other cutoff hours");
});
test("slots are grouped by Philippine day, in time order", () => {
  const g = R.groupSlotsByDay([{ startsAt: "2026-10-21T01:10:00Z" }, { startsAt: "2026-10-20T01:00:00Z" }, { startsAt: "2026-10-20T16:30:00Z" }, { startsAt: "2026-10-20T01:10:00Z" }]);
  assert.deepEqual(g.map(d => d.day), ["2026-10-20", "2026-10-21"]);
  assert.deepEqual(g[0].slots.map(s => s.startsAt), ["2026-10-20T01:00:00Z", "2026-10-20T01:10:00Z"]);
  assert.equal(g[1].slots.length, 2, "16:30 UTC is 00:30 the next day in Manila");
});
test("the staff form builds Manila instants and counts whole 10-minute slots", () => {
  assert.equal(R.manilaInstant("2026-10-20", "09:00"), "2026-10-20T01:00:00.000Z");
  assert.equal(R.manilaInstant("2026-10-20", "9:00"), null);
  assert.equal(R.manilaInstant("", "09:00"), null);
  assert.equal(R.slotCount("2026-10-20T01:00:00.000Z", "2026-10-20T03:00:00.000Z"), 12);
  assert.equal(R.slotCount("2026-10-20T01:00:00.000Z", "2026-10-20T01:25:00.000Z"), null);
  assert.equal(R.slotCount("2026-10-20T03:00:00.000Z", "2026-10-20T01:00:00.000Z"), null);
});
test("next steps with a booking, without one, after a no-show, and once the consultation is done", () => {
  const ev = { required_documents: [], sdp: { applicable: true, complied: true, missing: null }, grades: { reason: "" } };
  const booked = R.scholarNextSteps("needs_study_plan_consultation", ev, { consultNeeded: true, booking: { startsAt: "2026-10-20T01:10:00Z", staffName: "Ms. Cruz" } });
  assert.match(booked.join(" "), /Come to your face-to-face consultation on Tue, Oct 20 · 9:10 AM with Ms\. Cruz/);
  assert.match(R.scholarNextSteps("needs_study_plan_consultation", ev, { consultNeeded: true })[0], /Book your face-to-face consultation/);
  assert.match(R.scholarNextSteps("needs_study_plan_consultation", ev, { consultNeeded: true, noShow: true })[0], /You missed your consultation/);
  const summer = R.scholarNextSteps("summer_requirements", ev, { consultNeeded: true, isSummer: true, booking: { startsAt: "2026-10-20T01:10:00Z", staffName: "Ms. Cruz" } });
  assert.match(summer.join(" "), /Bring the hard copy of your prospectus/);
  const done = R.scholarNextSteps("needs_study_plan_consultation", { ...ev, required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: false }] }, { consultNeeded: false });
  assert.deepEqual(done, ["Upload your study plan.", "Your consultation is done."]);
  assert.match(R.scholarNextSteps("needs_consultation_division_head", ev, { consultNeeded: false })[0], /Division Head will decide/);
  assert.match(R.scholarNextSteps("summer_requirements", ev, { consultNeeded: false, isSummer: true }).join(" "), /hard copy/);
});

console.log("Source guards (Phase 3)");
const p3files = [
  "src/sead/appointmentsApi.ts", "src/sead/appointments/AppointmentsTab.tsx", "src/sead/appointments/SlotDetailModal.tsx",
  "src/scholar/components/dashboard/RenewalPanel.tsx", "src/sead/pages/ProbationMonitoringTab.tsx",
];
test("the appointment screens use readable text (13px and up, no pale greys, no pale-blue links)", () => {
  for (const p of p3files.filter(x => !/ProbationMonitoringTab/.test(x))) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
});
test("the appointment screens only ask the database (no direct writes to slots, availability or history tables)", () => {
  const direct = /\.from\("(counseling_slots|counseling_availability|counseling_booking_history)"\)\s*\.(insert|update|delete|upsert)/;
  for (const p of p3files) assert.equal(direct.test(fs.readFileSync(path.join(root, p), "utf8")), false, p);
  const scholarApi = fs.readFileSync(path.join(root, "src/scholar/renewalApi.ts"), "utf8");
  for (const fn of ["renewal_open_slots", "renewal_book_slot", "renewal_reschedule_slot", "renewal_cancel_booking"]) assert.ok(scholarApi.includes(`"${fn}"`), fn);
  const staffApi = fs.readFileSync(path.join(root, "src/sead/appointmentsApi.ts"), "utf8");
  for (const fn of ["counseling_availability_save", "counseling_availability_delete", "counseling_my_slots", "counseling_mark_slot", "counseling_save_daily_record", "renewal_extend_inc_deadline"]) assert.ok(staffApi.includes(`"${fn}"`), fn);
});
test("the Appointments subtab sits inside the existing Consultation Tool (same tag), and every function the website calls exists in the migration", () => {
  const page = fs.readFileSync(path.join(root, "src/sead/ScholarCounselingToolPage.tsx"), "utf8");
  assert.match(page, /key: "appointments"/);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p3_appointments.sql"), "utf8") + fs.readFileSync(path.join(root, "supabase_migration_renewal_p2_application.sql"), "utf8");
  const called = new Set();
  for (const p of ["src/sead/appointmentsApi.ts", "src/scholar/renewalApi.ts", "src/sead/renewalApi.ts"]) for (const m of fs.readFileSync(path.join(root, p), "utf8").matchAll(/rpc\("([a-z_]+)"/g)) called.add(m[1]);
  const missing = [...called].filter(fn => !new RegExp(`create (or replace )?function public\\.${fn}\\(`).test(sql));
  assert.deepEqual(missing, []);
});
test("the scholar-facing messages never show a time in UTC or the browser's own time zone", () => {
  const lib = fs.readFileSync(path.join(root, "src/lib/renewal.ts"), "utf8");
  for (const fn of ["formatSlot", "formatTimeOnly", "formatDay", "formatDateTime"]) {
    const body = new RegExp(`export function ${fn}[\\s\\S]*?\\n}`).exec(lib)?.[0] ?? "";
    assert.match(body, /timeZone: (MANILA|"Asia\/Manila")|formatTimeOnly/, fn);
  }
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
