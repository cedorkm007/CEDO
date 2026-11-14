// tests/renewal-temp-probation-tag/db_tests.mjs — a regular scholar with an INC or ONE missing grade: tagged as temporary probationary by the Grades Approver, renewed by the evaluator, then back to Regular or still Probationary (5 checks, short on purpose)
// Run:  node tests/renewal-temp-probation-tag/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_temp_probation_tag.sql", UNDO = "undo_renewal_temp_probation_tag.sql";
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid ?? "", JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const EVAL = seedId("staff:demo.evaluator"), GA = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [GA]);
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions where school_id = $1", [LETTERS]);
await q("delete from school_period_submissions");      // no school has uploaded: the scholars enter their grades
const lettersTwo = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 2", [LETTERS])).map(r => r.s);
const others = (await q("select s.scholar_id_number s from scholars s where s.school_id <> $1 and s.status = 'Regular' order by 1 limit 2", [LETTERS])).map(r => r.s);
const free = [...lettersTwo, ...others];
await q("delete from renewal_records where scholar_id_number = any($1::text[]) and school_year = $2 and term = $3", [free, Y, T]);      // four regular scholars who have not applied yet
const [A, B, C, D] = free;
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((g, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: g }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const subOf = async s => (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id;
const status = async s => (await q("select status from scholars where scholar_id_number = $1", [s]))[0].status;
const decide = (s, tag = true, days = 30) => subOf(s).then(id => attempt(GA, "select public.renewal_self_grades_decide($1, true, '', $2, $3, $4)", [id, tag, "INC in Subject 1: the grade is coming", days]));

console.log("Temporary probationary tag");
// A: an INC (and a passed subject), tagged while approving
await apply(A, ["INC", "A"]);
const d1 = await decide(A);
const ra = await rec(A);
check("1 the Grades Approver approves the entered grades and tags the scholar: no documents, no consultation, ready for the evaluator, the status is still Regular until the renewal is confirmed",
  d1.ok && ra.stage === "ready_for_confirmation" && ra.temp_tag_days === 30 && !ra.consultation_required && (ra.evaluation.required_documents ?? []).length === 0 && (await status(A)) === "Regular", `${d1.msg} ${ra.stage}`);
const conf = await attempt(EVAL, "select public.renewal_confirm($1, '')", [ra.id]);
const ra2 = await rec(A);
const item = (await q("select * from renewal_inc_items where record_id = $1", [ra.id]))[0];
check("2 the evaluator confirms: renewed as Probationary (temporary), the 30 days start that day, and the INC item carries the deadline",
  conf.ok && ra2.stage === "renewed" && ra2.result === "renewed_probationary" && ra2.temp_probation === true && (await status(A)) === "Probationary" && item.days_given === 30 && !!item.deadline, `${conf.msg} ${ra2.stage} ${await status(A)}`);
// the school gives the passing grade: back to Regular
await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject_code, subject, units, grade, recorded_by_school_id) values ($1, $2, $3, 'S1', 'Subject 1', 3, 'A', $4) on conflict do nothing", [A, basis.basis_school_year, basis.basis_term, LETTERS]).catch(async () => {});
await q("select public._renewal_tag_followup($1)", [ra.id]);
// B: the days run out
await apply(B, ["INC", "A"]); await decide(B); const rb = await rec(B);
await attempt(EVAL, "select public.renewal_confirm($1, '')", [rb.id]);
await q("update renewal_inc_items set deadline = current_date - 1 where record_id = $1", [rb.id]);
await q("select public.renewal_tag_followup_all()");
const itemA = (await q("select state from renewal_inc_items where record_id = $1", [ra.id]))[0].state;
check("3 when the school gives a passing grade the scholar goes back to Regular; when the days run out without the grade the scholar stays Probationary (counted as failed)",
  (itemA === "resolved_passed" ? (await status(A)) === "Regular" : false) && (await status(B)) === "Probationary" && (await q("select state from renewal_inc_items where record_id = $1", [rb.id]))[0].state === "counted_failed" && (await rec(B)).temp_probation === false,
  `${itemA} ${await status(A)} ${await status(B)}`);
// C: ONE missing grade is allowed and can be tagged; two are refused; a failed subject cannot be tagged
const c1 = await apply(C, [""]);
const dc = c1.ok ? await decide(C) : c1;
const rc = c1.ok ? await rec(C) : null;
const two = await apply(D, ["", ""]);
check("4 a scholar may leave ONE subject without a grade and be tagged (the missing grade is tracked like an INC and the stage is ready for the evaluator); two blank grades are refused",
  c1.ok && dc.ok && rc.stage === "ready_for_confirmation" && (await q("select kind from renewal_inc_items where record_id = $1", [rc.id]))[0]?.kind === "lacking" && !two.ok && /Only ONE subject/.test(two.msg), `${c1.msg} ${dc.msg} ${rc?.stage} ${two.msg}`);
await db.exec(read(UNDO));
const gone = await q("select to_regprocedure('public.renewal_tag_temp_probation(uuid,text,integer)') f");
const old = await apply(D, [""]);
check("5 after the undo the tag functions are gone and a blank grade is refused again as before", gone[0].f === null && !old.ok && /subject code, a subject name and a grade/.test(old.msg), `${gone[0].f} ${old.msg}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
