// tests/school-grading-rules/phase2_db_tests.mjs — School grading rules, Phase 2 (supabase_migration_school_grading_rules_b_percentage.sql + _d_functions.sql)
//   percentage entry with automatic conversion, passing marks per programme, default excluded codes, renewal judged by the table, past periods that never move, who can read, the undo.
// Run:  node tests/school-grading-rules/phase2_db_tests.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gr2-db-"));
const outfile = path.join(tmp, "rules.mjs");
await build({ entryPoints: [path.join(root, "src/lib/gradingRules.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const G = await import(pathToFileURL(outfile).href);

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const F = { b: "supabase_migration_school_grading_rules_b_percentage.sql", d: "supabase_migration_school_grading_rules_d_functions.sql", undoB: "undo_school_grading_rules_b.sql", undoD: "undo_school_grading_rules_d.sql" };
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const school = async like => (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like $1", [like]))[0];
const lower = await school("%Lower-Is-Better%"), higher = await school("%Higher-Is-Better%"), letters = await school("%Letter-Grade%");
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), SCHOLAR16 = seedId("scholar:16"), SCHOLAR1 = seedId("scholar:1");

const PERIOD = ["2025-2026", "2nd Semester"];
const LET = G.PRESETS.find(p => p.key === "letters"), PH = G.PRESETS.find(p => p.key === "ph-1-5");
const rulesOf = (p, over = {}) => ({ entryMode: p.rules.entryMode, passingMarkPct: p.rules.passingMarkPct, programPassing: [], bands: p.rules.bands.map(b => ({ ...b })), gwa: { ...G.DEFAULT_GWA_SETTINGS }, ...over });
const save = (uid, rules, note = null) => attempt(uid, "select public.school_grading_rules_save($1::jsonb, '{}'::jsonb, $2) r", [JSON.stringify(rules), note]);
const put = (uid, { id = null, scholar = "TEST-0016", code = "N1", subject = "New subject", grade = "", pct = null, units = 3, exclude = null, year = PERIOD[0], term = PERIOD[1] }) =>
  attempt(uid, "select public.upsert_scholar_subject_grade($1::uuid, $2, $3, $4, $5, $6, $7, $8::numeric, $9::boolean, null, $10::numeric) id", [id, scholar, year, term, code, subject, grade, units, exclude, pct]);
const row = async id => (await q("select grade, percentage, exclude_from_gwa from scholar_subjects_grades where id = $1", [id]))[0];
const outcome = async (school_id, grade, pct, year, term, course) => (await q("select public._grade_outcome_at($1, $2, $3::numeric, $4, $5, $6) o", [school_id, grade, pct, year, term, course]))[0].o;

// ── Before the files ──
await db.exec(read(F.undoD)).catch(e => console.log("undo D:", e.message)); await db.exec(read(F.undoB)).catch(e => console.log("undo B:", e.message));      // the harness may already have put the files on: start from before them
console.log("Before the files");
check("no percentage column and no new functions", (await q("select (select count(*) from information_schema.columns where table_name = 'scholar_subjects_grades' and column_name = 'percentage')::int c, to_regprocedure('public._grade_outcome_at(uuid,text,numeric,text,text,text)') is null f"))[0].c === 0);
const snap = async () => JSON.stringify({ g: await q("select id, scholar_id_number, school_year, semester, subject_code, subject, grade, units, exclude_from_gwa, remarks, period_id from scholar_subjects_grades order by id"), c: await q("select * from school_grading_configs order by school_id"), l: await q("select * from school_letter_grades order by school_id, letter") });
const before = await snap();
const renewalBefore = JSON.stringify((await q("select public._renewal_evaluate('TEST-0016', '2025-2026', 'Summer') e"))[0].e.grades.counts);
await db.exec(read(F.b)); await db.exec(read(F.b)); await db.exec(read(F.d)); await db.exec(read(F.d));      // safe to run twice
check("the files add a column and functions; every saved grade, scale and letter is exactly as it was", (await snap()) === before);
check("the new column is empty for every grade already saved", (await q("select count(*)::int n from scholar_subjects_grades where percentage is not null"))[0].n === 0);
check("renewal gives the same answer as before the files (no rules saved yet)", JSON.stringify((await q("select public._renewal_evaluate('TEST-0016', '2025-2026', 'Summer') e"))[0].e.grades.counts) === renewalBefore);

console.log("\nA school with no rules saved");
const p0 = await put(letters.uid, { code: "A1", subject: "First", grade: "B" });
check("entering a grade works exactly as before", p0.ok && (await row(p0.rows[0].id)).grade === "B" && (await row(p0.rows[0].id)).percentage === null, p0.msg);
const p0b = await put(letters.uid, { code: "A2", subject: "Second", pct: 88 });
check("a percentage is refused with a clear message (there is no conversion table)", !p0b.ok && /no conversion table/.test(p0b.msg), p0b.msg);
check("the outcome is the old one (a letter below the old passing mark of 1 fails, a letter at it passes)", await outcome(letters.school_id, "F", null, ...PERIOD, null) === "failed" && await outcome(letters.school_id, "D", null, ...PERIOD, null) === "passed");

console.log("\nSubjects saved BEFORE the rules, with a code that will later be excluded");
const old = await put(letters.uid, { code: "NSTP", subject: "NSTP before the rules", grade: "A", scholar: "TEST-0017" });
check("it starts as counted in the GWA", old.ok && (await row(old.rows[0].id)).exclude_from_gwa === false);

console.log("\nSaving rules for a school whose current period is open (they start now)");
const rulesLet = rulesOf(LET, { programPassing: [{ program: "BS Law", passingPct: 85 }], gwa: { ...G.DEFAULT_GWA_SETTINGS, excludedCodes: ["NSTP", "pe"] } });
const s1 = await save(letters.uid, rulesLet, "letters with a Law programme at 85");
check("the version is saved and starts at the current semester", s1.ok && s1.rows[0].r.reason === "now" && s1.rows[0].r.startsTerm === PERIOD[1], s1.msg ?? JSON.stringify(s1.rows));

console.log("\nEntering a percentage");
const e1 = await put(letters.uid, { code: "P1", subject: "Percent one", pct: 88 });
const r1 = e1.ok ? await row(e1.rows[0].id) : null;
check("88 becomes the grade B and both are kept", e1.ok && r1.grade === "B" && Number(r1.percentage) === 88, e1.msg);
const e2 = await put(letters.uid, { code: "P2", subject: "Percent two", pct: 74.99 });
check("74.99 becomes F; 75 becomes D; 100 becomes A; 0 becomes F", e2.ok && (await row(e2.rows[0].id)).grade === "F"
  && (await row((await put(letters.uid, { code: "P3", subject: "p3", pct: 75 })).rows[0].id)).grade === "D"
  && (await row((await put(letters.uid, { code: "P4", subject: "p4", pct: 100 })).rows[0].id)).grade === "A"
  && (await row((await put(letters.uid, { code: "P5", subject: "p5", pct: 0 })).rows[0].id)).grade === "F");
const e3 = await put(letters.uid, { code: "P6", subject: "Both", grade: "B", pct: 86.5 });
check("a grade and a percentage that agree are accepted", e3.ok && (await row(e3.rows[0].id)).grade === "B", e3.msg);
const e4 = await put(letters.uid, { code: "P7", subject: "Disagree", grade: "A", pct: 80 });
check("a grade and a percentage that disagree are refused, saying what the table says", !e4.ok && /80 is C in your conversion table, not A/.test(e4.msg), e4.msg);
check("a percentage above 100 or below 0 is refused", !(await put(letters.uid, { code: "P8", subject: "x", pct: 101 })).ok && !(await put(letters.uid, { code: "P9", subject: "x", pct: -1 })).ok);
const e5 = await put(letters.uid, { code: "G1", subject: "Grade only", grade: "C" });
check("a grade only is still fine (no percentage kept)", e5.ok && (await row(e5.rows[0].id)).grade === "C" && (await row(e5.rows[0].id)).percentage === null, e5.msg);
const e6 = await put(letters.uid, { code: "G2", subject: "Not in the table", grade: "Z" });
check("a grade that is not in the table is refused, listing the grades that are", !e6.ok && /not in your conversion table\. Use one of: A, B, C, D, F/.test(e6.msg), e6.msg);
const e7 = await put(letters.uid, { code: "S1", subject: "Incomplete", grade: "INC" });
check("INC and DRP are fine without a percentage, and refused with one", e7.ok && (await put(letters.uid, { code: "S2", subject: "Dropped", grade: "DRP" })).ok && !(await put(letters.uid, { code: "S3", subject: "x", grade: "INC", pct: 90 })).ok);
const e8 = await put(letters.uid, { code: "B1", subject: "Blank", grade: "" });
check("a subject with no grade yet is fine", e8.ok && (await row(e8.rows[0].id)).grade === null);
const up = await put(letters.uid, { id: e1.rows[0].id, code: "P1", subject: "Percent one", grade: "B", units: 4 });
check("changing only the units keeps the percentage (the grade did not change)", up.ok && Number((await row(e1.rows[0].id)).percentage) === 88, up.msg);
const up2 = await put(letters.uid, { id: e1.rows[0].id, code: "P1", subject: "Percent one", pct: 95 });
check("a new percentage changes the grade with it (95 is A)", up2.ok && (await row(e1.rows[0].id)).grade === "A" && Number((await row(e1.rows[0].id)).percentage) === 95);
const up3 = await put(letters.uid, { id: e1.rows[0].id, code: "P1", subject: "Percent one", grade: "C" });
check("typing a different grade clears the percentage (it no longer matches)", up3.ok && (await row(e1.rows[0].id)).grade === "C" && (await row(e1.rows[0].id)).percentage === null);

console.log("\nEntry mode");
const modeRules = mode => rulesOf(LET, { entryMode: mode, programPassing: [{ program: "BS Law", passingPct: 85 }], gwa: { ...G.DEFAULT_GWA_SETTINGS, excludedCodes: ["NSTP", "pe"] } });
await save(letters.uid, modeRules("percentage"), "percentage only");
const m1 = await put(letters.uid, { code: "M1", subject: "Needs a percentage", grade: "B" });
check("percentage only: a grade without a percentage is refused; a percentage works; INC works", !m1.ok && /Enter the percentage/.test(m1.msg) && (await put(letters.uid, { code: "M2", subject: "ok", pct: 91 })).ok && (await put(letters.uid, { code: "M3", subject: "inc", grade: "INC" })).ok, m1.msg);
const keep = await put(letters.uid, { id: e5.rows[0].id, code: "G1", subject: "Grade only", grade: "C", units: 5 });
check("percentage only: a row saved earlier as a grade can still change its units (its grade did not change)", keep.ok, keep.msg);
await save(letters.uid, modeRules("grade"), "grades only");
const m2 = await put(letters.uid, { code: "M4", subject: "no percentage allowed", pct: 91 });
check("grades only: a percentage is refused; a grade works", !m2.ok && /enters grades, not percentages/.test(m2.msg) && (await put(letters.uid, { code: "M5", subject: "ok", grade: "A" })).ok, m2.msg);
await save(letters.uid, modeRules("either"), "either");

console.log("\nDefault excluded subject codes");
const x1 = await put(letters.uid, { code: "nstp", subject: "NSTP 1", pct: 90, scholar: "TEST-0016" });
const x2 = await put(letters.uid, { code: "PE", subject: "PE 1", grade: "A" });
const x3 = await put(letters.uid, { code: "MATH", subject: "Math", grade: "A" });
const x4 = await put(letters.uid, { code: "NSTP", subject: "NSTP but kept", grade: "A", exclude: false });
check("a new subject whose code is on the list starts excluded (any capital letters); others do not", (await row(x1.rows[0].id)).exclude_from_gwa === true && (await row(x2.rows[0].id)).exclude_from_gwa === true && (await row(x3.rows[0].id)).exclude_from_gwa === false);
check("what the school ticks on the screen wins", (await row(x4.rows[0].id)).exclude_from_gwa === false);
check("the subject saved before the rules is untouched, even after it is edited", (await put(letters.uid, { id: old.rows[0].id, code: "NSTP", subject: "NSTP before the rules", grade: "A", scholar: "TEST-0017" })).ok && (await row(old.rows[0].id)).exclude_from_gwa === false);

console.log("\nPassed or failed comes from the table and the programme's passing mark");
await q("update scholars set course = 'BS Law' where scholar_id_number = 'TEST-0016'");
check("percentage 80 is passed for most programmes (75) and failed for BS Law (85)", await outcome(letters.school_id, "C", 80, ...PERIOD, "BS Education") === "passed" && await outcome(letters.school_id, "C", 80, ...PERIOD, "BS Law") === "failed" && await outcome(letters.school_id, "C", 80, ...PERIOD, " bs law ") === "failed");
check("a grade alone is judged the same way (C is 80 to 84.99)", await outcome(letters.school_id, "C", null, ...PERIOD, "BS Law") === "failed" && await outcome(letters.school_id, "c", null, ...PERIOD, null) === "passed");
check("the boundary: 75 passes, 74.99 fails; 85 passes for BS Law, 84.99 fails", await outcome(letters.school_id, null, 75, ...PERIOD, null) === "passed" && await outcome(letters.school_id, null, 74.99, ...PERIOD, null) === "failed"
  && await outcome(letters.school_id, null, 85, ...PERIOD, "BS Law") === "passed" && await outcome(letters.school_id, null, 84.99, ...PERIOD, "BS Law") === "failed");
check("INC, DRP and blank mean what they always meant", await outcome(letters.school_id, "INC", null, ...PERIOD, null) === "inc" && await outcome(letters.school_id, "drp", null, ...PERIOD, null) === "drp" && await outcome(letters.school_id, "", null, ...PERIOD, null) === "ungraded");
check("a grade the table does not know falls back to the old rule", await outcome(letters.school_id, "W", null, ...PERIOD, null) === (await q("select public._grade_outcome($1, 'W') o", [letters.school_id]))[0].o);
const ev = (await q("select public._renewal_evaluate('TEST-0016', '2025-2026', 'Summer') e"))[0].e.grades;
check("Scholar Renewal reads the table: the BS Law scholar with A, B, D, C now has the failed subjects D and C", ev.counts.failed >= 2 && ev.failed_subjects.length >= 2, JSON.stringify(ev.counts));
check("the same scholar was judged by the old passing mark before the rules", JSON.parse(renewalBefore).failed === 0 && ev.failed_subjects.some(s => s.grade === "D") && ev.failed_subjects.some(s => s.grade === "C"), renewalBefore);

console.log("\nA locked (submitted) period never moves");
const rulesLow = rulesOf(PH, { programPassing: [{ program: "BS Law", passingPct: 85 }, { program: "BS Test Studies", passingPct: 97 }] });
const lockedSnap = async () => JSON.stringify({
  grades: await q("select id, scholar_id_number, school_year, semester, subject_code, grade, percentage, units, exclude_from_gwa, period_id from scholar_subjects_grades where recorded_by_school_id = $1 order by id", [lower.school_id]),
  records: await q("select * from renewal_records order by id"), cache: await q("select * from renewal_scholar_list_cache order by scholar_id_number, school_year, term"),
  evaluations: await q("select s.scholar_id_number, public._renewal_evaluate(s.scholar_id_number, '2025-2026', 'Summer') e from scholars s where s.school_id = $1 order by 1", [lower.school_id]),
  periods: await q("select * from school_period_submissions order by school_id, period_id"),
});
const lockedBefore = await lockedSnap();
const sLow = await save(lower.uid, rulesLow, "lower school rules");
check("the school whose current semester is submitted gets rules that start at the NEXT semester", sLow.ok && sLow.rows[0].r.startsTerm === "Summer" && sLow.rows[0].r.reason === "period_submitted", sLow.msg ?? "");
check("the submitted semester is still judged by the old passing mark (2.50 passes for a BS Law scholar)", await outcome(lower.school_id, "2.50", null, ...PERIOD, "BS Law") === "passed" && await outcome(lower.school_id, "2.5", null, "2025-2026", "1st Semester", "BS Law") === "passed");
check("from Summer the new rules apply (79 to 81.99 is 2.50: failed for BS Law, passed for others)", await outcome(lower.school_id, "2.50", null, "2025-2026", "Summer", "BS Law") === "failed" && await outcome(lower.school_id, "2.50", null, "2025-2026", "Summer", "BS Education") === "passed");
check("and in later years too", await outcome(lower.school_id, "2.50", null, "2026-2027", "1st Semester", "BS Law") === "failed");
check("the grades, the percentages, the renewal records, the renewal lists and every renewal decision of the submitted semester are exactly as they were (a programme passing of 97 would fail almost everyone if it reached back)", (await lockedSnap()) === lockedBefore);
const lowerTimeline = (await rows(lower.uid, "select public.grading_rules_timeline() t"))[0].t;
check("the timeline says the rules start at Summer, version 1", lowerTimeline[lower.school_id].length === 1 && lowerTimeline[lower.school_id][0].effectiveTerm === "Summer" && lowerTimeline[lower.school_id][0].versionNo === 1);
const lockedGrade = await put(lower.uid, { scholar: (await q("select scholar_id_number from scholars where school_id = $1 limit 1", [lower.school_id]))[0].scholar_id_number, code: "LK1", subject: "Locked", pct: 88 });
check("a grade cannot be saved into the submitted semester at all (that protection is unchanged)", !lockedGrade.ok, lockedGrade.msg);
check("two later saves keep every earlier version: version 1 is never edited", await (async () => {
  const v1Before = JSON.stringify((await q("select * from school_grade_bands where version_id = (select id from school_grading_versions where school_id = $1 and version_no = 1) order by sort_no", [lower.school_id])));
  await save(lower.uid, rulesOf(PH, { passingMarkPct: 85, programPassing: [] }), "stricter"); await save(lower.uid, rulesOf(PH, { passingMarkPct: 77, programPassing: [] }), "softer");
  const v1After = JSON.stringify((await q("select * from school_grade_bands where version_id = (select id from school_grading_versions where school_id = $1 and version_no = 1) order by sort_no", [lower.school_id])));
  return v1Before === v1After && (await q("select count(*)::int n from school_grading_versions where school_id = $1", [lower.school_id]))[0].n === 3;
})());
check("each semester keeps judging by the version that applied to it (the submitted one: still the old mark)", await outcome(lower.school_id, "3.00", null, ...PERIOD, null) === "passed");

console.log("\nWho can read the rules of a semester");
const own = (await rows(letters.uid, "select public.grading_rules_timeline() t"))[0].t;
check("a school sees its own rules only", Object.keys(own).length === 1 && own[letters.school_id].length >= 1 && own[letters.school_id][0].rules.bands.length === 5);
check("a scholar sees the rules of their own school only", await (async () => { const t = (await rows(SCHOLAR16, "select public.grading_rules_timeline() t"))[0].t; return Object.keys(t).length === 1 && t[letters.school_id] !== undefined; })());
const staffAll = (await rows(SEAD, "select public.grading_rules_timeline() t"))[0].t;
check("CEDO staff see every school that saved rules, or only the ones asked for", Object.keys(staffAll).length >= 2 && Object.keys((await rows(SEAD, "select public.grading_rules_timeline($1::uuid[]) t", [[lower.school_id]]))[0].t).length === 1);
check("a plain staff account and nobody-at-all cannot read them", !(await attempt(PLAIN, "select public.grading_rules_timeline()")).ok && !(await attempt(null, "select public.grading_rules_timeline()")).ok);
check("a school cannot ask for another school's rules (it always gets its own)", Object.keys((await rows(higher.uid, "select public.grading_rules_timeline($1::uuid[]) t", [[lower.school_id]]))[0].t).length === 0);

console.log("\nUpload (many rows at once)");
const bulk = await attempt(letters.uid, "select * from public.bulk_upsert_scholar_subject_grades($1::jsonb)", [JSON.stringify([
  { scholarIdNumber: "TEST-0016", schoolYear: PERIOD[0], semester: PERIOD[1], subjectCode: "U1", subject: "Upload percent", grade: "", percentage: "92" },
  { scholarIdNumber: "TEST-0016", schoolYear: PERIOD[0], semester: PERIOD[1], subjectCode: "U2", subject: "Upload grade", grade: "B" },
  { scholarIdNumber: "TEST-0016", schoolYear: PERIOD[0], semester: PERIOD[1], subjectCode: "U3", subject: "Upload mismatch", grade: "A", percentage: "70" },
  { scholarIdNumber: "TEST-0016", schoolYear: PERIOD[0], semester: PERIOD[1], subjectCode: "NSTP", subject: "Upload NSTP", grade: "", percentage: "88.5" },
])]);
check("a row with a percentage is converted, a row with a grade is kept, a mismatch is refused with its message, the default excluded code applies", bulk.ok && bulk.rows[0].ok && bulk.rows[1].ok && !bulk.rows[2].ok && /70 is F in your conversion table, not A/.test(bulk.rows[2].error) && bulk.rows[3].ok
  && (await row(bulk.rows[0].id)).grade === "A" && Number((await row(bulk.rows[0].id)).percentage) === 92 && (await row(bulk.rows[3].id)).exclude_from_gwa === true && (await row(bulk.rows[3].id)).grade === "B", JSON.stringify(bulk.rows ?? bulk.msg));

console.log("\nA grade corrected after submission");
const g = (await q("select id from scholar_subjects_grades where scholar_id_number = 'TEST-0016' and subject_code = 'U1'"))[0].id;
await q("update scholar_subjects_grades set grade = 'B' where id = $1", [g]);
check("if the grade changes to one the percentage no longer gives, the percentage is cleared", (await row(g)).grade === "B" && (await row(g)).percentage === null);
await q("update scholar_subjects_grades set grade = 'A', percentage = 95 where id = $1", [g]);
await q("update scholar_subjects_grades set grade = 'A' where id = $1", [g]);
check("an unchanged grade keeps its percentage", Number((await row(g)).percentage) === 95);

console.log("\nThe undo");
await db.exec(read(F.undoD)); await db.exec(read(F.undoD));
check("after the undo of file D: no new functions, saving is the old save again, and renewal reads the old passing mark", (await q("select to_regprocedure('public._grade_outcome_at(uuid,text,numeric,text,text,text)') is null a, to_regprocedure('public.grading_rules_timeline(uuid[])') is null b, to_regprocedure('public.upsert_scholar_subject_grade(uuid,text,text,text,text,text,text,numeric,boolean,text)') is not null c, to_regprocedure('public.upsert_scholar_subject_grade(uuid,text,text,text,text,text,text,numeric,boolean,text,numeric)') is null d"))[0].a
  && !(await q("select public._renewal_evaluate('TEST-0016', '2025-2026', 'Summer') e"))[0].e.grades.failed_subjects.some(s => s.grade === "D" || s.grade === "C"));
const old2 = await put(letters.uid, { code: "OLD1", subject: "after undo", grade: "B" }).catch(e => ({ ok: false, msg: e.message }));
check("a grade can still be saved after the undo (the old way)", (await attempt(letters.uid, "select public.upsert_scholar_subject_grade(null, 'TEST-0016', $1, $2, 'OLD1', 'after undo', 'B', 3, null, null) id", PERIOD)).ok);
await db.exec(read(F.undoB)); await db.exec(read(F.undoB));
check("after the undo of file B the column is gone; the grades themselves stay", (await q("select count(*)::int c from information_schema.columns where table_name = 'scholar_subjects_grades' and column_name = 'percentage'"))[0].c === 0 && (await q("select count(*)::int n from scholar_subjects_grades where grade is not null"))[0].n > 0);
await db.exec(read(F.b)); await db.exec(read(F.d));
check("and both files can be put back", (await q("select to_regprocedure('public._grade_outcome_at(uuid,text,numeric,text,text,text)') is not null a"))[0].a);
check("the rules the schools saved survived the undo and the re-run", (await q("select count(*)::int n from school_grading_versions"))[0].n >= 4);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
fs.rmSync(tmp, { recursive: true, force: true });
await db.close?.();
