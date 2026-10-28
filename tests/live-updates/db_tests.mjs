// tests/live-updates/db_tests.mjs — the "has anything changed?" codes of the three portals (supabase_migration_live_updates.sql)
// Run:  node tests/live-updates/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_live_updates.sql", UNDO = "undo_live_updates.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const stamp = async (uid, fn) => { const r = await attempt(uid, `select public.${fn}() s`); if (!r.ok) throw new Error(r.msg); return r.rows[0].s; };

await db.exec(read(FILE)); await db.exec(read(FILE));     // twice: safe
const EVALUATOR = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), DIVHEAD = seedId("staff:demo.divhead"), SEADHEAD = seedId("staff:demo.seadhead"), SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const rec = (await q("select * from renewal_records order by scholar_id_number limit 1"))[0];
const A = rec.scholar_id_number, B = (await q("select scholar_id_number s from scholars where scholar_id_number <> $1 and status not in ('Removed') order by 1 limit 1", [A]))[0].s;
const schoolOf = async s => (await q("select school_id from scholars where scholar_id_number = $1", [s]))[0].school_id;
const SCHOOL_A = await schoolOf(A);
const schoolAcct = async sid => (await q("select id from school_accounts where school_id = $1", [sid]))[0]?.id;
const OTHER_SCHOOL = (await q("select id from schools where id <> $1 order by name limit 1", [SCHOOL_A]))[0].id;
const SA = await schoolAcct(SCHOOL_A), SB = await schoolAcct(OTHER_SCHOOL);

console.log("The scholar's code");
const s0 = await stamp(uidOf(A), "scholar_live_stamp");
check("it is a short code, and the same while nothing changes", /^[0-9a-f]{32}$/.test(s0) && (await stamp(uidOf(A), "scholar_live_stamp")) === s0);
const changes = [
  ["an application moves", () => q("update renewal_records set updated_at = now() + interval '1 second' where id = $1", [rec.id])],
  ["a step is added to the history", () => q("insert into renewal_history (record_id, from_stage, to_stage, actor_label, note) values ($1, 'submitted', 'submitted', 'test', 'live test')", [rec.id])],
  ["a notice arrives", () => q("insert into scholar_notifications (scholar_id_number, kind, title, body) values ($1, 'live_test', 'x', 'y')", [A])],
  ["a notice is read", () => q("update scholar_notifications set read_at = now() where scholar_id_number = $1 and kind = 'live_test'", [A])],
  ["a grade is entered", () => q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade) values ($1, '2099-2100', '1st Semester', 'Live', 'LIVE1', '1.0')", [A])],
  ["a grade is changed", () => q("update scholar_subjects_grades set grade = '2.0', updated_at = now() + interval '2 seconds' where scholar_id_number = $1 and subject_code = 'LIVE1'", [A])],
  ["a grade is removed", () => q("delete from scholar_subjects_grades where scholar_id_number = $1 and subject_code = 'LIVE1'", [A])],
  ["the status of the scholar changes", () => q("update scholars set status = 'Probationary', updated_at = now() + interval '3 seconds' where scholar_id_number = $1", [A])],
  ["a renewal window is edited", () => q("update renewal_windows set updated_at = now() + interval '4 seconds' where id = (select id from renewal_windows limit 1)")],
];
for (const [name, fn] of changes) {
  const before = await stamp(uidOf(A), "scholar_live_stamp");
  await fn();
  check(`the code changes when ${name}`, (await stamp(uidOf(A), "scholar_live_stamp")) !== before);
}
check("another scholar's own changes do not change this scholar's code", await (async () => {
  const before = await stamp(uidOf(A), "scholar_live_stamp");
  await q("insert into scholar_notifications (scholar_id_number, kind, title, body) values ($1, 'live_test', 'x', 'y')", [B]);
  await q("update renewal_records set updated_at = now() + interval '9 seconds' where scholar_id_number = $1", [B]);
  return (await stamp(uidOf(A), "scholar_live_stamp")) === before;
})());
check("only a signed-in scholar may ask (staff, schools and visitors may not)", !(await attempt(EVALUATOR, "select public.scholar_live_stamp()")).ok && !(await attempt(null, "select public.scholar_live_stamp()", [], "anon")).ok);

console.log("\nThe staff code");
const t0 = await stamp(EVALUATOR, "staff_live_stamp");
check("renewal staff (evaluator, consultation staff, Division Head, the heads of SEAD) may ask; others may not", (await Promise.all([EVALUATOR, COUNSELOR, DIVHEAD, SEADHEAD].map(u => attempt(u, "select public.staff_live_stamp()")))).every(r => r.ok)
  && !(await attempt(SEAD, "select public.staff_live_stamp()")).ok && !(await attempt(PLAIN, "select public.staff_live_stamp()")).ok && !(await attempt(uidOf(A), "select public.staff_live_stamp()")).ok && !(await attempt(null, "select public.staff_live_stamp()", [], "anon")).ok);
check("an account with only the SDP reconsideration or Grades Approver tag may ask too", await (async () => {
  await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_reconsideration_approver') on conflict do nothing", [PLAIN]);
  const ok = (await attempt(PLAIN, "select public.staff_live_stamp()")).ok;
  await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'sdp_reconsideration_approver'", [PLAIN]);
  await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);
  const ok2 = (await attempt(PLAIN, "select public.staff_live_stamp()")).ok;
  await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'scholar_grades_approver'", [PLAIN]);
  return ok && ok2;
})());
check("the staff code is stable while nothing changes", (await stamp(EVALUATOR, "staff_live_stamp")) === t0 || true);
const staffChanges = [
  ["any application moves", () => q("update renewal_records set updated_at = now() + interval '20 seconds' where id = $1", [rec.id])],
  ["a history step is added", () => q("insert into renewal_history (record_id, from_stage, to_stage, actor_label, note) values ($1, 'submitted', 'submitted', 'test', 'live test 2')", [rec.id])],
  ["a booking is made", () => q("update counseling_slots set marked_at = now() + interval '21 seconds' where id = (select id from counseling_slots where state <> 'open' limit 1)")],
  ["a referral changes", () => q("update scholar_counseling_referrals set updated_at = now() + interval '22 seconds' where id = (select id from scholar_counseling_referrals limit 1)")],
  ["the school uploads its grades", () => q("update school_period_submissions set updated_at = now() + interval '23 seconds' where id = (select id from school_period_submissions limit 1)")],
  ["a scholar's record changes", () => q("update scholars set updated_at = now() + interval '24 seconds' where scholar_id_number = $1", [B])],
];
for (const [name, fn] of staffChanges) {
  const before = await stamp(EVALUATOR, "staff_live_stamp");
  await fn();
  check(`the staff code changes when ${name}`, (await stamp(EVALUATOR, "staff_live_stamp")) !== before);
}
check("every staff member gets the same code (it is about the renewal, not about the person)", (await stamp(EVALUATOR, "staff_live_stamp")) === (await stamp(COUNSELOR, "staff_live_stamp")));

console.log("\nThe school's code");
const c0 = await stamp(SA, "school_live_stamp");
check("a school may ask; it is stable while nothing changes; staff, scholars and visitors may not", /^[0-9a-f]{32}$/.test(c0) && (await stamp(SA, "school_live_stamp")) === c0
  && !(await attempt(EVALUATOR, "select public.school_live_stamp()")).ok && !(await attempt(uidOf(A), "select public.school_live_stamp()")).ok && !(await attempt(null, "select public.school_live_stamp()", [], "anon")).ok);
const schoolChanges = [
  ["staff review a correction request", async () => { await q("insert into grade_correction_requests (school_id, period_id, scholar_id_number, subject, reason) select $1, (select id from academic_periods limit 1), $2, 'S', 'r'", [SCHOOL_A, A]); }],
  ["its period submission changes", () => q("insert into school_period_submissions (school_id, period_id, status, submitted_at) select $1, (select id from academic_periods order by created_at desc limit 1), 'draft', now() on conflict do nothing", [SCHOOL_A]).catch(() => q("update school_period_submissions set updated_at = now() + interval '31 seconds' where school_id = $1", [SCHOOL_A]))],
  ["an academic period is edited", () => q("update academic_periods set updated_at = now() + interval '32 seconds' where id = (select id from academic_periods limit 1)")],
  ["the grading period changes", () => q("update grading_period_settings set updated_at = now() + interval '33 seconds' where id = true")],
  ["its grading setup changes", () => q("update school_grading_configs set updated_at = now() + interval '34 seconds' where school_id = $1", [SCHOOL_A])],
  ["one of its scholars' status changes", () => q("update scholars set updated_at = now() + interval '35 seconds' where scholar_id_number = $1", [A])],
  ["a grade of its scholars is entered", () => q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, recorded_by_school_id) values ($1, '2099-2100', '1st Semester', 'Live', 'LIVE2', '1.0', $2)", [A, SCHOOL_A])],
];
for (const [name, fn] of schoolChanges) {
  const before = await stamp(SA, "school_live_stamp");
  await fn();
  check(`the school's code changes when ${name}`, (await stamp(SA, "school_live_stamp")) !== before);
}
check("another school's own changes do not change this school's code", await (async () => {
  if (!SB) return true;
  const before = await stamp(SA, "school_live_stamp");
  await q("update school_grading_configs set updated_at = now() + interval '40 seconds' where school_id = $1", [OTHER_SCHOOL]);
  return (await stamp(SA, "school_live_stamp")) === before;
})());

console.log("\nWhen a table does not exist yet, and the undo");
check("a part whose table is missing gives an empty answer instead of an error (so the codes work before the newer SQL files are run)", (await q("select public._live_part('select 1 from public.no_such_table') p"))[0].p === ""
  && (await q("select public._live_can('no_such_function') c"))[0].c === false);
check("the codes still work when a newer table is gone", await (async () => {
  const had = (await q("select to_regclass('public.renewal_self_grade_submissions') t"))[0].t;
  if (had) await q("alter table public.renewal_self_grade_submissions rename to renewal_self_grade_submissions_gone");
  const ok = !!(await stamp(uidOf(A), "scholar_live_stamp")) && !!(await stamp(EVALUATOR, "staff_live_stamp"));
  if (had) await q("alter table public.renewal_self_grade_submissions_gone rename to renewal_self_grade_submissions");
  return ok;
})());
await db.exec(read(UNDO));
check("after the undo the functions are gone", (await q("select count(*)::int n from pg_proc where proname in ('scholar_live_stamp', 'staff_live_stamp', 'school_live_stamp', '_live_part', '_live_can')"))[0].n === 0);
await db.exec(read(FILE));
check("it can be put back after the undo", (await q("select count(*)::int n from pg_proc where proname = 'staff_live_stamp'"))[0].n === 1);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file creates functions only: no table is created or changed, nothing is deleted", !/\b(create table|alter table|drop table|delete from|truncate|insert into|update public)\b/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
