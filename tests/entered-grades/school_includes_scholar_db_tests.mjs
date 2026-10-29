// tests/entered-grades/school_includes_scholar_db_tests.mjs — the school's grades count for a scholar only when they include that scholar
//   (supabase_migration_entered_grades_f_school_must_include_scholar.sql, after _d and _e)
// Run:  node tests/entered-grades/school_includes_scholar_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE_D = "supabase_migration_entered_grades_d_apply_flow.sql", UNDO_D = "undo_entered_grades_d.sql", FILE_E = "supabase_migration_entered_grades_e_apply_needs_grades.sql", UNDO_E = "undo_entered_grades_e.sql";
const FILE = "supabase_migration_entered_grades_f_school_must_include_scholar.sql", UNDO = "undo_entered_grades_f.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const PLAIN = seedId("staff:demo.plain");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
await q("update renewal_windows set school_ids = null where id = $1", [win.id]).catch(() => {});
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]);
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);

const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
const PERIOD = (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
await q("delete from school_period_submissions where period_id = $1", [PERIOD]);
// move free scholars of the other schools into this one, so there are enough
for (const s of (await q("select s.scholar_id_number s from scholars s where s.school_id <> $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 8", [LETTERS, Y, T])).map(r => r.s)) await q("update scholars set school_id = $1, school = (select name from schools where id = $1) where scholar_id_number = $2", [LETTERS, s]);
const free = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1", [LETTERS, Y, T])).map(r => r.s);
const [A, B, C, D, E] = free;
check("the demo has five free scholars of one school", free.length >= 5);
for (const s of [A, B, C, D, E]) { await q("delete from sdp_attendance where scholar_id_number = $1", [s]); await q("delete from scholar_subjects_grades where scholar_id_number = $1 and school_year = $2 and semester = $3", [s, basis.basis_school_year, basis.basis_term]); }
const grade = (s, code, g) => q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, recorded_by_school_id) values ($1, $2, $3, $4, $5, $6, $7)", [s, basis.basis_school_year, basis.basis_term, `Subject ${code}`, code, g, LETTERS]);
await grade(A, "S1", "A"); await grade(A, "S2", "B");             // the school recorded grades for A
await grade(C, "S1", ""); await grade(C, "S2", "   ");            // blank marks only for C
// nothing at all for B, D and E
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now())", [LETTERS, PERIOD]);   // the school submitted the semester

const status = async s => (await q("select public._eg_grades_status($1, $2, $3) s", [s, basis.basis_school_year, basis.basis_term]))[0].s;
const evalOf = async s => (await q("select public._renewal_evaluate($1, $2, $3) e", [s, Y, T]))[0].e;
const recOf = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const plain = s => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);
const lines = (...g) => JSON.stringify(g.map((x, i) => ({ code: `SUBJ${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: x })));
const file = (s, id, n = 0) => ({ path: `${s}/${id}/grade-entries/${n}-shot.png`, name: `shot${n}.png`, mime: "image/png", size: 12345 });
const apply9 = (s, g) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true) id", [win.id, lines(...g), JSON.stringify([file(s, win.id)])]);

await db.exec(read(UNDO));      // the harness may already have put the file on: start from the earlier behaviour
console.log("Before the file: the gap");
check("a scholar the school recorded nothing for counts as 'school' (grades in)", (await status(B)) === "school" && (await status(C)) === "school", `${await status(B)} ${await status(C)} ${await status(A)}`);
const gapEval = (await evalOf(B)).grades;
check("... and the check says the school submitted, yet no grades are recorded", gapEval.school_submitted === true && gapEval.state === "no_grades", JSON.stringify(gapEval));

await db.exec(read(FILE));
await db.exec(read(FILE));      // safe to run twice

console.log("\nAfter the file");
check("a scholar the school recorded grades for still counts as 'school'", (await status(A)) === "school");
check("a scholar with no grade recorded by the school has 'none'", (await status(B)) === "none");
check("a scholar with only blank marks has 'none' too", (await status(C)) === "none");
const evB = (await evalOf(B)).grades;
check("the check treats the school's grades as not there for that scholar (the same as a school that has not submitted)", evB.school_submitted === false && evB.state === "waiting", JSON.stringify(evB));
check("the check for a scholar the school did record is exactly as before", (await evalOf(A)).grades.school_submitted === true && (await evalOf(A)).grades.state === "ready");

console.log("\nApplying");
const pB = await plain(B);
check("a scholar with no grades (SDP complied or not) cannot apply, and nothing is left behind", !pB.ok && /Enter your grades first/.test(pB.msg) && !(await recOf(B)), pB.msg);
const pC = await plain(C);
check("nor can the scholar with only blank marks", !pC.ok && /Enter your grades first/.test(pC.msg) && !(await recOf(C)), pC.msg);
const pA = await plain(A);
check("a scholar the school recorded grades for applies as usual", pA.ok && (await recOf(A)), pA.msg);
const eB = await apply9(B, ["A", "B"]);
check("entering the grades with the application lets it in (waiting for the Grades Approver)", eB.ok && (await recOf(B)) && (await status(B)) === "pending", eB.msg);
const entry = (await q("select id from renewal_self_grade_submissions where scholar_id_number = $1 and status = 'pending'", [B]))[0];
const dec = await attempt(PLAIN, "select public.renewal_self_grades_decide($1, true, '') r", [entry.id]);
check("the Grades Approver can approve them", dec.ok && (await status(B)) === "approved", dec.msg);
const evB2 = (await evalOf(B)).grades;
check("the approved grades are the ones the renewal uses", evB2.self_reported === true && evB2.state === "ready", JSON.stringify(evB2));

console.log("\nWhen the school later records the scholar's grades");
await grade(B, "S1", "A");
check("the school's grades take over again", (await status(B)) === "school" && (await evalOf(B)).grades.self_reported === false && (await evalOf(B)).grades.school_submitted === true);

console.log("\nThe undo and the order of the files");
await db.exec(read(UNDO));
check("after the undo the gap is back (as in files C and D)", (await status(C)) === "school" && (await status(D)) === "school");
const hasHelper = (await q("select count(*)::int c from pg_proc where proname = '_eg_school_grades_in'"))[0].c;
check("the helper function is gone", hasHelper === 0);
await db.exec(read(UNDO_E)); await db.exec(read(UNDO_D));
let early = "";
try { await db.exec(read(FILE)); } catch (e) { early = String(e.message); }
check("this file stops with a clear message when file D has not been run", /run supabase_migration_entered_grades_d_apply_flow.sql first/.test(early), early);
await db.exec(read(FILE_D)); await db.exec(read(FILE_E)); await db.exec(read(FILE));
check("it can be put back", (await status(E)) === "none");
const text = read(FILE).replace(/--.*$/gm, "");
check("the file replaces functions only: no table is created or changed, nothing is deleted", !/(create table|alter table|drop table|delete from|truncate)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
