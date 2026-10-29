// tests/final-decision/db_tests.mjs — the Division Head approves and signs, then the CONSULTING STAFF makes the final decision (only then does the status change)
//   (supabase_migration_final_decision_a_referral_columns.sql and _b_functions.sql)
// Run:  node tests/final-decision/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const A = "supabase_migration_final_decision_a_referral_columns.sql", B = "supabase_migration_final_decision_b_functions.sql", UB = "undo_final_decision_b.sql", UA = "undo_final_decision_a.sql";
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
const statusOf = async s => (await q("select status from scholars where scholar_id_number = $1", [s]))[0].status;
const refOf = async id => (await q("select * from scholar_counseling_referrals where id = $1", [id]))[0];
const notes = async (uid, type) => (await q("select count(*)::int n from notifications where user_id = $1 and type = $2", [uid, type]))[0].n;

await db.exec(read(UB)).catch(() => {}); await db.exec(read(UA)).catch(() => {});      // the harness may already have put the files on: start from the earlier behaviour

console.log("Before the files");
const forwardedBefore = (await q(`select f.id, f.renewal_record_id rec, f.referred_to, f.scholar_id_number s, r.stage from scholar_counseling_referrals f join renewal_records r on r.id = f.renewal_record_id
  where f.status = 'forwarded_to_division_head' and r.stage = 'needs_consultation_division_head' order by f.scholar_id_number limit 1`))[0];
check("the demo has a renewal case with the Division Head (2 or more failed)", !!forwardedBefore);
const gone = await attempt(DH, "select public.consult_final_decisions()");
check("the final-decision list does not exist yet", !gone.ok);

await db.exec(read(A)); await db.exec(read(A));
await db.exec(read(B)); await db.exec(read(B));      // safe to run twice

console.log("\nA consultation referral (not a renewal)");
const free = (await q(`select s.scholar_id_number s from scholars s where s.status = 'Regular' and not exists (select 1 from scholar_counseling_referrals f where f.scholar_id_number = s.scholar_id_number)
  and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number) order by 1 limit 4`)).map(r => r.s);
const [P1, P2] = free;
const mk = async (scholar, endorsed) => (await q(`insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, status)
  values ($1, $2, $3, 'Retained', '[]', '[]', $4, 'pending') returning id`, [scholar, EVAL, COUNSELOR, endorsed]))[0].id;
const r1 = await mk(P1, "On Probation Status"), r2 = await mk(P2, "Removal");
const fw = await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'Attended; recommends Probationary', 'On Probation Status')", [r1]);
check("the consulting staff member endorses the referral to the Division Head (as before)", fw.ok && (await refOf(r1)).status === "forwarded_to_division_head", fw.msg);
await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'Attended', 'Removal')", [r2]);
const ap1 = await attempt(DH, "select public.approve_referral($1, $2)", [r1, SIG]);
const a1 = await refOf(r1);
check("the Division Head approves and signs: the referral is 'approved by the Division Head' and the SCHOLAR'S STATUS DOES NOT CHANGE", ap1.ok && a1.status === "division_head_approved" && a1.signature_path === SIG && a1.approved_by === DH && (await statusOf(P1)) === "Regular", ap1.msg + JSON.stringify(a1));
check("the consulting staff member is told, with what to do", (await notes(COUNSELOR, "referral_final")) === 1 && (await q("select message from notifications where user_id = $1 and type = 'referral_final'", [COUNSELOR]))[0].message.includes("final decision"));
const listed = await rows(COUNSELOR, "select * from public.consult_final_decisions()");
check("it is in the consulting staff member's list: the scholar, the decision and who signed", listed.length === 1 && listed[0].referral_id === r1 && listed[0].decision_label === "Probationary" && listed[0].record_id === null, JSON.stringify(listed));
check("nobody else sees it in their list, and nobody else can make the final decision (another consultation staff member, the evaluator, SEAD staff, the Division Head, a visitor)", (await rows(ADMIN, "select * from public.consult_final_decisions()").catch(() => [])).length === 0
  && (await rows(EVAL, "select * from public.consult_final_decisions()")).length === 0);
for (const [who, name] of [[ADMIN, "another staff member"], [EVAL, "the evaluator"], [SEAD, "SEAD staff"], [DH, "the Division Head"]]) {
  const r = await attempt(who, "select public.consult_finalize_decision($1)", [r1]);
  check(`${name} cannot make the final decision`, !r.ok && /Only the consulting staff|Only the consulting/.test(r.msg) && (await statusOf(P1)) === "Regular", r.msg);
}
check("a scholar and a visitor cannot either", !(await attempt(seedId("scholar:1"), "select public.consult_finalize_decision($1)", [r1])).ok && !(await attempt(null, "select public.consult_finalize_decision($1)", [r1], "anon")).ok);
const fin1 = await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [r1]);
const f1 = await refOf(r1);
check("the consulting staff member makes the final decision: NOW the scholar's status changes (Probationary)", fin1.ok && (await statusOf(P1)) === "Probationary" && f1.status === "approved" && f1.finalized_by === COUNSELOR && f1.finalized_at, fin1.msg);
check("it leaves the list, shows in the approved referrals, and cannot be decided twice", (await rows(COUNSELOR, "select * from public.consult_final_decisions()")).length === 0
  && (await rows(COUNSELOR, "select * from public.scholar_counseling_approved_referrals()")).some(x => x.id === r1) && !(await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [r1])).ok);
await attempt(DH, "select public.approve_referral($1, $2)", [r2, SIG]);
check("a removal referral waits too: the status is still what it was until the final decision", (await statusOf(P2)) === "Regular");
await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [r2]);
check("... and then becomes Removed", (await statusOf(P2)) === "Removed");
check("a referral that was not approved by the Division Head cannot be finalized", !(await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [(await mk(free[2], "On Probation Status"))])).ok);

console.log("\nA renewal case");
const cases = await q(`select f.id fid, f.renewal_record_id rec, f.referred_to, f.scholar_id_number s, r.stage from scholar_counseling_referrals f join renewal_records r on r.id = f.renewal_record_id
  where f.status = 'forwarded_to_division_head' order by r.stage, f.scholar_id_number`);
const two = cases.find(c => c.stage === "needs_consultation_division_head"), one = cases.find(c => c.stage === "endorsed_division_head");
check("the demo has a 2+ failed case and an endorsed 1-failed case with the Division Head", !!two && !!one);
const before2 = (await q("select status from scholars where scholar_id_number = $1", [two.s]))[0].status;
const d2 = await attempt(DH, "select public.renewal_division_head_decide($1, 'reconsidered', $2, 'Dr. Printed Name', 'Give a chance')", [two.rec, SIG]);
const rec2 = (await q("select * from renewal_records where id = $1", [two.rec]))[0], ref2 = await refOf(two.fid);
check("the Division Head approves and signs: the decision is recorded but the scholar's status, the stage and the scholar's notices do not change yet",
  d2.ok && ref2.status === "division_head_approved" && ref2.signatory_name === "Dr. Printed Name" && rec2.division_head_decision === "reconsidered" && rec2.stage === "needs_consultation_division_head"
  && (await statusOf(two.s)) === before2 && (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'The Division Head reconsidered your case'", [two.s])).length === 0, d2.msg);
check("the history says who makes the final decision", (await q("select note from renewal_history where record_id = $1 order by at desc limit 1", [two.rec]))[0].note.includes("makes the final decision"));
check("the consulting staff member the case is assigned to is told", (await notes(two.referred_to, "referral_final")) >= 1);
const q2 = (await rows(DH, "select public.renewal_division_head_queue() q"))[0].q.find(x => x.record_id === two.rec);
check("the Division Head's list shows 'approved, waiting for the final decision' and who makes it", q2?.state === "awaiting_final" && !!q2?.final_by, JSON.stringify(q2));
check("the case cannot be sent back, re-sent, confirmed or decided again while it waits", !(await attempt(DH, "select public.renewal_division_head_return($1, 'Please check again')", [two.rec])).ok
  && !(await attempt(DH, "select public.renewal_division_head_decide($1, 'removed', $2, 'X')", [two.rec, SIG])).ok && !(await attempt(EVAL, "select public.renewal_confirm_decision($1, '')", [two.rec])).ok);
await q("update renewal_records set consultation_done_at = consultation_done_at where id = $1", [two.rec]);      // a re-check must not send it to the Division Head again
check("a re-check does not send the approved case to the Division Head again", (await refOf(two.fid)).status === "division_head_approved");
const outsider = [ADMIN, EVAL, SEAD, DH].find(u => u !== two.referred_to);
const bad = await attempt(outsider, "select public.consult_finalize_decision($1)", [two.fid]);
check("only the staff member the case is assigned to can make the final decision", !bad.ok && /Only the consulting staff/.test(bad.msg) && (await statusOf(two.s)) === before2, bad.msg);
const fin2 = await attempt(two.referred_to, "select public.consult_finalize_decision($1)", [two.fid]);
const rec2b = (await q("select * from renewal_records where id = $1", [two.rec]))[0];
check("the final decision applies it: status Reconsidered, the stage moves, the scholar is told, the referral is closed",
  fin2.ok && (await statusOf(two.s)) === "Reconsidered" && rec2b.stage === "reconsidered" && (await refOf(two.fid)).status === "approved"
  && (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'The Division Head reconsidered your case'", [two.s])).length === 1, fin2.msg);
check("then the evaluator confirms the renewal as before", (await attempt(EVAL, "select public.renewal_confirm_decision($1, 'ok')", [two.rec])).ok && (await q("select stage from renewal_records where id = $1", [two.rec]))[0].stage === "renewed");

const d1 = await attempt(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', $2, 'Dr. Printed Name')", [one.rec, SIG]);
check("an endorsed 1-failed case waits too (status unchanged), and the final decision makes it Probationary and ready for the evaluator", d1.ok && (await statusOf(one.s)) !== "Probationary"
  && (await attempt(one.referred_to, "select public.consult_finalize_decision($1)", [one.fid])).ok && (await statusOf(one.s)) === "Probationary" && (await q("select stage from renewal_records where id = $1", [one.rec]))[0].stage === "division_head_approved");

console.log("\nRemoved, and a case nobody consulted");
const nobody = (await q(`select r.id, r.scholar_id_number s from renewal_records r where r.stage = 'needs_consultation_division_head' and not exists (select 1 from scholar_counseling_referrals f where f.renewal_record_id = r.id) order by 2 limit 1`))[0];
if (nobody) {
  const sent = await attempt(EVAL, "select public.renewal_send_to_division_head($1, 'The scholar did not come to the consultation')", [nobody.id]);
  const fid = (await q("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1", [nobody.id]))[0];
  check("the evaluator sends a case nobody consulted: it is assigned to the evaluator", sent.ok && fid.referred_to === EVAL, sent.msg);
  await attempt(DH, "select public.renewal_division_head_decide($1, 'removed', $2, '', 'No response')", [nobody.id, SIG]);
  const login = async () => (await q("select banned_until from auth.users where id = (select id from scholars where scholar_id_number = $1)", [nobody.s]))[0]?.banned_until;
  check("Removed waits as well: the scholar is not removed and the login is not switched off yet", (await statusOf(nobody.s)) !== "Removed" && !(await login()));
  check("the evaluator it is assigned to makes the final decision: Removed, login switched off", (await attempt(EVAL, "select public.consult_finalize_decision($1)", [fid.id])).ok && (await statusOf(nobody.s)) === "Removed" && !!(await login()));
} else check("a case nobody consulted (none in the demo: skipped)", true);

console.log("\nThe undo");
const waiting = async () => (await q("select count(*)::int n from scholar_counseling_referrals where status = 'division_head_approved'"))[0].n;
const waitingRef = await mk(free[3], "On Probation Status");
await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'x', 'On Probation Status')", [waitingRef]); await attempt(DH, "select public.approve_referral($1, $2)", [waitingRef, SIG]);
let stopped = ""; try { await db.exec(read(UB)); } catch (e) { stopped = String(e.message); }
check("the undo stops, changing nothing, while a case waits for a final decision", /waiting for the consulting staff/.test(stopped) && (await waiting()) === 1, stopped);
await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [waitingRef]);
await db.exec(read(UB)); await db.exec(read(UA));
check("after the final decision the undo goes through: the new functions and columns are gone", !(await attempt(DH, "select public.consult_final_decisions()")).ok
  && (await q("select count(*)::int n from information_schema.columns where table_name = 'scholar_counseling_referrals' and column_name = 'finalized_at'"))[0].n === 0);
const old1 = await mk(free[2], "On Probation Status");
await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'x', 'On Probation Status')", [old1]);
await attempt(DH, "select public.approve_referral($1, $2)", [old1, SIG]);
check("the Division Head's approval changes the status at once again (as before)", (await statusOf(free[2])) === "Probationary" && (await refOf(old1)).status === "approved");
await db.exec(read(A)); await db.exec(read(B));
check("the files can be put back", (await attempt(COUNSELOR, "select * from public.consult_final_decisions()")).ok);
const text = (read(A) + read(B)).replace(/--.*$/gm, "");
check("the files change one table (scholar_counseling_referrals) and nothing is deleted", !/(create table|drop table|delete from|truncate)/i.test(text) && (text.match(/alter table public\.(\w+)/gi) ?? []).every(t => /scholar_counseling_referrals/.test(t)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
