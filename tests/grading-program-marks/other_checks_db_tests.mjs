// tests/grading-program-marks/other_checks_db_tests.mjs — part 3: tagging as temporary probationary, its follow-up and the application check use the program's passing mark (4 checks, short on purpose)
// Run:  node tests/grading-program-marks/other_checks_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_grading_program_marks_other_checks.sql", UNDO = "undo_grading_program_marks_other_checks.sql";
const file = async f => { try { await db.exec(read(f)); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVAL = seedId("staff:demo.evaluator"), GA = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [GA]);
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q("select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1"))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const basis = (await q("select * from public._renewal_basis($1, $2)", [win.school_year, win.term]))[0];
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions");      // no school has uploaded: the scholars enter their grades
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
// the staff setup of the school: passing mark 3.0 (lower is better), and the program "BS Strict" has its own 2.0
await q("update school_grading_configs set set_by_staff = true, staff_program_marks = '[{\"program\": \"BS Strict\", \"passing_mark\": 2}]'::jsonb where school_id = $1", [LOWER]);
const free = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 desc limit 6", [LOWER])).map(r => r.s);
await q("delete from renewal_records where scholar_id_number = any($1::text[]) and school_year = $2 and term = $3", [free, win.school_year, win.term]);
await q("delete from scholar_subjects_grades where scholar_id_number = any($1::text[]) and school_year = $2 and semester = $3", [free, basis.basis_school_year, basis.basis_term]);
const [S1, S2, S3, S4, P1, P2] = free;
await q("update scholars set course = 'BS Strict' where scholar_id_number = any($1::text[])", [[S1, S2, S3]]);
await q("update scholars set course = 'BS Easy' where scholar_id_number = any($1::text[])", [[S4, P1, P2]]);
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((g, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: g }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 12345 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, win.school_year, win.term]))[0];
const decide = async s => { const r = await rec(s); const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [r.id]))[0]?.id; return attempt(GA, "select public.renewal_self_grades_decide($1, true, '', true, 'INC in Subject 1: the grade is coming', 30)", [sub]); };
const state = async s => ({ item: (await q("select i.state from renewal_inc_items i join renewal_records r on r.id = i.record_id where r.scholar_id_number = $1 order by i.created_at desc limit 1", [s]))[0]?.state, status: (await q("select status from scholars where scholar_id_number = $1", [s]))[0].status });
const calls = async () => (await q("select position('_grade_outcome_at(' in pg_get_functiondef('public._renewal_tag_followup(uuid)'::regprocedure)) > 0 f, position('_grade_outcome_at(' in pg_get_functiondef('public.renewal_tag_temp_probation(uuid,text,integer)'::regprocedure)) > 0 t, position($1 in pg_get_functiondef('public.renewal_apply(uuid,text,text,text,text,boolean,jsonb,jsonb,boolean,jsonb)'::regprocedure)) > 0 a", ["l ->> 'grade', v_scholar.course)"]))[0];

// before: take part 3 out (the demo database is built with it in)
await file(UNDO);
const without = await calls();
await apply(S3, ["INC", "2.5"]); const beforeTag = await decide(S3);

// 1. part 3 applies (twice is safe) and the three places ask the program-aware rule
const n1 = await file(NEW), n2 = await file(NEW), linked = await calls();
check("1 part 3 applies to the live functions and can be run twice; the follow-up, the tagging and the application check then ask the rule that knows the program (before it they did not)",
  n1.ok && n2.ok && !without.f && !without.t && !without.a && linked.f && linked.t && linked.a, `${n1.msg} ${n2.msg} ${JSON.stringify({ without, linked })}`);

// 2. tagging: a scholar of the strict program with a 2.5 (fails 2.0) cannot be tagged any more; the same grades in another program can
await apply(S1, ["INC", "2.5"]); await apply(P1, ["INC", "2.5"]);
const strictTag = await decide(S1), easyTag = await decide(P1);
check("2 a scholar whose typed grade fails the program's mark cannot be tagged as temporary probationary (before part 3 it was allowed); a scholar of another program with the same grades still can",
  beforeTag.ok && !strictTag.ok && /failed subject/.test(strictTag.msg) && easyTag.ok, `${beforeTag.msg} | ${strictTag.msg} | ${easyTag.msg}`);

// 3. the follow-up: the school later gives 2.5 for the INC subject: failed for the strict program (stays Probationary), passed for the other (back to Regular)
const settle = async s => {
  await apply(s, ["INC", "1.5"]); const d = await decide(s); const r = await rec(s);
  const c = await attempt(EVAL, "select public.renewal_confirm($1, '')", [r.id]);
  await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject_code, subject, units, grade, recorded_by_school_id) values ($1, $2, $3, 'S1', 'Subject 1', 3, '2.5', $4) on conflict do nothing", [s, basis.basis_school_year, basis.basis_term, LOWER]);
  await q("select public._renewal_tag_followup($1)", [r.id]);
  return { ok: d.ok && c.ok, msg: `${d.msg ?? ""} ${c.msg ?? ""}`, ...(await state(s)) };
};
const strict = await settle(S2), easy = await settle(P2);
check("3 when the school later gives the grade of the INC subject, it is judged by the program: a 2.5 fails the strict program (the scholar stays Probationary) and passes the other program (back to Regular)",
  strict.ok && strict.item === "resolved_failed" && strict.status === "Probationary" && easy.ok && easy.item === "resolved_passed" && easy.status === "Regular", `${JSON.stringify(strict)} ${JSON.stringify(easy)}`);

// 4. the undo puts the old checks back; it can be run again
const u1 = await file(UNDO), u2 = await file(UNDO), undone = await calls(), re = await file(NEW), again = await calls();
check("4 the undo puts the school-mark-only checks back (running it twice is safe) and part 3 can be run again", u1.ok && u2.ok && !undone.f && !undone.t && !undone.a && re.ok && again.f && again.t && again.a, `${u1.msg} ${re.msg} ${JSON.stringify(undone)}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
