// tests/renewal-entered-grades-detail/db_tests.mjs — the renewal detail shows the approved grades a scholar entered, with their screenshots (supabase_migration_renewal_entered_grades_in_detail.sql)
// Run:  node tests/renewal-entered-grades-detail/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
await db.exec(read("undo_entered_grades_e.sql"));      // this test is about the entered grades after applying; the later rule that grades must be in before applying (file E) has its own test
const NEWFILE = "supabase_migration_renewal_entered_grades_in_detail.sql";
const FILES = ["supabase_migration_entered_grades_a_tables.sql", "supabase_migration_entered_grades_b_grading_columns.sql", "supabase_migration_entered_grades_c_functions.sql"];
const UNDOS = ["undo_entered_grades_c.sql", "undo_entered_grades_b.sql", "undo_entered_grades_a.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVALUATOR = seedId("staff:demo.evaluator"), SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), ITADMIN = seedId("staff:it.admin1"), COUNSELOR = seedId("staff:demo.counselor");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
await q("update renewal_windows set school_ids = null where id = $1", [win.id]).catch(() => {});
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]);
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];

for (const f of FILES) await db.exec(read(f));
for (const f of FILES) await db.exec(read(f));     // twice: safe
await db.exec(read("supabase_migration_sdp_reconsideration_a_tables.sql")).catch(() => {});

// ── the schools: "letters" has NOT uploaded its grades (letters A-F, passing 1.0); "lower" has (passing 3.0) ──
const schoolId = async key => (await q("select id from schools where name like $1", [`%${key}%`]))[0].id;
const LETTERS = await schoolId("Letter-Grade"), LOWER = await schoolId("Lower-Is-Better");
const periodOf = async () => {
  await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
  return (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
};
const PERIOD = await periodOf();
await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
await q("delete from scholar_subjects_grades where school_year = $1 and semester = $2 and scholar_id_number in (select scholar_id_number from scholars where school_id = $3)", [basis.basis_school_year, basis.basis_term, LETTERS]);

const letterScholars = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') order by 1", [LETTERS])).map(r => r.s);
const evalOf = async s => (await q("select public._renewal_evaluate($1, $2, $3) e", [s, Y, T]))[0].e;
const applied = [];
for (const s of letterScholars) {
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0].n === 0) {
    const r = await attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);
    if (!r.ok) continue;
  }
  applied.push(s);
}
check("the demo has scholars of a school that has not uploaded its grades, with applications", applied.length >= 3, String(applied.length));
await db.exec(read(NEWFILE)); await db.exec(read(NEWFILE));      // twice: safe
const [A, B] = applied;
const recOf = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const recA = await recOf(A), recB = await recOf(B);
const lines = (...g) => JSON.stringify(g.map((x, i) => ({ code: `SUBJ${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: x })));
const files = (s, rec, n = 1) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ path: `${s}/${rec.id}/grade-entries/${i}-shot.png`, name: `shot${i}.png`, mime: "image/png", size: 12345 })));
const submit = (s, rec, l, f) => attempt(uidOf(s), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rec.id, l, f]);
const decide = (uid, id, approve, note = "") => attempt(uid, "select public.renewal_self_grades_decide($1, $2, $3) r", [id, approve, note]);
const detail = (uid, rec) => attempt(uid, "select public.renewal_record_entered_grades($1) d", [rec.id]);
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);

console.log("\nBefore anything is approved");
check("nothing entered: there is nothing to show", (await detail(EVALUATOR, recA)).rows[0].d === null);
const s1 = await submit(A, recA, lines("A", "C"), files(A, recA, 2));
check("the scholar entered grades", s1.ok, s1.msg);
check("waiting for approval: still nothing to show (only APPROVED grades are shown)", (await detail(EVALUATOR, recA)).rows[0].d === null);

console.log("\nAfter the Grades Approver approves");
const id1 = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recA.id]))[0].id;
check("the Grades Approver approves", (await decide(PLAIN, id1, true, "ok")).ok);
const d = (await detail(EVALUATOR, recA)).rows[0].d;
check("the evaluator sees the subjects with code, name, units and grade, in order", d && d.lines.length === 2 && d.lines[0].code === "SUBJ1" && d.lines[0].subject === "Subject 1" && Number(d.lines[0].units) === 3 && d.lines[0].grade === "A" && d.lines[1].grade === "C", JSON.stringify(d));
check("and the screenshots (name, path, type), who approved and when", d.files.length === 2 && d.files[0].name === "shot0.png" && d.files[0].path.endsWith("/grade-entries/0-shot.png") && d.files[0].mime === "image/png" && d.decided_at && typeof d.decided_by_label === "string" && d.decided_by_label.length > 0 && d.status === "approved", JSON.stringify(d));
const canRead = async u => (await detail(u, recA)).ok, canList = async u => (await attempt(u, "select count(*) from public.renewal_self_grades_list('all', null, 5, 0)")).ok;
check("the same people may read it as may read the Entered grades list (the evaluator and the Grades Approver can; each other account exactly as for that list)", (await canRead(EVALUATOR)) && (await canRead(PLAIN))
  && (await Promise.all([SEAD, ITADMIN, COUNSELOR].map(async u => (await canRead(u)) === (await canList(u))))).every(Boolean));

console.log("\nWho may not");
check("a scholar (even the owner) and a visitor are refused", (await Promise.all([uidOf(A), uidOf(B)].map(u => detail(u, recA)))).every(r => !r.ok && /Not authorized/.test(r.msg)) && !(await attempt(null, "select public.renewal_record_entered_grades($1)", [recA.id], "anon")).ok);
check("an unknown application gives nothing, not an error", (await detail(EVALUATOR, { id: "00000000-0000-0000-0000-000000000000" })).rows[0].d === null);

console.log("\nReplaced and returned tries");
check("another application of the scholar's, with no approved grades, shows nothing", (await detail(EVALUATOR, recB)).rows[0].d === null);
const s2 = await submit(B, recB, lines("A"), files(B, recB));
const idB = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recB.id]))[0].id;
check("a RETURNED try is not shown", s2.ok && (await decide(PLAIN, idB, false, "blurry")).ok && (await detail(EVALUATOR, recB)).rows[0].d === null);
const s3 = await submit(B, recB, lines("A", "B", "C"), files(B, recB, 3));
const id3 = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recB.id]))[0]?.id;
check("after a return the scholar sends it again: it waits, and still nothing is shown until it is approved", s3.ok && !!id3 && (await detail(EVALUATOR, recB)).rows[0].d === null);
check("once approved the NEW grades and screenshots are the ones shown", (await decide(PLAIN, id3, true, "")).ok && await (async () => { const x = (await detail(EVALUATOR, recB)).rows[0].d; return x.lines.length === 3 && x.files.length === 3 && x.version === 2; })());

console.log("\nThe renewal check and the undo");
check("when the school's own grades replace them the renewal check says so (the screen then hides the entered grades)", await (async () => {
  const e = (await q("select public._renewal_evaluate($1, $2, $3) e", [A, Y, T]))[0].e; return e.grades.self_reported === true && e.grades.school_submitted === false;
})());
check("the function only reads: no table or function of the entered grades changed (same counts before and after reading)", await (async () => {
  const n = async () => (await q("select (select count(*) from renewal_self_grade_submissions) a, (select count(*) from renewal_self_grade_lines) b, (select count(*) from renewal_self_grade_files) c, (select count(*) from renewal_records) d"))[0];
  const before = JSON.stringify(await n()); await detail(EVALUATOR, recA); await detail(PLAIN, recA); return before === JSON.stringify(await n());
})());
await db.exec(read("undo_renewal_entered_grades_in_detail.sql"));
check("the undo removes the function and nothing else (the entered grades are untouched)", (await q("select count(*)::int n from pg_proc where proname = 'renewal_record_entered_grades'"))[0].n === 0 && (await q("select count(*)::int n from renewal_self_grade_submissions"))[0].n >= 3);
await db.exec(read("undo_renewal_entered_grades_in_detail.sql"));      // twice: safe
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
