// tests/entered-grades/revert_db_tests.mjs — revert the approval of entered grades (supabase_migration_entered_grades_g_revert.sql)
// Run:  node tests/entered-grades/revert_db_tests.mjs
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
const NEWFILE = "supabase_migration_entered_grades_g_revert.sql", UNDOFILE = "undo_entered_grades_g.sql";
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

const [A, B, C] = applied;
const recOf = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const recA = await recOf(A), recB = await recOf(B), recC = await recOf(C);
const lines = (...g) => JSON.stringify(g.map((x, i) => ({ code: `SUBJ${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: x })));
const files = (s, rec, n = 1) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ path: `${s}/${rec.id}/grade-entries/${i}-shot.png`, name: `shot${i}.png`, mime: "image/png", size: 12345 })));
const submit = (s, rec, l, f) => attempt(uidOf(s), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rec.id, l, f]);
const decide = (uid, id, approve, note = "") => attempt(uid, "select public.renewal_self_grades_decide($1, $2, $3) r", [id, approve, note]);
const revert = (uid, id, note = "approved the wrong scholar") => attempt(uid, "select public.renewal_self_grades_revert($1, $2) r", [id, note]);
const subOf = async rec => (await q("select * from renewal_self_grade_submissions where record_id = $1 and status <> 'superseded' order by version desc limit 1", [rec.id]))[0];
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);

console.log("\nSetting up: A is approved, B is waiting, C was returned");
check("A, B and C sent their grades", (await submit(A, recA, lines("A", "C"), files(A, recA))).ok && (await submit(B, recB, lines("B"), files(B, recB))).ok && (await submit(C, recC, lines("D"), files(C, recC))).ok);
const sA = await subOf(recA), sB = await subOf(recB), sC = await subOf(recC);
check("the Grades Approver approves A and returns C", (await decide(PLAIN, sA.id, true, "ok")).ok && (await decide(PLAIN, sC.id, false, "blurry")).ok);
check("A's renewal counts the approved grades (self reported)", (await evalOf(A)).grades.self_reported === true && (await evalOf(A)).grades.self_status === "approved");

console.log("\nWho may revert, and what can be reverted");
check("only a Grades Approver: the evaluator, SEAD staff, it.admin1, the scholar and a visitor are refused", (await Promise.all([EVALUATOR, SEAD, ITADMIN, uidOf(A)].map(u => revert(u, sA.id)))).every(r => !r.ok && /Only a Grades Approver/.test(r.msg))
  && !(await attempt(null, "select public.renewal_self_grades_revert($1, 'x')", [sA.id], "anon")).ok);
check("only an APPROVED try: a waiting one (B) and a returned one (C) are refused", [sB, sC].every(async () => true) && !(await revert(PLAIN, sB.id)).ok && /Only grades that were approved/.test((await revert(PLAIN, sB.id)).msg) && /Only grades that were approved/.test((await revert(PLAIN, sC.id)).msg));
check("a reason is needed (nothing or only spaces is refused), and nothing changed by the refused tries", !(await revert(PLAIN, sA.id, "")).ok && !(await revert(PLAIN, sA.id, "   ")).ok && (await subOf(recA)).status === "approved");
check("an unknown submission is refused", !(await revert(PLAIN, "00000000-0000-0000-0000-000000000000")).ok);

console.log("\nReverting A's approval");
const before = JSON.stringify((await q("select count(*)::int l, (select count(*)::int from renewal_self_grade_files where submission_id = $1) f from renewal_self_grade_lines where submission_id = $1", [sA.id]))[0]);
const rv = await revert(PLAIN, sA.id, "approved the wrong scholar");
check("the Grades Approver reverts it", rv.ok && rv.rows[0].r === "reverted", rv.msg);
const sA2 = await subOf(recA);
check("it is waiting for approval again: same try, nobody and no time as the decider, no old note; its subjects and screenshots are kept", sA2.id === sA.id && sA2.status === "pending" && sA2.version === sA.version && sA2.decided_by === null && sA2.decided_by_label === null && sA2.decided_at === null && (sA2.decision_note ?? "") === ""
  && JSON.stringify((await q("select count(*)::int l, (select count(*)::int from renewal_self_grade_files where submission_id = $1) f from renewal_self_grade_lines where submission_id = $1", [sA.id]))[0]) === before);
const evA = await evalOf(A);
check("A's renewal stops using the grades and waits for the Grades Approver again", evA.grades.self_reported === false && evA.grades.self_status === "pending" && evA.grades.state === "waiting" && /Grades Approver/.test(evA.grades.reason), JSON.stringify(evA.grades));
check("the renewal detail shows nothing until it is approved again (only approved grades are shown)", (await rows(EVALUATOR, "select public.renewal_record_entered_grades($1) d", [recA.id]))[0].d === null);
check("it is in the approver's 'waiting' list again, and no longer in 'approved'", (await rows(PLAIN, "select * from public.renewal_self_grades_list('pending', $1, 20, 0)", [A])).length === 1 && (await rows(PLAIN, "select * from public.renewal_self_grades_list('approved', $1, 20, 0)", [A])).length === 0);
check("the scholar is told, with the reason", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'grades_entry_reverted' and body like '%approved the wrong scholar%'", [A]))[0].n === 1);
check("every Grades Approver and every renewal evaluator gets a bell notice (and nobody else)", await (async () => {
  const got = (await q("select user_id from notifications where type = 'renewal' and title = 'Approval of entered grades reverted'")).map(r => r.user_id).sort().join();
  const want = (await q("select distinct staff_id from staff_account_tags where tag_key in ('scholar_grades_approver', 'scholar_renewal_evaluator')")).map(r => r.staff_id).sort().join();
  return got === want && got.includes(PLAIN) && got.includes(EVALUATOR);
})());
check("the renewal's history records it with the reason", (await q("select count(*)::int n from renewal_history where record_id = $1 and note like 'Approval of the entered grades was reverted%approved the wrong scholar%'", [recA.id]))[0].n === 1);
check("reverting it again is refused (it is no longer approved)", !(await revert(PLAIN, sA.id)).ok);
check("the Grades Approver can approve it again, and the renewal uses the grades again", (await decide(PLAIN, sA.id, true, "")).ok && (await evalOf(A)).grades.self_reported === true);

console.log("\nWhen it cannot be reverted");
check("once the renewal moved on (the case is endorsed, confirmed, returned...) it is refused and nothing changes", await (async () => {
  const stage = (await recOf(A)).stage;
  await q("update renewal_records set stage = 'renewed' where id = $1", [recA.id]);
  const r = await revert(PLAIN, sA.id);
  await q("update renewal_records set stage = $2 where id = $1", [recA.id, stage]);
  return !r.ok && /already moved past the grades step/.test(r.msg) && (await subOf(recA)).status === "approved";
})());
check("when the school has already uploaded its grades for that semester it is refused (those are the grades that count)", await (async () => {
  await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now()) on conflict do nothing", [LETTERS, PERIOD]);
  await q("update school_period_submissions set status = 'submitted' where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
  const r = await revert(PLAIN, sA.id);
  await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
  return !r.ok && /already uploaded its grades/.test(r.msg) && (await subOf(recA)).status === "approved";
})());

console.log("\nThe undo");
await db.exec(read(UNDOFILE));
check("the undo removes the function and leaves the entered grades as they are", (await q("select count(*)::int n from pg_proc where proname = 'renewal_self_grades_revert'"))[0].n === 0 && (await subOf(recA)).status === "approved");
await db.exec(read(UNDOFILE));      // twice: safe
await db.exec(read(NEWFILE));      // and the file can be put back
check("the file can be put back after the undo", (await q("select count(*)::int n from pg_proc where proname = 'renewal_self_grades_revert'"))[0].n === 1);
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
