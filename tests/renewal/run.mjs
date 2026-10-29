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
  assert.match(wait[0], /Complete your INC in Math by .*2026/); assert.match(wait[1], /Deadline: to be set at your consultation/);
  assert.match(R.scholarNextSteps("returned", ev(), { evaluatorComment: "Please fix X" })[0], /Please fix X/);
  assert.match(R.scholarNextSteps("ready_for_confirmation", ev())[0], /Waiting for evaluator confirmation/);
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
  assert.match(app, /case "scholarRenewal": return canSeeScholarRenewal\(user\)/);
  assert.match(app, /page==="scholarRenewal" && canSeeScholarRenewal\(currentUser\)/);
  assert.match(app, /"scholarRenewal", "scanningTools"(, "storageTool")?]/, "PAGE_VALUES");
  assert.match(fs.readFileSync(path.join(root, "src/app/components/Sidebar.tsx"), "utf8"), /canSeeScholarRenewal\(user\)/);
});


console.log("Appointments: wording and helpers (Phase 3)");
test("a booking is shown as a day and a morning or afternoon in Philippine time (never an exact time)", () => {
  assert.equal(R.formatTimeOnly("2026-10-20T01:10:00Z"), "9:10 AM");
  assert.equal(R.formatSlot("2026-10-20T01:10:00Z"), "Tue, Oct 20 · morning (AM)");
  assert.equal(R.formatSlot("2026-10-20T04:00:00Z"), "Tue, Oct 20 · afternoon (PM)", "12:00 noon in Manila is the afternoon");
  assert.equal(R.formatSlot("2026-10-20T03:59:00Z"), "Tue, Oct 20 · morning (AM)", "11:59 in Manila is still the morning");
  assert.equal(R.formatSlot("2026-10-20T17:30:00Z"), "Wed, Oct 21 · morning (AM)", "late evening UTC is already the next day (1:30 AM) in Manila");
  assert.equal(R.formatSlot("2026-10-20T16:00:00Z"), "Wed, Oct 21 · morning (AM)", "midnight in Manila is the morning of the new day, not 24:00");
  assert.equal(R.formatSlotShort("2026-10-20T07:00:00Z"), "Oct 20, afternoon (PM)");
  assert.equal(R.formatSlot(null), "—");
  assert.equal(R.manilaDay("2026-10-20T17:30:00Z"), "2026-10-21");
});
test("the morning / afternoon rule and the minutes of a range match the database (_consult_half, _consult_blocks)", () => {
  assert.equal(R.consultHalf("2026-10-20T03:59:59Z"), "AM");
  assert.equal(R.consultHalf("2026-10-20T04:00:00Z"), "PM");
  assert.equal(R.consultHalf("2026-10-20T16:00:00Z"), "AM");
  // 9:00 to 11:00 is 120 morning minutes; 11:00 to 13:00 is 60 + 60; 12:00 to 14:00 is all afternoon
  assert.equal(R.rangeMinutesIn("2026-10-20T01:00:00.000Z", "2026-10-20T03:00:00.000Z", "2026-10-20", "AM"), 120);
  assert.equal(R.rangeMinutesIn("2026-10-20T01:00:00.000Z", "2026-10-20T03:00:00.000Z", "2026-10-20", "PM"), 0);
  assert.equal(R.rangeMinutesIn("2026-10-20T03:00:00.000Z", "2026-10-20T05:00:00.000Z", "2026-10-20", "AM"), 60);
  assert.equal(R.rangeMinutesIn("2026-10-20T03:00:00.000Z", "2026-10-20T05:00:00.000Z", "2026-10-20", "PM"), 60);
  assert.equal(R.rangeMinutesIn("2026-10-20T04:00:00.000Z", "2026-10-20T06:00:00.000Z", "2026-10-20", "PM"), 120);
  assert.equal(R.rangeMinutesIn("2026-10-20T01:00:00.000Z", "2026-10-20T03:00:00.000Z", "2026-10-21", "AM"), 0, "another day");
  assert.equal(R.rangeMinutes("2026-10-20T01:00:00.000Z", "2026-10-20T03:00:00.000Z"), 120);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_consultation_types_b_booking.sql"), "utf8");
  assert.match(sql, /< 12 then 'AM' else 'PM'/, "the database splits morning and afternoon at 12:00 noon Philippine time");
  assert.match(sql, /\('AM', interval '0 hours', interval '12 hours'\), \('PM', interval '12 hours', interval '24 hours'\)/);
});
test("the consultation types and their minutes are what the owner set", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_consultation_types_b_booking.sql"), "utf8");
  for (const row of ["'inc', 'INC (incomplete)', 8", "'ip', 'IP (in progress)', 5", "'gwa', 'GWA (did not reach the minimum threshold)', 5", "'one_failed', '1 Failed', 10",
                     "'two_plus_failed', '2 or more Failed', 15", "'personal', 'Personal concern', 25", "'ethical', 'Ethical concern (e.g., bullying)', 20"]) assert.ok(sql.includes(row), row);
});
test("the scholar's booking screen asks the database for the types and the open mornings and afternoons, and falls back to the old picker when the update has not been run", () => {
  const api = fs.readFileSync(path.join(root, "src/scholar/renewalApi.ts"), "utf8");
  for (const fn of ["renewal_consult_types", "renewal_open_blocks", "renewal_book_consultation", "renewal_reschedule_consultation"]) assert.ok(api.includes(`"${fn}"`), fn);
  assert.match(api, /PGRST202/, "a missing function is recognised");
  const section = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ConsultationSection.tsx"), "utf8");
  assert.match(section, /ConsultationBlockPicker/);
  assert.match(section, /legacy/, "the old picker stays as the fallback");
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
  assert.match(booked.join(" "), /Come to your face-to-face consultation on Oct 20, morning [(]AM[)], with Ms\. Cruz/);
  assert.match(R.scholarNextSteps("needs_study_plan_consultation", ev, { consultNeeded: true })[0], /Book your consultation/);
  assert.match(R.scholarNextSteps("needs_study_plan_consultation", ev, { consultNeeded: true, noShow: true })[0], /You missed your consultation/);
  const summer = R.scholarNextSteps("summer_requirements", ev, { consultNeeded: true, isSummer: true, booking: { startsAt: "2026-10-20T01:10:00Z", staffName: "Ms. Cruz" } });
  assert.match(summer.join(" "), /Bring your prospectus hard copy to your consultation/);
  const done = R.scholarNextSteps("needs_study_plan_consultation", { ...ev, required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: false }] }, { consultNeeded: false });
  assert.deepEqual(done, ["Upload your study plan.", "Your consultation is done."]);
  assert.match(R.scholarNextSteps("needs_consultation_division_head", ev, { consultNeeded: false })[0], /Division Head will decide/);
  assert.match(R.scholarNextSteps("summer_requirements", ev, { consultNeeded: false, isSummer: true }).join(" "), /hard copy/);
});

test("a study plan that is not approved yet: the scholar is told to wait, and that booking follows the approval", () => {
  const plan = approved => [{ kind: "study_plan", label: "Study plan", satisfied: true, approved }];
  const base = { sdp: { applicable: true, complied: true, missing: null }, grades: { reason: "" } };
  const pending = R.scholarNextSteps("needs_study_plan_consultation", { ...base, required_documents: plan(false) }, { consultState: "study_plan_pending" });
  assert.deepEqual(pending, ["Wait for the evaluator to approve your study plan. Then you can book your consultation."]);
  const missing = R.scholarNextSteps("needs_study_plan_consultation", { ...base, required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: false, approved: false }] }, { consultState: "study_plan_missing" });
  assert.match(missing[0], /Upload your study plan/); assert.match(missing[1], /After the evaluator approves your study plan, you can book your consultation/);
  const ok = R.scholarNextSteps("needs_study_plan_consultation", { ...base, required_documents: plan(true) }, { consultState: "ok" });
  assert.match(ok.join(" "), /Book your consultation/);
  const booked = R.scholarNextSteps("needs_study_plan_consultation", { ...base, required_documents: plan(true) }, { consultState: "ok", booking: { startsAt: "2026-10-20T01:10:00Z", staffName: "Ms. Cruz" } });
  assert.match(booked.join(" "), /Come to your face-to-face consultation/);
  assert.deepEqual(R.scholarNextSteps("needs_study_plan_consultation", { ...base, required_documents: plan(true) }, { consultState: "not_needed" }), ["Your consultation is done."]);
});
test("the INC letter needs approval too: the same waiting messages, worded for the INC letter", () => {
  const ev = { required_documents: [{ kind: "inc_letter", label: "INC letter from your dean", satisfied: true, approved: false }], sdp: { applicable: true, complied: true, missing: null }, grades: { reason: "" } };
  assert.equal(R.consultBlockedBy("inc_letter_pending"), "INC letter");
  assert.equal(R.consultBlockedBy("study_plan_missing"), "study plan");
  assert.equal(R.consultBlockedBy("ok"), null);
  const pend = R.scholarNextSteps("needs_inc_letter_consultation", ev, { consultState: "inc_letter_pending" });
  assert.equal(pend[0], "Wait for the evaluator to approve your INC letter. Then you can book your consultation.");
  const missing = R.scholarNextSteps("needs_inc_letter_consultation", { ...ev, required_documents: [{ kind: "inc_letter", label: "INC letter from your dean", satisfied: false }] }, { consultState: "inc_letter_missing" });
  assert.match(missing.join(" "), /Upload the INC letter from your dean/); assert.match(missing.join(" "), /After the evaluator approves your INC letter, you can book/);
});
test("the website's consultation states are the ones the database returns", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p3_appointments.sql"), "utf8");
  for (const s of ["not_needed", "study_plan_missing", "study_plan_pending", "ok"]) assert.ok(sql.includes("'" + s + "'"), s);
  assert.ok(sql.includes("v_kind || '_missing'") && sql.includes("v_kind || '_pending'") && sql.includes("'inc_letter'"));
  const api = fs.readFileSync(path.join(root, "src/scholar/renewalApi.ts"), "utf8");
  for (const s of ["study_plan_missing", "study_plan_pending", "not_needed"]) assert.ok(api.includes(s), s);
});

const SUM = await bundle("summary", "src/scholar/renewalSummary.ts");
console.log("Tracker, next steps and tile summaries (Phase 4)");
const win = (record, extra = {}) => ({ window: { id: "w1", schoolYear: "2026-2027", term: "1st Semester", opensOn: "2026-10-01", closesOn: "2026-10-31", lateAllowed: true, note: "" }, state: "open", record,
  documents: [], history: [], incItems: [], booking: null, consultNeeded: false, consultState: "not_needed", ...extra });
const rec = (stage, evaluation = {}, extra = {}) => ({ id: "r1", stage, isLate: false, lateReason: null, appliedAt: null, ruleCode: null, ruleText: null, evaluation, scholarNote: "", evaluatorComment: null, result: null, confirmedAt: null, noShowFlag: false, ...extra });
test("SDP on hold says exactly what is missing, per category, in the scholar's words (scenario 2)", () => {
  const steps = R.sdpShortfallSteps({ applicable: true, complied: false, missing: "x", community_service: 3, community_volunteerism: 3, formation_program: 2 });
  assert.deepEqual(steps, ["Complete Formation Program: 1 more credit."]);
  assert.deepEqual(R.sdpShortfallSteps({ applicable: true, complied: false, missing: "x", community_service: 1, community_volunteerism: 3, formation_program: 0 }), ["Complete Institutional Volunteerism: 2 more credits.", "Complete Formation Program: 3 more credits."]);
  const full = R.scholarNextSteps("sdp_on_hold", { sdp: { applicable: true, complied: false, missing: "Formation Program: 2 of 3", community_service: 3, community_volunteerism: 3, formation_program: 2 } });
  assert.equal(full[0], "Complete Formation Program: 1 more credit.");
  assert.match(full[1], /check again automatically/);
});
test("the example sentences from the owner's list, word for word", () => {
  const ev = (docs) => ({ required_documents: docs, sdp: { applicable: true, complied: true, missing: null } });
  assert.deepEqual(R.scholarNextSteps("needs_study_plan_consultation", ev([{ kind: "study_plan", label: "Study plan", satisfied: false, approved: false }]), { consultState: "study_plan_missing" }).slice(0, 1), ["Upload your study plan."]);
  assert.deepEqual(R.scholarNextSteps("needs_inc_letter_consultation", ev([{ kind: "inc_letter", label: "INC letter from your dean", satisfied: false, approved: false }]), { consultState: "inc_letter_missing" }).slice(0, 1), ["Upload the INC letter from your dean."]);
  assert.deepEqual(R.scholarNextSteps("summer_requirements", ev([{ kind: "prospectus", label: "Prospectus", satisfied: false }]), { consultState: "ok" }).slice(0, 1), ["Upload your prospectus."]);
  assert.match(R.scholarNextSteps("summer_requirements", ev([{ kind: "prospectus", label: "Prospectus", satisfied: true }]), { consultState: "ok" }).join(" "), /Book your consultation/);
  assert.match(R.scholarNextSteps("summer_requirements", ev([{ kind: "prospectus", label: "Prospectus", satisfied: true }]), { consultState: "ok", isSummer: true, booking: { startsAt: "2026-10-20T01:10:00Z", staffName: "Ms. Cruz" } })[0], /^Bring your prospectus hard copy to your consultation on Oct 20, morning [(]AM[)]/);
  const now = new Date();
  const dl = new Date(now.getTime() + 12 * 86400000).toISOString().slice(0, 10);
  assert.match(R.scholarNextSteps("inc_waiting_compliance", ev([]), { incDeadlines: [{ subject: "Math", deadline: dl }] })[0], /^Complete your INC in Math by .+: (11|12|13) days left\.$/);
  assert.equal(R.scholarNextSteps("ready_for_confirmation", ev([]))[0], "Waiting for evaluator confirmation.");
});
test("the progress tracker for the main cases: where the scholar is, and the steps their case needs", () => {
  const label = steps => steps.map(s => s.label + ":" + s.state).join(" | ");
  // 1: all passed -> waiting for the evaluator
  const p1 = R.renewalProgress("ready_for_confirmation", { required_documents: [], consultation_required: false });
  assert.equal(label(p1), "Applied:done | SDP and grades checked:done | Evaluator confirmation:current | Renewed:todo");
  // 2: SDP on hold -> stuck at the check, nothing after it is guessed
  const p2 = R.renewalProgress("sdp_on_hold", {});
  assert.equal(p2[1].state, "problem"); assert.equal(p2[1].note, "On hold: SDP"); assert.equal(p2.length, 4);
  // 4: study plan + consultation: documents is the current step until the plan is uploaded AND approved
  const ev4 = (approved, satisfied = true, done = false) => ({ required_documents: [{ kind: "study_plan", label: "Study plan", satisfied, approved }], consultation_required: true, consultation_done: done, rule_code: "B" });
  assert.equal(label(R.renewalProgress("needs_study_plan_consultation", ev4(false, false))), "Applied:done | SDP and grades checked:done | Upload your documents:current | Consultation:todo | Division Head decision:todo | Renewed:todo");
  const waiting = R.renewalProgress("needs_study_plan_consultation", ev4(false));
  assert.equal(waiting[2].state, "current"); assert.equal(waiting[2].note, "Waiting for approval");
  const approved = R.renewalProgress("needs_study_plan_consultation", ev4(true), { hasBooking: false });
  assert.equal(approved[2].state, "done"); assert.equal(approved[3].state, "current");
  assert.equal(R.renewalProgress("needs_study_plan_consultation", ev4(true), { hasBooking: true })[3].label, "Consultation booked");
  assert.equal(R.renewalProgress("ready_to_endorse", ev4(true, true, true)).find(s => s.key === "decision").state, "current");
  // 6: 2 failed -> the Division Head decides
  assert.equal(R.renewalProgress("needs_consultation_division_head", { required_documents: [], consultation_required: true, consultation_done: false, rule_code: "C2" }).find(s => s.key === "decision").label, "Division Head decision");
  // 10 / 11: INC: letter + consultation, then complete the INC
  const inc = R.renewalProgress("inc_waiting_compliance", { required_documents: [{ kind: "inc_letter", label: "INC", satisfied: true, approved: true }], consultation_required: true, consultation_done: true, open_inc: 1, rule_code: "D" });
  assert.equal(inc.find(s => s.key === "inc").state, "current"); assert.equal(inc.find(s => s.key === "decision").state, "todo");
  const incMissingLetter = R.renewalProgress("inc_waiting_compliance", { required_documents: [{ kind: "inc_letter", label: "INC", satisfied: false, approved: false }], consultation_required: true, consultation_done: true, open_inc: 1 });
  assert.equal(incMissingLetter.find(s => s.key === "inc").state, "current", "the INC deadline is the current step even if a document is still missing");
  assert.equal(incMissingLetter.filter(s => s.state === "current").length, 1);
  assert.equal(R.renewalProgress("inc_deadline_passed", { required_documents: [], consultation_required: true, consultation_done: true, open_inc: 1 }).find(s => s.key === "inc").note, "Deadline passed");
  // 22 / 24: Summer: prospectus + consultation always
  const sm = R.renewalProgress("summer_requirements", { required_documents: [{ kind: "prospectus", label: "Prospectus", satisfied: false }], consultation_required: true, consultation_done: false, rule_code: "A+S" });
  assert.equal(label(sm), "Applied:done | SDP and grades checked:done | Upload your documents:current | Consultation:todo | Evaluator confirmation:todo | Renewed:todo");
  // renewed, returned, late
  assert.ok(R.renewalProgress("renewed", { required_documents: [] }).every(s => s.state === "done"));
  assert.equal(R.renewalProgress("returned", {}).find(s => s.key === "fix").state, "problem");
  assert.equal(R.renewalProgress("late_pending", {})[0].state, "current");
  assert.equal(R.renewalProgress("late_declined", {}).length, 1);
  assert.deepEqual(R.renewalProgress("not_required", {}), []);
  for (const s of R.RENEWAL_STAGES) assert.doesNotThrow(() => R.renewalProgress(s, { required_documents: [], rule_code: "A" }), s);
});
test("exactly one step is 'current' or 'problem' while the application is open", () => {
  for (const s of R.ACTIVE_STAGES) {
    const steps = R.renewalProgress(s, { required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: false }], consultation_required: true, consultation_done: false, open_inc: 1, rule_code: "B" });
    assert.equal(steps.filter(x => x.state === "current" || x.state === "problem").length, 1, s + ": " + steps.map(x => x.key + ":" + x.state).join(","));
  }
});
test("the study plan form is found by its title (the office adds it in Forms Management)", () => {
  for (const ok of ["Study Plan Form", "study-plan", "Scholar STUDY_PLAN template", "StudyPlan"]) assert.equal(R.isStudyPlanFormTitle(ok), true, ok);
  for (const no of ["Scholarship Handbook", "Plan of study", "Referral Form"]) assert.equal(R.isStudyPlanFormTitle(no), false, no);
});
test("the tile chips and the home banner say the most important thing first", () => {
  const apply = win(null);
  assert.match(SUM.renewalAttention([apply]).headline, /Renewal for 1st Semester 2026-2027 is open\. Renew your scholarship before Oct 31, 2026\./);
  assert.equal(SUM.renewalAttention([apply]).actionNeeded, true);
  assert.deepEqual(SUM.renewalTileChip([apply]), { text: "Action needed", tone: "action" });
  const waiting = win(rec("ready_for_confirmation", { required_documents: [] }));
  assert.equal(SUM.renewalAttention([waiting]).actionNeeded, false);
  assert.deepEqual(SUM.renewalTileChip([waiting]), { text: "In progress", tone: "waiting" });
  const needs = win(rec("needs_study_plan_consultation", { required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: false }] }), { consultState: "study_plan_missing", consultNeeded: false });
  assert.equal(SUM.renewalAttention([waiting, needs]).actionNeeded, true, "an action beats waiting");
  assert.equal(SUM.renewalAttention([waiting, needs]).headline, "Upload your study plan.");
  const bookedAndWaiting = win(rec("needs_study_plan_consultation", { required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: true, approved: true }] }), { booking: { slotId: "s", startsAt: "2026-10-20T01:10:00Z", endsAt: "2026-10-20T01:20:00Z", staffName: "Ms. Cruz", canChange: true }, consultState: "ok", consultNeeded: true });
  assert.equal(SUM.scholarActsNow(bookedAndWaiting), false, "a booked consultation is not something to do right now");
  assert.equal(SUM.renewalAttention([bookedAndWaiting]).actionNeeded, false);
  assert.match(SUM.renewalAttention([bookedAndWaiting]).headline, /^Come to your face-to-face consultation on Oct 20, morning [(]AM[)]/);
  assert.equal(SUM.scholarActsNow(win(rec("needs_study_plan_consultation", { required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: true, approved: true }] }), { consultState: "ok", consultNeeded: true })), true, "approved plan, nothing booked yet: book");
  assert.equal(SUM.scholarActsNow(win(rec("needs_study_plan_consultation", { required_documents: [{ kind: "study_plan", label: "Study plan", satisfied: true, approved: false }] }), { consultState: "study_plan_pending" })), false, "waiting for approval is not an action");
  assert.equal(SUM.scholarActsNow(win(rec("inc_waiting_compliance", { required_documents: [] }))), true, "complete your INC");
  const done = win(rec("renewed", {}));
  assert.equal(SUM.renewalAttention([done]), null);
  assert.deepEqual(SUM.renewalTileChip([done]), { text: "Renewed for 1st Semester 2026-2027", tone: "done" });
  assert.equal(SUM.renewalAttention([]), null);
  assert.equal(SUM.renewalTileChip([]), null);
  const booked = win(rec("needs_study_plan_consultation", { required_documents: [] }), { booking: { slotId: "s", startsAt: "2026-10-20T01:10:00Z", endsAt: "2026-10-20T01:20:00Z", staffName: "Ms. Cruz", canChange: true }, consultState: "ok", consultNeeded: true });
  assert.deepEqual(SUM.consultationTileChip([booked]), { text: "Booked: Oct 20, morning (AM)", tone: "done" });
  assert.deepEqual(SUM.consultationTileChip([win(rec("needs_study_plan_consultation", {}), { consultState: "ok", consultNeeded: true })]), { text: "Book your consultation", tone: "action" });
  assert.deepEqual(SUM.consultationTileChip([win(rec("needs_study_plan_consultation", {}), { consultState: "study_plan_pending" })]), { text: "Waiting for approval", tone: "waiting" });
  assert.equal(SUM.consultationTileChip([waiting]), null);
});

console.log("A study plan form for each school (Phase 4)");
test("the old title rule is only a safety net when no template was uploaded", () => {
  const own = { title: "Form of my school" }, a = { title: "Study Plan Form", isUnlocked: true }, b = { title: "Study plan (locked)", isUnlocked: false }, c = { title: "Scholar Contract", isUnlocked: true };
  assert.equal(R.pickStudyPlanForm(own, [a]), own, "the chosen form beats a title match");
  assert.equal(R.pickStudyPlanForm(null, [c, b, a]), a, "no choice: an openable form with 'study plan' in its title");
  assert.equal(R.pickStudyPlanForm(null, [c, b]), null, "locked or unrelated forms are never picked by title");
  assert.equal(R.isStudyPlanFormTitle("Study-Plan 2026"), true); assert.equal(R.isStudyPlanFormTitle("Contract"), false);
});
test("a study plan template must be a PDF or Word file, not empty, up to 10 MB (judged by the file name, since browsers often give Word files no type)", () => {
  const ok = n => R.validateStudyPlanTemplate({ name: n, size: 5000 });
  assert.equal(ok("plan.pdf"), null); assert.equal(ok("Plan v2.DOCX"), null); assert.equal(ok("old.doc"), null);
  assert.match(ok("plan.png"), /PDF or Word/); assert.match(ok("plan"), /PDF or Word/); assert.match(ok("plan.pdf.exe"), /PDF or Word/);
  assert.match(R.validateStudyPlanTemplate({ name: "a.pdf", size: 0 }), /empty/);
  assert.match(R.validateStudyPlanTemplate({ name: "a.pdf", size: 10 * 1024 * 1024 + 1 }), /10 MB/);
  assert.equal(R.validateStudyPlanTemplate({ name: "a.pdf", size: 10 * 1024 * 1024 }), null);
  assert.deepEqual(R.studyPlanFileType("x.DocX"), { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
});
test("the Forms Management section and the scholar link only call database functions that exist, and the section never writes tables directly", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p4_tracker.sql"), "utf8");
  for (const fn of ["renewal_study_plan_form_setup", "renewal_study_plan_form_save", "renewal_study_plan_form_remove", "renewal_my_study_plan_form", "renewal_is_my_study_plan_path"]) assert.ok(sql.includes("create or replace function public." + fn + "("), fn);
  const staffApi = fs.readFileSync(path.join(root, "src/sead/studyPlanFormsApi.ts"), "utf8");
  for (const fn of ["renewal_study_plan_form_setup", "renewal_study_plan_form_save", "renewal_study_plan_form_remove"]) assert.ok(staffApi.includes('"' + fn + '"'), fn);
  assert.ok(staffApi.includes('"renewal-study-plan-forms"'), "uses its own private folder");
  assert.equal(/\.from\("renewal_study_plan_forms"\)\s*\.(insert|update|delete|upsert)/.test(staffApi), false);
  assert.ok(fs.readFileSync(path.join(root, "src/scholar/renewalApi.ts"), "utf8").includes('"renewal_my_study_plan_form"'));
  const section = fs.readFileSync(path.join(root, "src/sead/pages/RenewalStudyPlanFormsSection.tsx"), "utf8");
  assert.deepEqual([...section.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), []);
  assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(section), false);
  assert.match(fs.readFileSync(path.join(root, "src/sead/pages/FormsManagementTab.tsx"), "utf8"), /RenewalStudyPlanFormsSection/);
});

console.log("The Division Head's decisions (Phase 5)");
test("the scholar is told each outcome in plain words", () => {
  const ev = { required_documents: [], consultation_required: true, consultation_done: true, rule_code: "C2" };
  assert.match(R.scholarNextSteps("renewed", ev, { result: "renewed_probationary" })[0], /You are renewed with Probationary status/);
  const appr = R.scholarNextSteps("division_head_approved", ev);
  assert.match(appr[0], /approved your Probationary status/); assert.match(appr[1], /evaluator to confirm your renewal.*nothing to do/);
  assert.match(R.scholarNextSteps("renewed", ev, { result: "renewed" })[0], /You are renewed/);
  assert.match(R.scholarNextSteps("renewed", ev, { result: "reconsidered" })[0], /You are renewed/);
  const rec = R.scholarNextSteps("reconsidered", ev);
  assert.match(rec[0], /reconsidered your case.*Reconsidered/); assert.match(rec[1], /evaluator to confirm your renewal.*nothing to do/);
  assert.match(R.scholarNextSteps("removed", ev)[0], /scholarship ends.*contact the CEDO office/);
  const endorsed = R.scholarNextSteps("endorsed_division_head", ev);
  assert.match(endorsed[0], /sent your case to the Division Head/); assert.match(endorsed[1], /Nothing to do/);
});
test("the tracker shows a reconsidered case waiting for the evaluator, and a removed case as a problem at the decision", () => {
  const ev = { required_documents: [], consultation_required: true, consultation_done: true, rule_code: "C2" };
  const label = steps => steps.map(s => `${s.label}:${s.state}`).join(" | ");
  assert.equal(label(R.renewalProgress("reconsidered", ev)), "Applied:done | SDP and grades checked:done | Consultation:done | Division Head decision:done | Evaluator confirmation:current | Renewed:todo");
  assert.equal(label(R.renewalProgress("removed", ev)), "Applied:done | SDP and grades checked:done | Consultation:done | Division Head decision:problem");
  assert.equal(R.renewalProgress("removed", ev).filter(s => s.state === "current").length, 0);
  assert.equal(R.renewalProgress("reconsidered", ev).filter(s => s.state === "current").length, 1, "exactly one 'you are here'");
  assert.equal(label(R.renewalProgress("renewed", ev)).endsWith("Renewed:done"), true);
});
test("a Reconsidered case is NOT finished: the evaluator still has to confirm it (board group), the scholar still sees it as in progress", () => {
  assert.ok(R.BOARD_GROUPS.find(g => g.key === "to_confirm").stages.includes("reconsidered") && R.BOARD_GROUPS.find(g => g.key === "to_confirm").stages.includes("division_head_approved"));
  assert.equal(R.isClosedStage("division_head_approved"), false);
  assert.equal(R.isClosedStage("reconsidered"), false); assert.equal(R.isClosedStage("removed"), true); assert.equal(R.isClosedStage("renewed"), true);
  const win = (stage) => ({ window: { id: "w", schoolYear: "2026-2027", term: "1st Semester", opensOn: "2026-10-01", closesOn: "2026-11-01" }, state: "open", consultState: "not_needed", consultNeeded: false, booking: null, incItems: [],
    record: { stage, evaluation: { required_documents: [], consultation_required: true, consultation_done: true }, evaluatorComment: null, noShowFlag: false, result: null } });
  const a = SUM.renewalAttention([win("reconsidered")]);
  assert.ok(a && a.actionNeeded === false && /reconsidered your case/.test(a.headline));
  assert.equal(SUM.renewalAttention([win("removed")]), null);
});
test("the Division Head's choices and what each one does are worded for the screen", () => {
  assert.deepEqual(Object.keys(R.DIVISION_HEAD_OPTION_INFO).sort(), ["approve_probationary", "reconsidered", "removed", "return"]);
  assert.match(R.DIVISION_HEAD_OPTION_INFO.removed.effect, /login is switched off/);
  assert.match(R.DIVISION_HEAD_OPTION_INFO.return.effect, /Nothing changes for the scholar/);
  assert.equal(R.DIVISION_HEAD_DECISION_LABEL.approved_probationary, "Approved — Probationary");
  assert.deepEqual(Object.keys(R.DIVISION_HEAD_CASE_LABEL).sort(), ["probationary_approval", "removal_decision"]);
});

console.log("Notifications and web push (Phase 6)");
const PS = await bundle("pushsupport", "src/lib/pushSupport.ts");
const PM = await bundle("pushmessage", "supabase/functions/_shared/pushMessage.ts");
const envOf = over => ({ hasKey: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default", isIOS: false, isStandalone: false, insideAppBrowser: false, ...over });
test("each device is sorted into: can turn on / needs Add to Home Screen / blocked / cannot / not set up", () => {
  assert.equal(PS.classifyPushSupport(envOf({})), "supported");
  assert.equal(PS.classifyPushSupport(envOf({ hasKey: false })), "not_configured");
  assert.equal(PS.classifyPushSupport(envOf({ permission: "denied" })), "blocked");
  assert.equal(PS.classifyPushSupport(envOf({ isIOS: true, hasPushManager: false })), "needs_install", "iPhone in plain Safari");
  assert.equal(PS.classifyPushSupport(envOf({ isIOS: true, isStandalone: true })), "supported", "iPhone with the portal on the Home Screen");
  assert.equal(PS.classifyPushSupport(envOf({ insideAppBrowser: true })), "unsupported", "Facebook / Messenger browsers");
  assert.equal(PS.classifyPushSupport(envOf({ hasServiceWorker: false })), "unsupported");
  assert.equal(PS.classifyPushSupport(envOf({ hasNotification: false })), "unsupported");
  assert.equal(PS.classifyPushSupport(envOf({ hasKey: false, permission: "denied" })), "not_configured", "nothing to say until the office has set it up");
});
test("in-app browsers and iPads are recognised from the browser text", () => {
  assert.equal(PS.isInAppBrowser("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 [FB_IAB/FB4A;FBAV/430.0]"), true);
  assert.equal(PS.isInAppBrowser("Mozilla/5.0 (iPhone) Instagram 300.0"), true);
  assert.equal(PS.isInAppBrowser("Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36"), false);
  assert.equal(PS.isIOSDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(PS.isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true, "iPadOS pretends to be a Mac");
  assert.equal(PS.isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false);
});
test("the public key is turned into the bytes the browser wants, and device names are friendly", () => {
  const key = "BAyqddb614-Vh7FsiAbgh4G9lQK6oRL29lK9PeDIjE_FfcWcw3RtZTlMyVhEd2V75KX0LLudErClVv8LXICvZZk";
  const bytes = PS.urlBase64ToUint8Array(key);
  assert.equal(bytes.length, 65); assert.equal(bytes[0], 4, "an uncompressed P-256 point");
  assert.equal(PS.deviceLabel("Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(PS.deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120"), "Edge on Windows");
  assert.equal(PS.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604"), "Safari on iPhone / iPad");
});
test("every answer has plain words; the not-set-up state says nothing", () => {
  for (const k of ["supported", "needs_install", "blocked", "unsupported"]) assert.ok(PS.PUSH_MESSAGES[k].length > 20, k);
  assert.match(PS.PUSH_MESSAGES.needs_install, /Add to Home Screen/); assert.match(PS.PUSH_MESSAGES.supported, /bell/); assert.equal(PS.PUSH_MESSAGES.not_configured, "");
});
test("the push message the phone shows is shortened, and only ever points at a page of this site", () => {
  const p = JSON.parse(PM.buildPushPayload({ title: "Hello", body: "Body", url: "/CEDO/portal" }));
  assert.deepEqual(p, { title: "Hello", body: "Body", url: "/CEDO/portal" });
  const long = JSON.parse(PM.buildPushPayload({ title: "T".repeat(200), body: "B".repeat(500), url: "/x" }));
  assert.ok(long.title.length <= 80 && long.body.length <= 200 && long.body.endsWith("…"));
  assert.equal(JSON.parse(PM.buildPushPayload({ title: "x", body: "y", url: "https://evil.example/phish" })).url, "/");
  assert.equal(JSON.parse(PM.buildPushPayload({ title: "x", body: "y", url: "//evil.example" })).url, "/");
  assert.equal(JSON.parse(PM.buildPushPayload({ title: "  ", body: "", url: "/" })).title, "CEDO");
});
test("the push services' answers are read the same way the database reads them", () => {
  assert.equal(PM.classifyPushStatus(201), "delivered"); assert.equal(PM.classifyPushStatus(410), "gone"); assert.equal(PM.classifyPushStatus(404), "gone");
  assert.equal(PM.classifyPushStatus(503), "retry"); assert.equal(PM.classifyPushStatus(0), "retry"); assert.equal(PM.classifyPushStatus(429), "retry");
});
test("the function's shared secret check refuses a missing, wrong or unset secret", () => {
  assert.equal(PM.secretMatches("abc123", "abc123"), true);
  assert.equal(PM.secretMatches("abc124", "abc123"), false); assert.equal(PM.secretMatches("abc", "abc123"), false);
  assert.equal(PM.secretMatches(null, "abc123"), false); assert.equal(PM.secretMatches("abc123", undefined), false); assert.equal(PM.secretMatches("", ""), false);
});

console.log("Dashboard and Excel export (Phase 7)");
const RP = await bundle("report", "src/lib/renewalReport.ts");
const XW = await bundle("xlsx", "src/mysurveys/results/xlsxWriter.ts");
const rawDash = {
  school_year: "2026-2027", term: "1st Semester", term_label: "1st Semester 2026-2027", window: { opens_on: "2026-10-02", closes_on: "2026-11-01", late_allowed: true, days_left: 18, is_open: true },
  totals: { can_renew: 40, applied: 30, not_applied: 10, not_required: 1, late: 2, late_waiting: 1, late_declined: 0, renewed: 12, renewed_regular: 8, renewed_probationary: 3, renewed_reconsidered: 1, removed: 2, returned: 1, avg_days_to_renew: "4.5" },
  by_stage: { renewed: 12, ready_for_confirmation: 4, needs_study_plan_consultation: 5, inc_waiting_compliance: 3, removed: 2, division_head_approved: 1, endorsed_division_head: 2, sdp_on_hold: 1 },
  by_rule: { A: 14, B: 6, C2: 3, D: 4, "C1P": 1 },
  by_school: [{ school: "TEST – Lower", applied: 25, renewed: 10, removed: 2, pending: 13, not_applied: 5 }, { school: "=EVIL()", applied: 5, renewed: 2, removed: 0, pending: 3, not_applied: 5 }],
  per_day: [{ day: "2026-10-10", applied: 3, renewed: 0 }, { day: "2026-10-12", applied: 7, renewed: 1 }, { day: "2026-10-14", applied: 5, renewed: 2 }],
  sdp_and_grades: { sdp_on_hold: 1, waiting_grades: 2, review_needed: 1, with_failed: 8, with_inc: 4 },
  inc: { open: 4, no_deadline: 1, due_in_7_days: 2, overdue: 1, resolved_passed: 3, failed_or_counted: 1 },
  consultations: { required: 14, done: 6, booked_upcoming: 3, attended: 6, no_shows: 2, need_booking: 4 },
  documents: { waiting_review: 3, approved: 5, returned: 1 },
  division_head: { waiting: 2, sent_back: 1, approved_probationary: 3, reconsidered: 1, removed: 2 },
};
const rawExport = {
  exported_at: "2026-10-14T05:30:00Z",
  applications: [
    { scholar_id_number: "TEST-0003", name: "One Failed, TEST T", school: "TEST – Lower", program: "BS Test", year_level: "2nd Year", scholar_status: "Probationary", stage: "renewed", rule_code: "B", basis: "2nd Semester 2025-2026",
      failed_count: 1, inc_open: 0, previous_probation: false, sdp_applicable: true, sdp_complied: true, study_plan: "accepted", inc_letter: null, prospectus: null, consultation_required: true,
      consultation_done_at: "2026-10-12T02:00:00Z", next_consultation: null, no_shows: 1, late: false, late_decision: null, division_head_decision: "approved_probationary", division_head_decided_at: "2026-10-13T03:00:00Z",
      result: "renewed_probationary", applied_at: "2026-10-10T16:30:00Z", confirmed_at: "2026-10-14T01:00:00Z", evaluator_note: "=HYPERLINK(\"http://x\")", scholar_note: "", not_required_reason: null },
    { scholar_id_number: "TEST-0010", name: "SDP Short, TEST T", school: "TEST – Lower", program: "BS Test", year_level: "2nd Year", scholar_status: "Regular", stage: "sdp_on_hold", rule_code: "SDP_HOLD", basis: "2nd Semester 2025-2026",
      failed_count: 0, inc_open: 0, previous_probation: false, sdp_applicable: true, sdp_complied: false, sdp_missing: "Formation Program: 2 of 3", study_plan: null, inc_letter: null, prospectus: null, consultation_required: false,
      consultation_done_at: null, next_consultation: null, no_shows: 0, late: true, late_decision: "accepted", division_head_decision: null, result: null, applied_at: "2026-10-11T01:00:00Z", confirmed_at: null, evaluator_note: null, scholar_note: "Please check" },
  ],
  not_applied: [{ scholar_id_number: "TEST-0014", name: "Higher Passed, TEST T", school: "TEST – Higher", program: "BS Test", year_level: "2nd Year", scholar_status: "Regular" }],
  inc: [{ scholar_id_number: "TEST-0026", name: "INC Deadline Set, TEST", school: "TEST – Lower", subject_code: "TST100", subject: "TEST – Mathematics", state: "open", consultation_date: "2026-10-12", days_given: 14, deadline: "2026-10-26", days_left: 12, decision: null, decision_reason: null }],
  consultations: [{ scholar_id_number: "TEST-0037", name: "Consult Tomorrow, TEST", starts_at: "2026-10-15T01:10:00Z", state: "booked", staff: "TEST Counselor" }],
};
test("the dashboard's numbers are read exactly as the database gives them (numbers stay numbers, missing parts are zero)", () => {
  const d = RP.parseDashboard(rawDash);
  assert.equal(d.totals.canRenew, 40); assert.equal(d.totals.avgDaysToRenew, 4.5); assert.equal(d.window.isOpen, true); assert.equal(d.window.daysLeft, 18);
  assert.equal(d.bySchool.length, 2); assert.equal(d.divisionHead.sentBack, 1); assert.equal(d.consultations.needBooking, 4);
  const empty = RP.parseDashboard({});
  assert.equal(empty.totals.applied, 0); assert.equal(empty.window, null); assert.deepEqual(empty.byStage, {}); assert.equal(empty.totals.avgDaysToRenew, null); assert.deepEqual(empty.bySchool, []);
});
test("stages are grouped like the board and every application is counted once", () => {
  const groups = RP.stageGroupCounts(RP.parseDashboard(rawDash).byStage);
  assert.equal(groups.reduce((a, g) => a + g.count, 0), 12 + 4 + 5 + 3 + 2 + 1 + 2 + 1);
  assert.equal(groups.find(g => g.key === "to_confirm").count, 4 + 1, "ready to confirm + approved by the Division Head");
  assert.equal(groups.find(g => g.key === "done").count, 12 + 2); assert.equal(groups.find(g => g.key === "dh").count, 2);
});
test("shares are written out without dividing by zero; the per-day chart has no gaps", () => {
  assert.equal(RP.percentText(30, 40), "30 of 40 (75%)"); assert.equal(RP.percentText(0, 0), "0 of 0"); assert.equal(RP.percentOf(1, 3), 33); assert.equal(RP.percentOf(5, 0), 0);
  const days = RP.lastDays(RP.parseDashboard(rawDash).perDay, 5);
  assert.deepEqual(days.map(d => d.day), ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]); assert.equal(days[1].applied, 0); assert.equal(days[4].applied, 5);
  assert.deepEqual(RP.lastDays([], 5), []);
});
test("the workbook has the six sheets, with every application, the scholars who have not applied, INC and consultations", () => {
  const sheets = RP.buildReportSheets(RP.parseDashboard(rawDash), RP.parseExportData(rawExport));
  assert.deepEqual(sheets.map(s => s.name), ["Summary", "Applications", "Not applied", "By school", "INC", "Consultations"]);
  assert.equal(sheets[1].rows.length, 2); assert.equal(sheets[2].rows.length, 1); assert.equal(sheets[4].rows.length, 1); assert.equal(sheets[5].rows.length, 1);
  for (const s of sheets) for (const row of s.rows) assert.ok(row.length <= s.headers.length || s.name === "Summary", s.name + " row wider than its header");
  for (const s of sheets.slice(1)) for (const row of s.rows) assert.equal(row.length, s.headers.length, s.name);
});
test("a row is written in plain words and in Philippine time", () => {
  const sheets = RP.buildReportSheets(RP.parseDashboard(rawDash), RP.parseExportData(rawExport));
  const h = sheets[1].headers, row = sheets[1].rows[0], col = name => row[h.indexOf(name)];
  assert.equal(col("Stage"), "Renewed"); assert.equal(col("Division Head decision"), "Approved — Probationary"); assert.equal(col("Result"), "Renewed (Probationary)");
  assert.equal(col("Study plan"), "Approved"); assert.equal(col("SDP"), "Complied"); assert.equal(col("Applied"), "2026-10-11", "16:30 UTC on Oct 10 is already Oct 11 in Manila");
  assert.equal(col("Consultation done"), "2026-10-12"); assert.equal(col("No-shows"), 1); assert.equal(col("Failed subjects"), 1); assert.equal(col("Earlier probation"), "No");
  const row2 = sheets[1].rows[1], c2 = name => row2[h.indexOf(name)];
  assert.equal(c2("SDP"), "Not complied: Formation Program: 2 of 3"); assert.equal(c2("Applied late"), "Yes"); assert.equal(c2("Stage"), "On hold — SDP not complied");
  assert.equal(sheets[5].rows[0][2], "2026-10-15 09:10", "the consultation slot in Manila time");
});
test("the Summary sheet lists the numbers, the stages and the rules; the file name says the term and the day", () => {
  const sum = RP.buildReportSheets(RP.parseDashboard(rawDash), RP.parseExportData(rawExport))[0].rows;
  const find = label => sum.find(r => r[0] === label)?.[1];
  assert.equal(find("Applied"), 30); assert.equal(find("Not applied yet"), 10); assert.equal(find("Renewed"), 12); assert.equal(find("Average days from application to renewal"), 4.5); assert.equal(find("Documents waiting for review"), 3);
  assert.equal(find("Report made (Philippine time)"), "2026-10-14 13:30"); assert.equal(find("  Renewed — Probationary"), 3);
  assert.ok(sum.some(r => r[0] === "  Renewed" && r[1] === 12), "a stage row"); assert.ok(sum.some(r => r[0] === "  C2" && r[1] === 3), "a rule row");
  assert.equal(RP.exportFileName("1st Semester 2026-2027", new Date("2026-10-14T20:00:00Z")), "Scholar-Renewal-1st-Semester-2026-2027-2026-10-15.xlsx");
});
async function testAsync(name, fn) { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`); } }
await testAsync("the Excel file is a real workbook; every text is stored as TEXT, so a note starting with = cannot run as a formula", async () => {
  const sheets = RP.buildReportSheets(RP.parseDashboard(rawDash), RP.parseExportData(rawExport));
  const bytes = await XW.buildXlsxBytes(sheets.map(s => ({ name: s.name, headers: s.headers, rows: s.rows })));
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("xl/workbook.xml") && zip.file("xl/worksheets/sheet6.xml"));
  const wb = await zip.file("xl/workbook.xml").async("string");
  for (const name of ["Summary", "Applications", "Not applied", "By school", "INC", "Consultations"]) assert.ok(wb.includes(`name="${name}"`), name);
  const apps = await zip.file("xl/worksheets/sheet2.xml").async("string");
  assert.ok(apps.includes("=HYPERLINK") && apps.includes('t="inlineStr"'));
  assert.equal(/<f>/.test(apps), false, "no formula cells anywhere");
  const bySchool = await zip.file("xl/worksheets/sheet4.xml").async("string");
  assert.ok(bySchool.includes("=EVIL()") && !/<f>/.test(bySchool));
  assert.match(await zip.file("xl/worksheets/sheet2.xml").async("string"), /<pane ySplit="1"/, "header row frozen");
});

const AC = await bundle("access", "src/lib/renewalAccess.ts");
test("the Excel export can be narrowed (school, year level, program, status group) and says what it was narrowed to", () => {
  assert.equal(RP.isFiltered(RP.NO_FILTER), false); assert.equal(RP.describeFilter(RP.NO_FILTER), "All scholars");
  assert.deepEqual(RP.exportFilterArgs(RP.NO_FILTER), { p_schools: null, p_year_levels: null, p_programs: null, p_stages: null });
  const f = { schools: ["TEST – Lower"], yearLevels: ["2nd Year"], programs: [], groups: ["dh", "not_applied"] };
  const a = RP.exportFilterArgs(f);
  assert.deepEqual(a.p_schools, ["TEST – Lower"]); assert.equal(a.p_programs, null);
  assert.deepEqual(a.p_stages, [...R.BOARD_GROUPS.find(g => g.key === "dh").stages, "not_applied"]);
  assert.equal(RP.describeFilter(f), "School: TEST – Lower · Year level: 2nd Year · Status: Division Head decision, Not applied yet");
  assert.ok(RP.FILTER_GROUPS.some(g => g.key === "not_applied") && R.BOARD_GROUPS.every(g => RP.FILTER_GROUPS.some(x => x.key === g.key)));
  assert.match(RP.exportFileName("1st Semester 2026-2027", new Date("2026-10-14T01:00:00Z"), true), /-filtered-2026-10-14\.xlsx$/);
});
test("a filtered workbook says so, counts only its own scholars, and lists only the chosen schools in 'By school'", () => {
  const dash = RP.parseDashboard(rawDash);
  const f = { schools: ["TEST – Lower"], yearLevels: [], programs: [], groups: [] };
  const sheets = RP.buildReportSheets(dash, RP.parseExportData(rawExport), f);
  const sum = sheets[0].rows, find = label => sum.find(r => r[0] === label)?.[1];
  assert.equal(find("This file contains"), "School: TEST – Lower"); assert.equal(find("Scholars in this file"), 3);
  assert.deepEqual(sheets[3].rows.map(r => r[0]), ["TEST – Lower"]);
  assert.equal(RP.buildReportSheets(dash, RP.parseExportData(rawExport))[3].rows.length, 2, "unfiltered: every school");
  assert.deepEqual(dash.filterOptions, { schools: [], yearLevels: [], programs: [] });
  assert.deepEqual(RP.parseDashboard({ filter_options: { schools: ["A", "", null], year_levels: ["2nd Year"], programs: ["BS X"] } }).filterOptions, { schools: ["A"], yearLevels: ["2nd Year"], programs: ["BS X"] });
});
test("who can open Scholar Renewal: the evaluator, the Division Head, and the heads of SEAD (SEAD division admin or super admin) — nobody else", () => {
  const u = (role, division, tags = []) => ({ role, division, tags });
  assert.equal(AC.canSeeScholarRenewal(u("staff", "SEAD", ["scholar_renewal_evaluator"])), true);
  assert.equal(AC.canSeeScholarRenewal(u("staff", "SEAD", ["sead_division_head"])), true);
  assert.equal(AC.canSeeScholarRenewal(u("division_admin", "SEAD")), true);
  assert.equal(AC.canSeeScholarRenewal(u("super_admin", "LITM")), true);
  assert.equal(AC.canSeeScholarRenewal(u("division_admin", "LITM")), false, "an admin of another division");
  assert.equal(AC.canSeeScholarRenewal(u("staff", "SEAD", ["scholar_counseling"])), false);
  assert.equal(AC.isSeadHead(u("division_admin", "SEAD")), true); assert.equal(AC.isSeadHead(u("staff", "SEAD")), false);
});
test("the SEAD head sees only the Dashboard; the filter boxes are on the dashboard; the database agrees on who may read", () => {
  const page = fs.readFileSync(path.join(root, "src/sead/ScholarRenewalPage.tsx"), "utf8");
  assert.match(page, /t\.key !== "divisionHead" \|\| isEvaluator \|\| isDivisionHead/); assert.match(page, /isDivisionHead \? "divisionHead" : seesRenewals \? "dashboard" : isSdpApprover \? "sdpReconsideration" : isGradesApprover \? "enteredGrades" : "certificate"/);
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalDashboardTab.tsx"), "utf8");
  assert.match(tab, /Choose what goes into the Excel file/); assert.match(tab, /<fieldset/);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p7_reports.sql"), "utf8");
  assert.match(sql, /u\.role = 'super_admin' or \(u\.role = 'division_admin' and u\.division = 'SEAD'\)/);
  assert.equal((sql.match(/can_view_renewal_reports\(\)/g) ?? []).length >= 3, true);
  const sidebar = fs.readFileSync(path.join(root, "src/app/components/Sidebar.tsx"), "utf8");
  assert.ok(sidebar.includes("canSeeScholarRenewal(user)"));
});

console.log("Source guards (Phase 7)");
test("the dashboard screens use readable text; every database function they call exists in the Phase 7 migration; nothing writes a table directly", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p7_reports.sql"), "utf8");
  const api = fs.readFileSync(path.join(root, "src/sead/renewalReportApi.ts"), "utf8");
  const called = [...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(called)].sort(), ["renewal_dashboard", "renewal_export_csr", "renewal_export_data"]);   // the certificate numbers (Phase 8) are asked separately, so this report works without them
  for (const fn of called.filter(f => f !== "renewal_export_csr")) assert.ok(sql.includes(`create or replace function public.${fn}(`), fn);
  assert.equal(/\.from\("/.test(api), false);
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalDashboardTab.tsx"), "utf8");
  assert.deepEqual([...tab.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), []);
  assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(tab), false);
  assert.match(fs.readFileSync(path.join(root, "src/sead/ScholarRenewalPage.tsx"), "utf8"), /RenewalDashboardTab/);
  assert.match(sql, /insert into public\.renewal_export_log/, "every export is logged");
});
test("the Excel writer is loaded only when the button is pressed (it never reaches the main bundle)", () => {
  const api = fs.readFileSync(path.join(root, "src/sead/renewalReportApi.ts"), "utf8");
  assert.match(api, /await import\("@\/mysurveys\/results\/xlsxWriter"\)/); assert.equal(/^import .*xlsxWriter/m.test(api), false);
});

console.log("Source guards (Phase 6)");
test("every database function the push client and the push-sender call exists in the Phase 6 migration", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p6_notifications.sql"), "utf8");
  const files = ["src/lib/pushClient.ts", "supabase/functions/push-sender/index.ts"].map(p => fs.readFileSync(path.join(root, p), "utf8")).join("\n");
  const called = [...files.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(called)].sort(), ["push_claim", "push_report", "push_send_test", "push_subscribe", "push_unsubscribe"]);
  for (const fn of called) assert.ok(sql.includes(`create or replace function public.${fn}(`), fn);
  assert.match(sql, /grant execute on function public\.push_claim\(integer\) to service_role/); assert.equal(/grant execute on function public\.push_claim\(integer\) to (authenticated|anon)/.test(sql), false);
});
test("the push-sender function refuses callers without the secret and never runs without the keys", () => {
  const fn = fs.readFileSync(path.join(root, "supabase/functions/push-sender/index.ts"), "utf8");
  assert.match(fn, /secretMatches\(req\.headers\.get\("x-push-secret"\), Deno\.env\.get\("PUSH_SENDER_SECRET"\)\)/);
  assert.ok(fn.indexOf("secretMatches(req") < fn.indexOf("rpc(\"push_claim\""), "the secret is checked before anything is read");
  assert.match(fn, /VAPID_PRIVATE_KEY/); assert.match(fn, /no-verify-jwt/);
});
test("the service worker only shows notifications and opens the page; it caches nothing and never answers page requests", () => {
  const sw = fs.readFileSync(path.join(root, "public/push-sw.js"), "utf8");
  assert.match(sw, /addEventListener\("push"/); assert.match(sw, /addEventListener\("notificationclick"/);
  assert.equal(/addEventListener\("fetch"|caches\./.test(sw), false);
  assert.match(sw, /charAt\(0\) === "\/"/, "only same-site paths are opened");
});
test("push permission is only ever asked from a button, never on page load", () => {
  const client = fs.readFileSync(path.join(root, "src/lib/pushClient.ts"), "utf8");
  const ui = fs.readFileSync(path.join(root, "src/app/components/PushSettings.tsx"), "utf8");
  assert.equal(client.split("requestPermission").length - 1, 1, "asked in exactly one place (enablePush)");
  assert.match(ui, /onClick=\{\(\) => void turnOn\(\)\}/); assert.equal(/useEffect\([^)]*enablePush/.test(ui), false);
  for (const src of [ui]) {
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), []);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false);
  }
});
test("the scholar bell, the Renewal tile and the staff Notifications pages offer it; staff renewal notices stay private to the person they are for", () => {
  assert.match(fs.readFileSync(path.join(root, "src/scholar/components/dashboard/NotificationBell.tsx"), "utf8"), /<PushSettings variant="panel"/);
  assert.match(fs.readFileSync(path.join(root, "src/scholar/components/dashboard/RenewalPanel.tsx"), "utf8"), /<PushSettings variant="banner"/);
  const app = fs.readFileSync(path.join(root, "src/app/App.tsx"), "utf8");
  assert.equal(app.split('<PushSettings audience="staff"').length - 1, 2, "both staff notification pages");
  assert.match(app, /type NotifType = "submission" \| "leave_request" \| "referral_approval" \| "renewal"/);
  assert.match(app, /\(n\.type !== "referral_approval" && n\.type !== "renewal"( && n\.type !== "storage")?\) \|\| n\.userId === currentUser\.id/);
  assert.match(app, /n\.type === "referral_approval" \|\| n\.type === "renewal"( \|\| n\.type === "storage")?\s*\?\s*n\.userId === currentUser\?\.id/);
  const main = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
  assert.match(main, /isScholarSite\) \{[\s\S]*scholar-manifest\.webmanifest/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/scholar-manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone"); assert.equal(manifest.scope, "/CEDO"); assert.equal(manifest.start_url, "/CEDO/portal");
});
test("the key made for the website is public; the private key only ever appears in the function's secrets and the generator", () => {
  const gen = fs.readFileSync(path.join(root, "scripts/generate-vapid-keys.mjs"), "utf8");
  assert.match(gen, /prime256v1/);
  assert.match(fs.readFileSync(path.join(root, "env.example"), "utf8"), /VITE_VAPID_PUBLIC_KEY=\s*$/m);
  const client = fs.readFileSync(path.join(root, "src/lib/pushClient.ts"), "utf8");
  assert.equal(/VAPID_PRIVATE|PRIVATE_KEY/.test(client), false);
});

console.log("Source guards (Phase 5)");
const p5files = ["src/sead/divisionHeadApi.ts", "src/sead/renewal/RenewalDecisionPanel.tsx", "src/sead/renewal/RenewalDivisionHeadTab.tsx"];
test("the Division Head screens use readable text (13px and up, no pale greys, no pale-blue links)", () => {
  for (const p of p5files) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
});
test("every database function the Division Head screens call exists in the Phase 5 migration, and none writes a table directly", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p5_approvals.sql"), "utf8");
  const api = fs.readFileSync(path.join(root, "src/sead/divisionHeadApi.ts"), "utf8");
  const called = [...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]);
  assert.ok(called.length >= 7, "the API calls its functions");
  for (const fn of called) assert.ok(sql.includes(`create or replace function public.${fn}(`), fn);
  assert.equal(/\.from\("(renewal_records|scholars|scholar_counseling_referrals)"\)\s*\.(insert|update|delete|upsert)/.test(api), false);
});
test("a renewal-linked referral is decided through the renewal functions, never through the old approve / send-back functions", () => {
  const panel = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalDecisionPanel.tsx"), "utf8");
  assert.equal(/approveReferral|requestReferralReconsideration|approve_referral/.test(panel), false);
  const form = fs.readFileSync(path.join(root, "src/sead/components/ReferralFormPanel.tsx"), "utf8");
  assert.match(form, /RenewalDecisionPanel/); assert.match(form, /!renewalInfo/);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p5_approvals.sql"), "utf8");
  for (const fn of ["approve_referral", "request_referral_reconsideration", "forward_referral_to_division_head"]) assert.ok(sql.includes(`create or replace function public.${fn}(`), fn);
  assert.match(sql, /belongs to a scholar renewal/);
});
test("the Division Head can open the Scholar Renewal tool (sidebar, page access and the page itself), seeing only the Division Head tab", () => {
  const app = fs.readFileSync(path.join(root, "src/app/App.tsx"), "utf8");
  assert.match(app, /case "scholarRenewal": return canSeeScholarRenewal\(user\)/);
  assert.match(app, /isEvaluator=\{currentUser\.tags\.includes\("scholar_renewal_evaluator"\)\}/);
  assert.match(fs.readFileSync(path.join(root, "src/lib/renewalAccess.ts"), "utf8"), /tags\.includes\("scholar_renewal_evaluator"\) \|\| u\.tags\.includes\("sead_division_head"\)/);
  const side = fs.readFileSync(path.join(root, "src/app/components/Sidebar.tsx"), "utf8");
  const any = side.slice(side.indexOf("const hasAnySpecificTool"), side.indexOf("return (", side.indexOf("const hasAnySpecificTool")));
  assert.ok(any.includes("canSeeScholarRenewal(user)"), "someone with ONLY one of these tags (or a SEAD head) must still get the tools group");
  const page = fs.readFileSync(path.join(root, "src/sead/ScholarRenewalPage.tsx"), "utf8");
  assert.match(page, /evaluatorOnly/); assert.match(page, /RenewalDivisionHeadTab/);
});

console.log("Source guards (Phase 4)");
const p4files = [
  "src/scholar/components/dashboard/RenewalProgressBar.tsx", "src/scholar/components/dashboard/ConsultationPanel.tsx", "src/scholar/components/dashboard/ConsultationSection.tsx",
  "src/scholar/components/dashboard/RenewalHomeBanner.tsx", "src/scholar/components/dashboard/StudyPlanFormLink.tsx", "src/scholar/components/dashboard/RenewalPanel.tsx", "src/scholar/renewalSummary.ts",
];
test("the new scholar screens use readable text (13px and up, no pale greys, no pale-blue links) and never rely on colour alone", () => {
  for (const p of p4files) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
  const bar = fs.readFileSync(path.join(root, p4files[0]), "utf8");
  assert.ok(bar.includes("You are here") && bar.includes("sr-only") && bar.includes("aria-current"), "the progress bar has words and a screen-reader label");
});
test("the Services screen opens a service from the address bar, the Consultation tile is real, and the home banner opens the Renewal tile", () => {
  const services = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ServicesPanel.tsx"), "utf8");
  assert.match(services, /useUrlState<string>\("service"/); assert.match(services, /<ConsultationPanel \/>/);
  assert.match(services, /selected === "renewal" || selected === "consultation"/);
  const page = fs.readFileSync(path.join(root, "src/scholar/pages/ScholarPortalPage.tsx"), "utf8");
  assert.match(page, /<RenewalHomeBanner/); assert.match(page, /searchParams\.set\("service", "renewal"\)/);
});
test("the Renewal tile and the Consultation tile share ONE booking component, and the tracker uses the shared sentence builder (no second copy of the wording)", () => {
  const renewal = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/RenewalPanel.tsx"), "utf8");
  const consult = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ConsultationPanel.tsx"), "utf8");
  assert.match(renewal, /from "\.\/ConsultationSection"/); assert.match(consult, /from "\.\/ConsultationSection"/);
  assert.match(renewal, /buildNextSteps/); assert.equal(/scholarNextSteps\(/.test(renewal), false);
  assert.equal(/export function ConsultationSection/.test(fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ConsultationSection.tsx"), "utf8")), true);
});

console.log("Source guards (Phase 3)");
const p3files = [
  "src/sead/appointmentsApi.ts", "src/sead/appointments/AppointmentsTab.tsx", "src/sead/appointments/SlotDetailModal.tsx", "src/sead/ScholarRenewalPage.tsx", "src/sead/renewal/RenewalDetailView.tsx",
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
  for (const fn of ["counseling_availability_save", "counseling_availability_delete", "counseling_my_slots", "counseling_mark_slot", "counseling_save_daily_record", "renewal_extend_inc_deadline", "renewal_calendar_staff", "renewal_calendar_slots", "renewal_calendar_availability"]) assert.ok(staffApi.includes(`"${fn}"`), fn);
});
test("the Appointments subtab sits inside the existing Consultation Tool (same tag), and every function the website calls exists in the migration", () => {
  const page = fs.readFileSync(path.join(root, "src/sead/ScholarCounselingToolPage.tsx"), "utf8");
  assert.match(page, /key: "appointments"/);
  const sql = [...["p2_application", "p3_appointments", "p4_tracker", "p8b_test_windows"].map(n => "supabase_migration_renewal_" + n + ".sql"), "supabase_migration_consultation_types_b_booking.sql"].map(n => fs.readFileSync(path.join(root, n), "utf8")).join("\n");
  const called = new Set();
  for (const p of ["src/sead/appointmentsApi.ts", "src/scholar/renewalApi.ts", "src/sead/renewalApi.ts"]) for (const m of fs.readFileSync(path.join(root, p), "utf8").matchAll(/rpc\("([a-z_]+)"/g)) called.add(m[1]);
  const missing = [...called].filter(fn => !new RegExp(`create (or replace )?function public\\.${fn}\\(`).test(sql + fs.readFileSync(path.join(root, "supabase_migration_renewal_not_applied_columns.sql"), "utf8") + fs.readFileSync(path.join(root, "supabase_migration_entered_grades_c_functions.sql"), "utf8") + fs.readFileSync(path.join(root, "supabase_migration_referral_reason_c_functions.sql"), "utf8") + fs.readFileSync(path.join(root, "supabase_migration_renewal_window_schools_b_functions.sql"), "utf8")));
  assert.deepEqual(missing, []);
});
test("the scholar-facing messages never show a time in UTC or the browser's own time zone", () => {
  const lib = fs.readFileSync(path.join(root, "src/lib/renewal.ts"), "utf8");
  for (const fn of ["formatSlot", "formatTimeOnly", "formatDay", "formatDateTime"]) {
    const body = new RegExp(`export function ${fn}[\\s\\S]*?\\n}`).exec(lib)?.[0] ?? "";
    assert.match(body, /timeZone: (MANILA|"Asia\/Manila")|formatTimeOnly/, fn);
  }
});

// ── Phase 8: the Certificate of Scholarship Renewal ──────────
console.log("\nPhase 8: the Certificate of Scholarship Renewal (PDF) and the renewal line on the QR page");
const CSR = await bundle("csrpdf", "supabase/functions/_shared/csrPdf.ts");
const zlib = await import("node:zlib");
/** The text drawn on a PDF page: every "<hex> Tj" of every content stream (pdf-lib writes WinAnsi text as hex strings). */
function pdfText(bytes) {
  const buf = Buffer.from(bytes), lines = [];
  let from = 0;
  for (;;) {
    const a = buf.indexOf("stream", from, "latin1"); if (a < 0) break;
    const b = buf.indexOf("endstream", a + 6, "latin1"); if (b < 0) break;
    let start = a + 6; if (buf[start] === 0x0d) start++; if (buf[start] === 0x0a) start++;
    let body = buf.subarray(start, b);
    try { body = zlib.inflateSync(body); } catch { /* not compressed */ }
    const text = body.toString("latin1");
    for (const m of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) lines.push(Buffer.from(m[1], "hex").toString("latin1"));
    from = b + 9;
  }
  return lines;
}
const csrBase = {
  csrNumber: "CSR-2026-1S-00012", version: 1, fullName: CSR.csrFullName("Juan -Test", "Nuñez", "Dela Cruz"), scholarIdNumber: "2108-00001", barangay: "Besigan",
  program: CSR.csrProgramCode("BSMARE", "5th Year"), school: "PHINMA Cagayan de Oro College", term: "1st Semester", schoolYear: "2026-2027", issuedAt: new Date("2026-07-04T02:00:00Z"),
  place: "the City of Cagayan de Oro, Philippines", officer: { name: "Ms. Test Officer, LPT", title: "City Education and Development Officer, City Education and Development Office" },
  mayor: { name: "Hon. Test Mayor", title: "City Mayor" }, qrUrl: "https://example.test/CEDO/id?token=00000000-0000-4000-8000-000000000001",
};
test("the name is printed as FIRST M. LAST in capitals, the program as stored plus the year number", () => {
  assert.equal(CSR.csrFullName("Juan -Test", "Nuñez", "Dela Cruz"), "JUAN -TEST N. DELA CRUZ");
  assert.equal(CSR.csrFullName("Ana", "", "Reyes"), "ANA REYES"); assert.equal(CSR.csrFullName("  Ana  Marie ", " ", " Reyes "), "ANA MARIE REYES");
  assert.equal(CSR.csrProgramCode("BSMARE", "5th Year"), "BSMARE-5"); assert.equal(CSR.csrProgramCode("BS Marine Engineering", "1st Year"), "BS MARINE ENGINEERING-1"); assert.equal(CSR.csrProgramCode("BSIT", "Irregular"), "BSIT");
});
test("the date line: 4th, 21st, 12th, 2nd, 23rd — in Philippine time", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 30, 31].map(CSR.ordinalDay), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "24th", "30th", "31st"]);
  assert.deepEqual(CSR.manilaDateParts(new Date("2026-07-04T02:00:00Z")), { day: 4, month: "July", year: 2026 });
  assert.deepEqual(CSR.manilaDateParts(new Date("2026-12-31T17:00:00Z")), { day: 1, month: "January", year: 2027 }, "17:00 UTC on Dec 31 is already Jan 1 in Manila");
});
test("term wording and the CSR number", () => {
  assert.deepEqual(CSR.termClassText("1st Semester"), { period: "1ST Semester", cls: "1ST SEMESTER CLASS" });
  assert.deepEqual(CSR.termClassText("2nd Semester"), { period: "2ND Semester", cls: "2ND SEMESTER CLASS" });
  assert.deepEqual(CSR.termClassText("Summer"), { period: "Summer", cls: "SUMMER CLASS" });
  assert.equal(CSR.csrNumberText("2026-2027", "1st Semester", 12), "CSR-2026-1S-00012"); assert.equal(CSR.csrNumberText("2026-2027", "2nd Semester", 3), "CSR-2026-2S-00003"); assert.equal(CSR.csrNumberText("2026-2027", "Summer", 123456), "CSR-2026-SU-123456");
});
await testAsync("the certificate is one A4 page that prints the scholar, school, term, number, signatories, date and place", async () => {
  const bytes = await CSR.buildCsrPdf(csrBase);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 0.5 && Math.abs(height - 841.89) < 0.5, "A4");
  assert.match(doc.getTitle() ?? "", /CSR-2026-1S-00012/);
  const text = pdfText(bytes).join("").replace(/\s+/g, "");   // the body is drawn word by word, so compare without spaces
  for (const raw of ["JUAN -TEST N. DELA CRUZ", "2108-00001", "BESIGAN", "BSMARE-5", "PHINMA CAGAYAN DE ORO COLLEGE", "1ST Semester", "1ST SEMESTER CLASS", "2026-2027",
    "CSR-2026-1S-00012", "MS. TEST OFFICER, LPT", "HON. TEST MAYOR", "City Mayor", "4th", "July 2026", "the City of Cagayan de Oro, Philippines"]) assert.ok(text.includes(raw.replace(/\s+/g, "")), "missing on the certificate: " + raw);
});
await testAsync("a corrected copy says which copy it is; the original does not", async () => {
  const one = pdfText(await CSR.buildCsrPdf(csrBase)).join("\n"), two = pdfText(await CSR.buildCsrPdf({ ...csrBase, version: 2 })).join("\n");
  assert.equal(/Copy 2/.test(one), false); assert.ok(/Copy 2/.test(two));
});
await testAsync("very long names, a long school and a Summer term still fit on one page, and odd characters cannot break the file", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const long = { ...csrBase, fullName: CSR.csrFullName("Maria Cristina Esperanza Josefina", "Santos", "De Los Reyes-Villanueva Y Fernandez-Montenegro"), school: "Technological University of the Philippines – Cagayan de Oro Extension Campus and Graduate School of Marine Engineering",
    program: CSR.csrProgramCode("Bachelor of Science in Computer Engineering Major in Embedded Systems", "4th Year"), term: "Summer", barangay: "Barangay Lapasan, Zone 7 Extension" };
  assert.equal((await PDFDocument.load(await CSR.buildCsrPdf(long))).getPageCount(), 1);
  const odd = { ...csrBase, fullName: "ZOË “ŇÁMÉ” 日本語 😀", school: "Ünï School ★", barangay: "Bgy. Ñ" };
  assert.equal((await PDFDocument.load(await CSR.buildCsrPdf(odd))).getPageCount(), 1);
});
await testAsync("a signature picture the office uploaded is used; without one the sample picture is used", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const plain = await CSR.buildCsrPdf(csrBase);
  const custom = await CSR.buildCsrPdf({ ...csrBase, officer: { ...csrBase.officer, signature: new Uint8Array(png) }, mayor: { ...csrBase.mayor, signature: new Uint8Array(png), mark: new Uint8Array(png) } });
  assert.equal((await PDFDocument.load(custom)).getPageCount(), 1); assert.notEqual(custom.length, plain.length);
});
test("the report adds the certificate number to the Applications sheet (and still works without the Phase 8 answer)", () => {
  const dash = RP.parseDashboard(rawDash), base = RP.parseExportData(rawExport);
  const withCsr = RP.attachCsrNumbers(base, [{ scholar_id_number: "TEST-0003", csr_number: "CSR-2026-1S-00001", version: 2, issued_at: "2026-10-14T01:00:00Z" }]);
  const sheet = RP.buildReportSheets(dash, withCsr)[1], h = sheet.headers;
  assert.ok(h.includes("CSR number") && h.includes("CSR made"));
  assert.equal(sheet.rows[0][h.indexOf("CSR number")], "CSR-2026-1S-00001"); assert.equal(sheet.rows[0][h.indexOf("CSR made")], "2026-10-14");
  assert.equal(sheet.rows[1][h.indexOf("CSR number")], "", "a scholar without a certificate gets an empty cell");
  for (const row of sheet.rows) assert.equal(row.length, h.length);
  const unchanged = RP.attachCsrNumbers(base, null);
  assert.equal(unchanged, base, "no answer (Phase 8 not installed): the rows are returned as they are");
  assert.equal(RP.buildReportSheets(dash, unchanged)[1].rows[0][h.indexOf("CSR number")], "");
});
test("who may open the Certificate tab: the evaluator and the IT admin; the IT admin sees no other tab", () => {
  const page = fs.readFileSync(path.join(root, "src/sead/ScholarRenewalPage.tsx"), "utf8");
  assert.match(page, /t\.key === "certificate" \? \(isEvaluator \|\| isItAdmin\)/);
  assert.match(page, /seesRenewals && \(isEvaluator \|\| !t\.evaluatorOnly\)/);
  const acc = { tags: [], role: "staff", division: "SEAD" };
  assert.equal(AC.canSeeScholarRenewal({ ...acc, username: "it.admin1" }), true); assert.equal(AC.isItAdmin({ ...acc, username: "IT.Admin1" }), true);
  assert.equal(AC.canSeeScholarRenewal({ ...acc, username: "someone" }), false); assert.equal(AC.canSeeScholarRenewal(acc), false);
});
test("the certificate screens only ask the database and the csr-issue function; every function they call exists in the Phase 8 file", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p8_csr.sql"), "utf8");
  const api = fs.readFileSync(path.join(root, "src/lib/csrApi.ts"), "utf8");
  const called = new Set([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...called].sort(), ["csr_for_record", "csr_settings_get", "csr_settings_save"]);
  for (const fn of called) assert.ok(new RegExp(`create (or replace )?function public\\.${fn}\\(`).test(sql), fn);
  assert.match(api, /functions\.invoke\("csr-issue"/);
  assert.equal(/\.from\("csr_(settings|issued|counters)"\)\s*\.(insert|update|delete|upsert)/.test(api), false);
  assert.ok(fs.readFileSync(path.join(root, "src/sead/renewalReportApi.ts"), "utf8").includes('"renewal_export_csr"'));
  assert.ok(/create (or replace )?function public\.renewal_export_csr\(/.test(sql));
});
test("the edge function lets the database decide, keeps the original and answers with a short-lived link", () => {
  const fn = fs.readFileSync(path.join(root, "supabase/functions/csr-issue/index.ts"), "utf8");
  assert.match(fn, /asCaller\.rpc\("csr_prepare"/); assert.match(fn, /admin\.rpc\("csr_complete"/); assert.match(fn, /createSignedUrl\(path, 300/);
  assert.match(fn, /if \(!authHeader\)/); assert.match(fn, /prep\.ready/);
  assert.equal(/admin\.rpc\("csr_prepare"/.test(fn), false, "csr_prepare runs as the caller, never as the service");
});
test("the public QR page shows only the status line (and the certificate number), and the new screens use readable text", () => {
  const page = fs.readFileSync(path.join(root, "src/scholar/pages/ScholarEmergencyInfoPage.tsx"), "utf8");
  assert.match(page, /renewal\.line/); assert.match(page, /Certificate \{renewal\.csr_number\} — valid/);
  assert.equal(/renewal\.(stage|result|evaluation|grades|sdp)/.test(page), false);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p8_csr.sql"), "utf8");
  const fnBody = /create or replace function public\.get_public_scholar_emergency_info[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? "";
  assert.ok(fnBody.includes("'Removed'") && fnBody.includes("'renewal', jsonb_build_object('state', v_state, 'line', v_line, 'csr_number', v_csr)"));
  assert.equal(/grade|sdp|document|evaluator_comment/i.test(fnBody.replace(/--.*$/gm, "")), false, "nothing about grades, SDP or documents is public");
  for (const p of ["src/lib/csrApi.ts", "src/scholar/components/dashboard/CsrDownload.tsx", "src/sead/renewal/RenewalCsrSection.tsx", "src/sead/renewal/RenewalCertificateTab.tsx"]) {
    const src = fs.readFileSync(path.join(root, p), "utf8");
    assert.deepEqual([...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], p);
    assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(src), false, p);
  }
});

// ── Phase 8b: the testers-only renewal window ──
console.log("\nPhase 8b: the testers-only renewal window");
test("the evaluator PICKS the test scholars (search by name or ID, Add, remove with the x); nothing is typed blindly", () => {
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalWindowsTab.tsx"), "utf8");
  assert.match(tab, /function TesterPicker/); assert.match(tab, /lookupScholars\(\{ query \}\)/); assert.match(tab, /Choose at least one test scholar/);
  assert.match(tab, /aria-label=\{`Remove \$\{c\.name \|\| c\.scholarIdNumber\}`\}/);
  assert.match(fs.readFileSync(path.join(root, "src/sead/renewalApi.ts"), "utf8"), /"renewal_scholar_lookup"/);
  assert.match(fs.readFileSync(path.join(root, "supabase_migration_renewal_p8b_test_windows.sql"), "utf8"), /create or replace function public\.renewal_scholar_lookup\(/);
});
test("the Windows screen sends the list only when it matters, warns before opening a testers-only window to everyone, and the call works before the 8b SQL is installed", () => {
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalWindowsTab.tsx"), "utf8");
  assert.match(tab, /testersOnly \? \{ testers \} : \(initial\?\.testers\.length \?\? 0\) > 0 \? \{ testers: \[\] \} : \{\}/);
  assert.match(tab, /Opening it to everyone makes it visible to every scholar/);
  assert.match(tab, /TESTERS ONLY/); assert.match(tab, /Clear test data/);
  const api = fs.readFileSync(path.join(root, "src/sead/renewalApi.ts"), "utf8");
  assert.match(api, /w\.testers === undefined \? \{\} : \{ p_testers: w\.testers \}/);
  assert.match(api, /"renewal_window_clear_test_data"/);
  assert.deepEqual([...tab.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), []);
  assert.equal(/text-slate-400|text-slate-500|text-\[#0088cc\]/.test(tab), false);
});
test("the 8b file: the new functions exist, the older ones keep their other text, and every list that counts scholars asks the same helper", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_p8b_test_windows.sql"), "utf8");
  for (const fn of ["_renewal_window_includes", "renewal_window_save", "renewal_window_clear_test_data", "renewal_my_overview", "renewal_not_applied", "renewal_notification_jobs", "renewal_dashboard", "renewal_export_data"]) assert.ok(new RegExp(`create or replace function public\\.${fn}\\(`).test(sql), fn);
  assert.equal((sql.match(/_renewal_window_includes\(/g) ?? []).length, 7, "1 definition + not_applied + 2 in the alert job + dashboard + export + the grant line");
  assert.match(sql, /renewal_windows\.testers is null or v_id = any \(renewal_windows\.testers\)/);
  assert.match(sql, /drop function if exists public\.renewal_window_save\(uuid, text, text, date, date, boolean, text\)/);
  const p7 = fs.readFileSync(path.join(root, "supabase_migration_renewal_p7_reports.sql"), "utf8");
  assert.equal(/_renewal_window_includes/.test(p7), false, "the Phase 7 file is untouched, so it works without 8b");
});


console.log("Scholar Renewal > Not applied: SDP status, grades status and the consultation referral");
test("the SDP column says Complied, Not complied (with what is missing), no requirement for Summer, or not checked", () => {
  assert.deepEqual(R.sdpStatusText({ applicable: true, complied: true, missing: null }), { text: "Complied", detail: null, tone: "good" });
  assert.deepEqual(R.sdpStatusText({ applicable: true, complied: false, missing: "Formation Program (2 of 3)" }), { text: "Not complied", detail: "Formation Program (2 of 3)", tone: "bad" });
  assert.deepEqual(R.sdpStatusText({ applicable: true, complied: false, missing: null }), { text: "Not complied", detail: null, tone: "bad" });
  assert.equal(R.sdpStatusText({ applicable: false, complied: null, missing: null }).text, "No SDP requirement");
  assert.equal(R.sdpStatusText({ applicable: true, complied: null, missing: null }).text, "Not checked");
});
test("the grades column says all passed, how many failed / INC, waiting for grades, no grades, or needs review", () => {
  assert.deepEqual(R.gradesStatusText({ state: "ready", failed: 0, inc: 0, review: 0 }), { text: "All passed", tone: "good" });
  assert.deepEqual(R.gradesStatusText({ state: "ready", failed: 2, inc: 1, review: 0 }), { text: "2 failed · 1 INC", tone: "bad" });
  assert.deepEqual(R.gradesStatusText({ state: "ready", failed: 0, inc: 1, review: 0 }), { text: "1 INC", tone: "warn" });
  assert.equal(R.gradesStatusText({ state: "waiting", failed: 0, inc: 0, review: 0 }).text, "Waiting for grades");
  assert.equal(R.gradesStatusText({ state: "no_grades", failed: 0, inc: 0, review: 0 }).text, "No grades recorded");
  assert.equal(R.gradesStatusText({ state: "review", failed: 0, inc: 0, review: 2 }).text, "Needs review");
  assert.equal(R.gradesStatusText({ state: null, failed: 0, inc: 0, review: 0 }).text, "Not checked");
});
test("the referral column says nothing until someone is referred, then where the referral stands", () => {
  assert.equal(R.referralStatusText(null), null);
  assert.equal(R.referralStatusText("awaiting_booking"), "Referred: waiting for the scholar to book");
  assert.equal(R.referralStatusText("booked"), "Referred: consultation booked");
  assert.equal(R.referralStatusText("pending"), "Consultation held: with the counselor");
  assert.equal(R.referralStatusText("forwarded_to_division_head"), "With the Division Head");
  assert.equal(R.referralStatusText("reconsideration_requested"), "Reconsideration requested");
});
test("the For Consultation column is gone from the Scholars tab and is on the Not applied list, which shows every column and pages through the database", () => {
  const scholars = fs.readFileSync(path.join(root, "src/sead/pages/ScholarsTab.tsx"), "utf8");
  assert.equal(/For Consultation|ReferralFormModal|fetchOpenReferralStatuses/.test(scholars), false, "the Scholars tab no longer has the referral column");
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalNotAppliedTab.tsx"), "utf8");
  for (const h of ["SDP status", "Grades status", "Referral", "Program · Year", "Mark not required"]) assert.ok(tab.includes(h), h);
  assert.match(tab, /ReferralFormModal/);
  assert.match(tab, /fetchNotAppliedPage/);
  assert.match(tab, /hidden lg:block/, "a table on a wide screen");
  assert.match(tab, /lg:hidden/, "a card for each scholar on a narrow screen, so no column is ever hidden");
  assert.equal(/overflow-x-auto/.test(tab), false, "no sideways scrolling to find a column");
  assert.deepEqual([...tab.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], "no small text");
  assert.equal(/text-slate-400|text-slate-500/.test(tab), false, "no pale text");
});
test("the Not applied list asks the database for one page at a time and falls back to the older list until the update has been run", () => {
  const api = fs.readFileSync(path.join(root, "src/sead/renewalApi.ts"), "utf8");
  assert.match(api, /rpc\("renewal_not_applied_page"/);
  assert.match(api, /PGRST202/);
  assert.match(api, /legacy: true/);
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_not_applied_columns.sql"), "utf8");
  assert.match(sql, /_renewal_evaluate\(b\.sid, p_school_year, p_term\)/, "the list uses the same renewal check an application does");
  assert.match(sql, /least\(coalesce\(p_limit, 25\), 100\)/, "a page is at most 100 scholars");
});


console.log("Consultation referral by reason");
test("the Referral Form asks for the REASON (the consultation types) instead of a counselor, and keeps the older form until the database update is run", () => {
  const panel = fs.readFileSync(path.join(root, "src/sead/components/ReferralFormPanel.tsx"), "utf8");
  assert.match(panel, /Reason for Consultation/);
  assert.match(panel, /isReasonReferralAvailable/);
  assert.match(panel, /createReasonReferral/);
  assert.match(panel, /reasonMode/);
  assert.match(panel, /Refer To/, "the older form (naming a counselor) is still there for a database that has not been updated");
  assert.match(panel, /do not choose a counselor or a time/i, "staff are told they neither pick a counselor nor book a time");
  const api = fs.readFileSync(path.join(root, "src/sead/referralApi.ts"), "utf8");
  for (const fn of ["create_consultation_referral", "consultation_referral_enabled"]) assert.ok(api.includes(`"${fn}"`), fn);
  assert.match(api, /from\("consultation_types"\)/, "the reasons are the consultation types");
});
test("the scholar sees the referral in the Consultation tile and books a morning or afternoon through the database; the reason is fixed", () => {
  const api = fs.readFileSync(path.join(root, "src/scholar/renewalApi.ts"), "utf8");
  for (const fn of ["consultation_my_referrals", "referral_open_blocks", "referral_book_consultation", "referral_reschedule_consultation", "referral_cancel_booking"]) assert.ok(api.includes(`"${fn}"`), fn);
  const panel = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ConsultationPanel.tsx"), "utf8");
  assert.match(panel, /ReferralConsultationSection/);
  assert.match(panel, /fetchMyReferrals/);
  const picker = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ConsultationBlockPicker.tsx"), "utf8");
  assert.match(picker, /referral\?: \{/, "the same picker serves a referral");
  assert.match(picker, /disabled=\{!!referral\}/, "the reason cannot be changed by the scholar");
  const section = fs.readFileSync(path.join(root, "src/scholar/components/dashboard/ReferralConsultationSection.tsx"), "utf8");
  assert.match(section, /CEDO referred you for a consultation/);
  for (const file of [section, picker]) {
    assert.deepEqual([...file.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], "no small text");
    assert.equal(/text-slate-400|text-slate-500/.test(file), false, "no pale text");
  }
});
test("the counselor's calendar says a booking is a referral, and the referral statuses read plainly", () => {
  const modal = fs.readFileSync(path.join(root, "src/sead/appointments/SlotDetailModal.tsx"), "utf8");
  assert.match(modal, /Referred for a consultation/);
  assert.match(fs.readFileSync(path.join(root, "src/sead/appointments/AppointmentsTab.tsx"), "utf8"), /Referral/);
  const referralApi = fs.readFileSync(path.join(root, "src/sead/referralApi.ts"), "utf8");
  assert.match(referralApi, /"awaiting_booking" \| "booked" \| "pending"/);
});
test("the three referral files: A changes only the referrals table, B only the bookings table, C replaces the counselor-side functions and keeps the 12-hour rule and the minutes", () => {
  const read = n => fs.readFileSync(path.join(root, n), "utf8").replace(/--.*$/gm, "");
  assert.equal(/alter table public\.(?!scholar_counseling_referrals)/i.test(read("supabase_migration_referral_reason_a_referrals.sql")), false);
  assert.equal(/alter table public\.(?!counseling_slots)/i.test(read("supabase_migration_referral_reason_b_slots.sql")), false);
  const c = read("supabase_migration_referral_reason_c_functions.sql");
  assert.equal(/\balter table\b|\bdrop table\b|\btruncate\b/i.test(c), false, "file C changes no table");
  assert.ok((c.match(/interval '12 hours'/g) ?? []).length >= 5, "the 12-hour rule");
  assert.match(c, /_consult_blocks\(/, "the minutes of the reason are counted against the staff's available minutes");
});


console.log("Renewal window: choose the schools");
test("the window form offers all schools or checkboxes for the schools, says how many scholars, warns about scholars with no school, and sends the schools only when they matter", () => {
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalWindowsTab.tsx"), "utf8");
  assert.match(tab, /Which schools can renew in this window/);
  assert.match(tab, /All schools/);
  assert.match(tab, /Only the schools I tick/);
  assert.match(tab, /type="checkbox" checked=\{pickedSchools\.has/, "one checkbox per school");
  assert.match(tab, /Tick all/);
  assert.match(tab, /no school set/, "scholars with no school cannot be matched, and the form says so");
  assert.match(tab, /Tick at least one school/, "an empty choice is refused");
  assert.match(tab, /schools && onlySchools/, "the schools are only sent when they matter (the save also works before the SQL is run)");
  assert.match(tab, /already applied keeps their application/);
  assert.deepEqual([...tab.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1])).filter(n => n < 13), [], "no small text");
  const api = fs.readFileSync(path.join(root, "src/sead/renewalApi.ts"), "utf8");
  assert.match(api, /rpc\("renewal_window_schools"/);
  assert.match(api, /p_schools: w\.schools/);
  assert.match(api, /school_ids/);
});
test("the database side: one helper decides who a window is for (testers AND schools), the trigger refuses anyone outside, the reading rule hides the window, and an application that exists is never hidden", () => {
  const a = fs.readFileSync(path.join(root, "supabase_migration_renewal_window_schools_a_column.sql"), "utf8").replace(/--.*$/gm, "");
  assert.equal(/alter table public\.(?!renewal_windows)/i.test(a), false, "file A changes only the windows table");
  assert.match(a, /school_ids uuid\[\]/);
  const b = fs.readFileSync(path.join(root, "supabase_migration_renewal_window_schools_b_functions.sql"), "utf8");
  assert.match(b, /s\.school_id = any \(w\.school_ids\)/);
  assert.match(b, /This renewal window is not open for your school\./);
  assert.match(b, /drop policy if exists "signed in users read renewal windows"/);
  assert.match(b, /r2\.window_id = renewal_windows\.id and r2\.scholar_id_number = v_id/, "a scholar who already applied keeps seeing the window");
  assert.equal(/\balter table\b|\bdrop table\b|\btruncate\b|delete from/i.test(b.replace(/--.*$/gm, "")), false, "file B changes no table and deletes nothing");
  const p8b = fs.readFileSync(path.join(root, "supabase_migration_renewal_p8b_test_windows.sql"), "utf8");
  assert.equal((p8b.match(/_renewal_window_includes\(/g) ?? []).length, 7, "the lists, alerts, dashboard and export already ask the same helper, so one change covers them");
});

console.log("Scholar Renewal > Scholar List");
test("the Grades column says how many subjects are graded of the total, and the indicators say failed / DRP / INC / to review", () => {
  assert.equal(R.gradesProgressText({ graded: 4, total: 5 }), "4 of 5 graded");
  assert.equal(R.gradesProgressText({ graded: 0, total: 0 }), "No subjects yet");
  assert.deepEqual(R.gradeIndicators({ failed: 0, drp: 0, inc: 0, review: 0 }), []);
  assert.deepEqual(R.gradeIndicators({ failed: 1, drp: 0, inc: 0, review: 0 }), [{ text: "1 failed", tone: "bad" }]);
  assert.deepEqual(R.gradeIndicators({ failed: 2, drp: 0, inc: 0, review: 0 }), [{ text: "2 failed", tone: "bad" }]);
  assert.deepEqual(R.gradeIndicators({ failed: 0, drp: 1, inc: 0, review: 0 }), [{ text: "1 DRP", tone: "bad" }]);
  assert.deepEqual(R.gradeIndicators({ failed: 0, drp: 2, inc: 0, review: 0 }), [{ text: "2 DRP", tone: "bad" }]);
  assert.deepEqual(R.gradeIndicators({ failed: 0, drp: 0, inc: 1, review: 0 }), [{ text: "INC", tone: "warn" }]);
  assert.deepEqual(R.gradeIndicators({ failed: 1, drp: 1, inc: 2, review: 1 }).map(c => c.text), ["1 failed", "1 DRP", "2 INC", "1 to review"]);
});
test("the eligibility groups are the three of the request plus Waiting for grades and Needs review, in this order", () => {
  assert.deepEqual(R.ELIGIBILITY_OPTIONS.map(o => o.label), ["Ready for renewal", "For consultation", "For SDP reconsideration", "Waiting for grades", "Needs review"]);
  assert.equal(R.eligibilityLabel("sdp_reconsideration"), "For SDP reconsideration");
  assert.equal(R.SDP_CATEGORY_LABELS.community_service, "Institutional Volunteerism");
});
test("the tab sits between Dashboard and Applications, is for the evaluator, and every column of the request is on the page", () => {
  const page = fs.readFileSync(path.join(root, "src/sead/ScholarRenewalPage.tsx"), "utf8");
  assert.ok(page.indexOf('key: "dashboard"') < page.indexOf('key: "scholarList"') && page.indexOf('key: "scholarList"') < page.indexOf('key: "applications"'));
  assert.match(page, /key: "scholarList", label: "Scholar List".*evaluatorOnly: true/);
  const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalScholarListTab.tsx"), "utf8");
  for (const h of ["Scholar", "SDP status", "Grades", "Renewal eligibility", "Renewal status", "Action needed"]) assert.ok(tab.includes(`"${h}"`), h);
  assert.match(tab, /View SDP credits/);
  assert.match(tab, /hidden xl:block/); assert.match(tab, /xl:hidden/);
  assert.equal(/text-slate-[45]00/.test(tab), false, "no faint text");
});
test("the website asks the database for the list, the count table, the choices, the check and the SDP credits, and a missing database update is told, not shown as an error", () => {
  const api = fs.readFileSync(path.join(root, "src/sead/renewalScholarListApi.ts"), "utf8");
  for (const fn of ["renewal_scholar_list", "renewal_scholar_list_matrix", "renewal_scholar_list_options", "renewal_scholar_list_refresh", "renewal_scholar_sdp_credits"]) assert.ok(api.includes(`rpc("${fn}"`), fn);
  assert.match(api, /PGRST202/);
  assert.match(api, /p_since: since/);
});
test("the database side: one table, locked; the labels come from the one renewal check; the check runs in steps and is for the evaluator only", () => {
  const sql = fs.readFileSync(path.join(root, "supabase_migration_renewal_scholar_list.sql"), "utf8").replace(/--.*$/gm, "");
  assert.ok(sql.includes("revoke all on public.renewal_scholar_list_cache from public, anon, authenticated"));
  assert.ok(sql.includes("public._renewal_evaluate(s.scholar_id_number, p_school_year, p_term)"), "one check for the list and an application");
  assert.ok(sql.includes("perform public._renewal_require_evaluator()"));
  assert.ok(sql.includes("public._renewal_window_includes("));
  assert.equal((sql.match(/create table/gi) ?? []).length, 1);
  assert.equal(/alter table public[.](?!renewal_scholar_list_cache)|drop table|truncate|delete from/i.test(sql), false);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
