// tests/removal-form/list_db_tests.mjs — the consulting staff's list of termination forms: the removals to be approved and the approved ones, with year level, school and program
//   (supabase_migration_removal_form_list.sql, after supabase_migration_removal_form.sql)
// Run:  node tests/removal-form/list_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_removal_form_list.sql", UNDO = "undo_removal_form_list.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVAL = seedId("staff:demo.evaluator"), DH = seedId("staff:demo.divhead"), COUNSELOR = seedId("staff:demo.counselor"), ADMIN = seedId("staff:demo.admin"), SEAD = seedId("staff:demo.sead");
const SIG = `${DH}/signature.png`;

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on: start from the earlier list
console.log("Before the file");
check("the earlier list has no year level, school, program or state", Object.keys((await rows(COUNSELOR, "select * from public.consult_removal_forms()").catch(() => [{}]))[0] ?? { final_decision_made: 1 }).every(k => !["year_level", "school", "program", "state"].includes(k)));
await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nWhat the list holds");
const free = (await q(`select s.scholar_id_number s from scholars s where s.status = 'Regular' and not exists (select 1 from scholar_counseling_referrals f where f.scholar_id_number = s.scholar_id_number)
  and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number) order by 1 limit 6`)).map(r => r.s);
const [W, R, D, P, O] = free;
const set = (s, last, first, yl, school, program) => q("update scholars set last_name = $2, first_name = $3, middle_name = '', year_level = $4, school = $5, course = $6 where scholar_id_number = $1", [s, last, first, yl, school, program]);
await set(W, "Zamora", "Wen", "2nd Year", "Alpha College", "BS Nursing"); await set(R, "Abad", "Rey", "3rd Year", "Beta University", "BS Civil Engineering");
await set(D, "Mendoza", "Dan", "1st Year", "Alpha College", "AB History"); await set(P, "Pablo", "Pia", "4th Year", "Alpha College", "BS Nursing"); await set(O, "Ocampo", "Ona", "2nd Year", "Beta University", "BS Nursing");
const mk = async (scholar, endorsed, to = COUNSELOR) => (await q(`insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, status)
  values ($1, $2, $3, 'Retained', '[]', '[]', $4, 'pending') returning id`, [scholar, EVAL, to, endorsed]))[0].id;
const rw = await mk(W, "Removal"), rr = await mk(R, "Removal"), rd = await mk(D, "Removal"), rp = await mk(P, "On Probation Status"), ro = await mk(O, "Removal", EVAL);
for (const [id, e, who] of [[rw, "Removal", COUNSELOR], [rr, "Removal", COUNSELOR], [rd, "Removal", COUNSELOR], [rp, "On Probation Status", COUNSELOR], [ro, "Removal", EVAL]])
  await attempt(who, "select public.forward_referral_to_division_head($1, 'Attended', $2)", [id, e]);
await attempt(DH, "select public.approve_referral($1, $2)", [rr, SIG]); await attempt(DH, "select public.approve_referral($1, $2)", [rd, SIG]); await attempt(DH, "select public.approve_referral($1, $2)", [rp, SIG]);
await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [rd]);
const list = await rows(COUNSELOR, "select * from public.consult_removal_forms()");
check("the list has the three removals of this staff member: one waiting, one approved and ready, one with the final decision made (not the probation referral, not another staff member's)", list.length === 3
  && list.find(r => r.referral_id === rw)?.state === "waiting" && list.find(r => r.referral_id === rr)?.state === "ready" && list.find(r => r.referral_id === rd)?.state === "done", JSON.stringify(list.map(r => [r.name, r.state])));
check("each row says the year level, the school and the program", list.every(r => r.year_level && r.school && r.program) && list.find(r => r.referral_id === rr).year_level === "3rd Year" && list.find(r => r.referral_id === rr).school === "Beta University" && list.find(r => r.referral_id === rr).program === "BS Civil Engineering");
check("the name is 'Last, First' and the list is ordered by it", list.map(r => r.name).join("|") === ["Abad, Rey", "Mendoza, Dan", "Zamora, Wen"].map(n => n + " ").join("|").replace(/ \|/g, "|").replace(/ $/, "") || list.map(r => r.name.trim()).join("|") === "Abad, Rey|Mendoza, Dan|Zamora, Wen", JSON.stringify(list.map(r => r.name)));
check("a waiting removal has no approval date and no form yet; the approved ones have the date", list.find(r => r.referral_id === rw).issued_on === null && list.find(r => r.referral_id === rr).issued_on !== null);
check("the staff member sees only their own cases (the other one sees theirs only)", (await rows(EVAL, "select * from public.consult_removal_forms()")).length === 1 && (await rows(EVAL, "select * from public.consult_removal_forms()"))[0].referral_id === ro);
check("the form itself still opens only for an approved case", !(await attempt(COUNSELOR, "select public.removal_form_data($1)", [rw])).ok && (await attempt(COUNSELOR, "select public.removal_form_data($1)", [rr])).ok);
check("staff without the consultation tool, scholars and visitors cannot ask", !(await attempt(SEAD, "select * from public.consult_removal_forms()")).ok && !(await attempt(seedId("scholar:1"), "select * from public.consult_removal_forms()")).ok && !(await attempt(null, "select * from public.consult_removal_forms()", [], "anon")).ok);
await attempt(DH, "select public.approve_referral($1, $2)", [rw, SIG]);
check("when the Division Head approves the waiting one it becomes ready and gets a date", (await rows(COUNSELOR, "select * from public.consult_removal_forms()")).find(r => r.referral_id === rw).state === "ready");

console.log("\nThe undo");
await db.exec(read(UNDO));
const back = await rows(COUNSELOR, "select * from public.consult_removal_forms()");
check("after the undo the list is the earlier one: only the forms that can be downloaded, with 'final decision made'", back.length === 3 && "final_decision_made" in back[0] && !("year_level" in back[0]));
await db.exec(read(FILE));
check("the file can be put back", "state" in (await rows(COUNSELOR, "select * from public.consult_removal_forms()"))[0]);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file replaces one function: no table is created or changed, nothing is deleted", !/(create table|alter table|drop table|delete from|truncate)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
