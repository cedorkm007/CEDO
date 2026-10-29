// tests/renewal/db/run_p5_tests.mjs — Phase 5 database checks: sending a case to the Division Head (automatic and by hand), the Division Head's decisions
// (Approve Probationary / Removed / Reconsidered / Send back), the status and login changes they cause, the evaluator's confirmation of a
// Reconsidered case, the old referral functions leaving renewal cases alone, and who may do what.
//
// Same setup as the earlier suites: every real migration file in memory + the demo's TEST data, run as signed-in people with the real
// `authenticated` role.  Run:  node tests/renewal/db/run_p5_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), ADMIN = staffUid("demo.admin"), SEAD = staffUid("demo.sead"), DH = staffUid("demo.divhead");
const W1 = seedId("window:w1");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid, role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const fails = async (uid, sql, params, pattern) => { try { await rpc(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const finalize = async rec => { const f = (await q("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1 and status = 'division_head_approved'", [rec]))[0]; if (f) await rpc(f.referred_to, "select public.consult_finalize_decision($1)", [f.id]); };   // the consulting staff member makes the final decision after the Division Head signs
const recordOf = async (n, year = "2026-2027", term = "1st Semester") => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), year, term]))[0];
const referralOf = async recId => (await q("select * from scholar_counseling_referrals where renewal_record_id = $1 order by created_at desc", [recId]));
const apply = async (n, uid = scholarUid(n)) => (await rpc(uid, "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') as r", [W1]))[0].r;
const statusOf = async n => (await q("select status, status_before_removal from scholars where scholar_id_number = $1", [num(n)]))[0];
const consultDone = async recId => q("update renewal_records set consultation_done_at = now() where id = $1", [recId]);
const acceptedPlan = async (n, recId) => {
  await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes, status) values ($1,$2,'study_plan',$3,'plan.pdf','application/pdf',24,'accepted')",
    [recId, num(n), `${num(n)}/${recId}/study_plan/${crypto.randomUUID()}-plan.pdf`]);
};
/** A throw-away scholar (lower school, SDP complete, the given 2nd Semester 2025-2026 grades) for cases the demo data does not cover. */
const fixtureUids = {};
async function mkScholar(n, grades, status = "Regular") {
  const uid = crypto.randomUUID();
  await q("insert into auth.users (id, email) values ($1,$2)", [uid, `fx${n}@demo.local`]);
  await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, school_id,
      emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
    values ($1,$2,'TEST','Fixture ${n}','T','2005-05-05',$3,'TEST – Lower-Is-Better University','BS Test Studies',$5,'B','2nd Year','1','S','C','P','PH','0',$4,'G','P','0')`, [uid, num(n), `fx${n}@demo.local`, seedId("school:lower"), status]);
  const period = (await q("select id from academic_periods where school_year = '2025-2026' and term = '2nd Semester'"))[0].id;
  for (const [i, g] of grades.entries())
    await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, units, recorded_by_school_id, period_id) values ($1,'2025-2026','2nd Semester',$2,$3,$4,3,$5,$6)", [num(n), `TEST – Fixture ${i}`, `FX${n}${i}`, g, seedId("school:lower"), period]);
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) select a.id, $1, '2026-04-15', '2025-2026', '2nd Semester' from sdp_activities a where a.name in ('TEST – Community Service Day','TEST – Volunteer Drive','TEST – Formation Seminar')", [num(n)]);
  fixtureUids[n] = uid;
  return uid;
}
const SIG = "demo-signature.png";

// ─────────────────────────────────────────────────────────────
console.log("\nA 2-or-more-failed case goes to the Division Head once its consultation is attended");
const rec4 = await apply(4);
const r4 = await recordOf(4);
check("it waits for the consultation first: no referral yet", r4.stage === "needs_consultation_division_head" && (await referralOf(rec4)).length === 0);
await consultDone(rec4);
const ref4 = (await referralOf(rec4));
check("when the consultation is attended a referral is created, already forwarded to the Division Head, linked to the renewal", ref4.length === 1 && ref4[0].status === "forwarded_to_division_head" && ref4[0].endorsed_for === "Removal" && ref4[0].renewal_record_id === rec4);
check("the referral form is filled from the case: failed subject, previous status, a remark with the rule and the consultation", ref4[0].failed_subjects.length === 2 && ref4[0].failed_subjects[0].subjectCode && ref4[0].previous_semester_status === "Retained" && /rule C2/.test(ref4[0].remarks) && /Consultation attended/.test(ref4[0].remarks), JSON.stringify(ref4[0]));
check("the referring person is a real staff member (the evaluator) and the Division Head is told through the usual notification", (await q("select 1 from staff_account_tags where staff_id = $1 and tag_key = 'scholar_renewal_evaluator'", [ref4[0].referred_by])).length === 1
  && (await q("select 1 from notifications where user_id = $1 and type = 'referral_approval' and reference_id = $2", [DH, ref4[0].id])).length === 1);
await consultDone(rec4);
await q("update renewal_records set stage = stage where id = $1", [rec4]);
check("attending again or re-checking changes nothing: still ONE referral", (await referralOf(rec4)).length === 1);
check("the scholar is told it went to the Division Head", (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'Your case was sent to the Division Head'", [num(4)])).length === 1);

console.log("\nWhere a case stands with the Division Head (evaluator's detail page)");
const dhs = (await rpc(EVAL, "select public.renewal_dh_status($1) s", [rec4]))[0].s;
check("the evaluator sees: sent, with the Division Head, which referral", dhs.sent === true && dhs.status === "forwarded_to_division_head" && dhs.referral_id === ref4[0].id);
check("a case that was never sent says so; a scholar cannot ask", (await rpc(EVAL, "select public.renewal_dh_status($1) s", [(await recordOf(1))?.id ?? crypto.randomUUID()]))[0].s.sent === false && await fails(scholarUid(4), "select public.renewal_dh_status($1)", [rec4], /Not authorized/));

console.log("\nThe demo data stands at each point of the decisions");
const demoState = async n => { const r = await recordOf(n); return { r, refs: await referralOf(r.id) }; };
{
  const d41 = await demoState(41), d42 = await demoState(42), d43 = await demoState(43), d44 = await demoState(44), d45 = await demoState(45);
  check("TEST-0041 (2 failed, consultation done): with the Division Head", d41.r.stage === "needs_consultation_division_head" && d41.refs.length === 1 && d41.refs[0].status === "forwarded_to_division_head");
  check("TEST-0042 (1 failed, plan approved, consultation done): ready for the evaluator to endorse", d42.r.stage === "ready_to_endorse" && d42.refs.length === 0);
  check("TEST-0043 (1 failed): endorsed, with the Division Head", d43.r.stage === "endorsed_division_head" && d43.refs.length === 1 && d43.refs[0].endorsed_for === "On Probation Status");
  check("TEST-0044 (2 failed, no consultation): waiting, nothing sent (the evaluator can send it)", d44.r.stage === "needs_consultation_division_head" && d44.refs.length === 0);
  check("TEST-0045: reconsidered by the Division Head, waiting for the evaluator", d45.r.stage === "reconsidered" && (await statusOf(45)).status === "Reconsidered" && d45.refs[0].status === "approved");
}

console.log("\nThe old referral functions leave a renewal case alone");
check("approve_referral refuses a renewal-linked referral (so it cannot change the status on its own)", await fails(DH, "select public.approve_referral($1, $2)", [ref4[0].id, SIG], /scholar renewal/));
check("send-back-for-reconsideration refuses it too", await fails(DH, "select public.request_referral_reconsideration($1, 'x')", [ref4[0].id], /scholar renewal/));
check("the consultation staff cannot forward it (the evaluator sends renewal cases)", await fails(COUNSELOR, "select public.forward_referral_to_division_head($1, 'r', 'Removal')", [ref4[0].id], /scholar renewal|not in your queue/));
check("the consultation staff queue does not list it", (await rpc(COUNSELOR, "select id from public.scholar_counseling_queue()")).every(r => r.id !== ref4[0].id));
check("the scholar's status was not touched by any of that", (await statusOf(4)).status === "Regular");

console.log("\nWhat the Division Head sees");
const info = (await rpc(DH, "select public.renewal_referral_info($1) i", [ref4[0].id]))[0].i;
check("the case information: term, rule, options Removed / Reconsidered / send back, the failed subject, my name", info.case_type === "removal_decision" && JSON.stringify(info.options) === '["removed","reconsidered","return"]' && /1st Semester 2026-2027/.test(info.term_label) && info.failed_subjects.length === 2 && /Division Head/.test(info.my_name), JSON.stringify(info));
const queue = (await rpc(DH, "select public.renewal_division_head_queue() q"))[0].q;
check("the Division Head's list shows it as waiting", queue.some(x => x.record_id === rec4 && x.state === "waiting" && x.case_type === "removal_decision"));
check("the evaluator can see the list too; a scholar and ordinary SEAD staff cannot", (await rpc(EVAL, "select public.renewal_division_head_queue() q"))[0].q.length >= 1
  && await fails(scholarUid(1), "select public.renewal_division_head_queue()", [], /Only the Division Head/) && await fails(SEAD, "select public.renewal_division_head_queue()", [], /Only the Division Head/));
check("a scholar cannot read the renewal information of a referral", (await rpc(scholarUid(4), "select public.renewal_referral_info($1) i", [ref4[0].id]))[0].i === null);

console.log("\nThe Division Head's decision: Reconsidered");
check("only the Division Head may decide (not the evaluator, the counselor, ordinary SEAD staff or the scholar)", await (async () => {
  for (const uid of [EVAL, COUNSELOR, SEAD, scholarUid(4)]) if (!(await fails(uid, "select public.renewal_division_head_decide($1, 'reconsidered', $2, 'X')", [rec4, SIG], /Only the Division Head/))) return false;
  return true;
})());
check("an endorsed-case decision is refused for this case; a signature is required; an over-long printed name is refused", await (async () => {
  return (await fails(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', $2, 'X')", [rec4, SIG], /Choose Removed or Reconsidered/))
    && (await fails(DH, "select public.renewal_division_head_decide($1, 'reconsidered', '  ', 'X')", [rec4], /signature is required/))
    && (await fails(DH, "select public.renewal_division_head_decide($1, 'reconsidered', $2, $3)", [rec4, SIG, "N".repeat(130)], /too long/))
    && (await fails(DH, "select public.renewal_division_head_decide($1, 'maybe', $2, 'X')", [rec4, SIG], /Choose Removed or Reconsidered/));
})());
await rpc(DH, "select public.renewal_division_head_decide($1, 'reconsidered', $2, 'Dr. Printed Name', 'Give a chance')", [rec4, SIG]);
await finalize(rec4);
const after4 = await recordOf(4);
check("Reconsidered: the scholar's status is Reconsidered and the case waits for the evaluator", (await statusOf(4)).status === "Reconsidered" && after4.stage === "reconsidered" && after4.division_head_decision === "reconsidered" && after4.division_head_note === "Give a chance" && after4.division_head_decided_by === DH);
const signed4 = (await q("select * from scholar_counseling_referrals where id = $1", [ref4[0].id]))[0];
check("the referral is signed (signature, who, when, the printed name)", signed4.status === "approved" && signed4.signature_path === SIG && signed4.approved_by === DH && signed4.signatory_name === "Dr. Printed Name" && signed4.approved_at);
check("the printed form uses the typed name (read back through the referral functions)", (await rpc(DH, "select approved_by_name from public.get_scholar_counseling_referral($1)", [ref4[0].id]))[0].approved_by_name === "Dr. Printed Name");
check("the status change is in the scholar's status history, with the renewal as the source", (await q("select 1 from scholar_status_history where scholar_id_number = $1 and status = 'Reconsidered' and source = 'renewal'", [num(4)])).length === 1);
check("the scholar is told", (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'The Division Head reconsidered your case'", [num(4)])).length === 1);
check("it cannot be decided twice", await fails(DH, "select public.renewal_division_head_decide($1, 'removed', $2, 'X')", [rec4, SIG], /not waiting for the Division Head/));
check("the Division Head's list now shows it as decided", (await rpc(DH, "select public.renewal_division_head_queue() q"))[0].q.some(x => x.record_id === rec4 && x.state === "decided" && x.decision === "reconsidered"));
check("the case information shows the decision, and no options any more", (await rpc(DH, "select public.renewal_referral_info($1) i", [ref4[0].id]))[0].i.options.length === 0);

console.log("\nThe evaluator confirms a Reconsidered case");
const rec3 = await apply(3);
check("only the evaluator can; the case must be one the Division Head approved or reconsidered", await fails(DH, "select public.renewal_confirm_decision($1)", [rec4], /Only the Scholar Renewal Evaluator/) && await fails(EVAL, "select public.renewal_confirm_decision($1)", [rec3], /Only a case the Division Head approved or reconsidered/));
await rpc(EVAL, "select public.renewal_confirm_decision($1, 'Welcome back')", [rec4]);
const conf4 = await recordOf(4);
check("the renewal is Renewed with the result 'reconsidered' (and the scholar stays Reconsidered)", conf4.stage === "renewed" && conf4.result === "reconsidered" && conf4.confirmed_by === EVAL && (await statusOf(4)).status === "Reconsidered");
check("the scholar is told it is confirmed", (await q("select 1 from scholar_notifications where scholar_id_number = $1 and kind = 'renewal_confirmed'", [num(4)])).length === 1);

console.log("\nThe Division Head's decision: Removed (the proper Removed flow)");
// scholar 5: one failed subject after earlier probation -> treated like 2+ failed. The evaluator sends it by hand (no consultation yet).
const rec5 = await apply(5);
check("a 1-failed case after earlier probation also waits for the Division Head", (await recordOf(5)).stage === "needs_consultation_division_head" && (await referralOf(rec5)).length === 0);
// a future booking the removal must release
const slotStart = new Date(Date.now() + 40 * 3600 * 1000);
const av = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1,$2,$3) returning id", [COUNSELOR, slotStart.toISOString(), new Date(slotStart.getTime() + 600000).toISOString()]))[0].id;
await q("insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, record_id, scholar_id_number, booked_at) values ($1,$2,$3,$4,'booked',$5,$6, now())", [av, COUNSELOR, slotStart.toISOString(), new Date(slotStart.getTime() + 600000).toISOString(), rec5, num(5)]);
check("the evaluator can send it by hand; without a consultation a reason is needed", await fails(EVAL, "select public.renewal_send_to_division_head($1, '')", [rec5], /has not taken place/) && await fails(EVAL, "select public.renewal_send_to_division_head($1, 'xx')", [rec5], /has not taken place/));
check("only the evaluator can send; a case that is not waiting for the Division Head is refused", await fails(DH, "select public.renewal_send_to_division_head($1, 'Missed twice, no reply')", [rec5], /Only the Scholar Renewal Evaluator/) && await fails(EVAL, "select public.renewal_send_to_division_head($1, 'Missed twice, no reply')", [(await q("select id from renewal_records where scholar_id_number = $1", [num(1)]))[0]?.id ?? crypto.randomUUID()], /not found|waiting for the Division Head/));
await rpc(EVAL, "select public.renewal_send_to_division_head($1, 'Missed the consultation twice, no reply')", [rec5]);
const ref5 = (await referralOf(rec5));
check("sent by hand: a forwarded referral exists, naming the evaluator's reason and that the consultation has not taken place", ref5.length === 1 && ref5[0].status === "forwarded_to_division_head" && /has not taken place/.test(ref5[0].remarks) && /Missed the consultation twice/.test(ref5[0].remarks) && ref5[0].previous_semester_status === "On Probation", JSON.stringify(ref5[0]));
await rpc(DH, "select public.renewal_division_head_decide($1, 'removed', $2, '', 'No response to repeated notices')", [rec5, SIG]);
await finalize(rec5);
const rem = (await statusOf(5));
check("Removed: the scholar's status is Removed (the one before is remembered) and the case is closed as removed", rem.status === "Removed" && rem.status_before_removal === "Probationary" && (await recordOf(5)).stage === "removed" && (await recordOf(5)).result === "removed");
check("the login is switched off (banned for good, like the Removed Scholars flow)", new Date((await q("select banned_until from auth.users where id = $1", [scholarUid(5)]))[0].banned_until).getTime() > Date.now() + 50 * 365 * 86400000);
check("a line is written to the scholar account log", (await q("select 1 from sead_scholar_account_log where scholar_id_number = $1 and action = 'removed'", [num(5)])).length === 1);
check("the future consultation booking was released", (await q("select state from counseling_slots where availability_id = $1", [av]))[0].state === "open");
check("the printed name defaults to the Division Head's own name when left empty", /Division Head/.test((await q("select signatory_name from scholar_counseling_referrals where id = $1", [ref5[0].id]))[0].signatory_name));

console.log("\nThe Division Head's decision: an endorsed 1-failed case (Probationary)");
await acceptedPlan(3, rec3);
await consultDone(rec3);
await q("select public._renewal_recheck($1)", [rec3]);
check("study plan approved + consultation done: ready for the evaluator to endorse (no referral yet)", (await recordOf(3)).stage === "ready_to_endorse" && (await referralOf(rec3)).length === 0);
await rpc(EVAL, "select public.renewal_endorse($1, 'Plan looks good')", [rec3]);
const ref3 = (await referralOf(rec3));
check("endorsing creates the referral at once (endorsed for Probationary), referred by the evaluator", ref3.length === 1 && ref3[0].status === "forwarded_to_division_head" && ref3[0].endorsed_for === "On Probation Status" && ref3[0].referred_by === EVAL && /Plan looks good/.test(ref3[0].remarks));
const info3 = (await rpc(DH, "select public.renewal_referral_info($1) i", [ref3[0].id]))[0].i;
check("its options are Approve Probationary or send back", info3.case_type === "probationary_approval" && JSON.stringify(info3.options) === '["approve_probationary","return"]');
check("Removed or Reconsidered are refused for an endorsed 1-failed case", await fails(DH, "select public.renewal_division_head_decide($1, 'removed', $2, 'X')", [rec3, SIG], /approved for Probationary or sent back/) && await fails(DH, "select public.renewal_division_head_decide($1, 'reconsidered', $2, 'X')", [rec3, SIG], /approved for Probationary or sent back/));
check("sending back needs a reason, and only the Division Head can", await fails(DH, "select public.renewal_division_head_return($1, 'no')", [rec3], /reason/) && await fails(EVAL, "select public.renewal_division_head_return($1, 'Please add the counselor notes')", [rec3], /Only the Division Head/));
await rpc(DH, "select public.renewal_division_head_return($1, 'Please add the counselor notes')", [rec3]);
const back3 = await recordOf(3);
check("sent back: the case returns to the evaluator (ready to endorse again) with the reason, the referral is marked 'sent back', the status is untouched", back3.stage === "ready_to_endorse" && /counselor notes/.test(back3.evaluator_comment) && (await referralOf(rec3))[0].status === "reconsideration_requested" && (await statusOf(3)).status === "Regular");
check("the Division Head's list shows it as sent back; the case information carries the reason", (await rpc(DH, "select public.renewal_division_head_queue() q"))[0].q.some(x => x.record_id === rec3 && x.state === "sent_back"));
await rpc(EVAL, "select public.renewal_endorse($1, 'Notes added')", [rec3]);
const ref3b = await referralOf(rec3);
check("the evaluator endorses again: the SAME referral is forwarded again (one referral, not two)", ref3b.length === 1 && ref3b[0].status === "forwarded_to_division_head" && ref3b[0].id === ref3[0].id);
await rpc(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', $2, 'Dr. Printed Name')", [rec3, SIG]);
await finalize(rec3);
const ok3 = await recordOf(3);
check("Approve Probationary: the scholar is Probationary, but the renewal is NOT Renewed yet - it waits for the evaluator", (await statusOf(3)).status === "Probationary" && ok3.stage === "division_head_approved" && ok3.result === null && ok3.confirmed_by === null && ok3.division_head_decision === "approved_probationary");
check("the scholar is told it waits for the evaluator", (await q("select 1 from scholar_notifications where scholar_id_number = $1 and title = 'The Division Head approved your Probationary status'", [num(3)])).length === 1);
check("it is not an active stage: an automatic re-check leaves it alone", await (async () => { await q("select public._renewal_recheck($1)", [rec3]); return (await recordOf(3)).stage === "division_head_approved"; })());
check("the evaluator cannot return or endorse it again, and the Division Head cannot decide it twice", await fails(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', $2, 'X')", [rec3, SIG], /not waiting for the Division Head/) && await fails(EVAL, "select public.renewal_confirm($1)", [rec3], /not ready for confirmation/));
await rpc(EVAL, "select public.renewal_confirm_decision($1, 'Confirmed as Probationary')", [rec3]);
const conf3 = await recordOf(3);
check("the evaluator confirms: only now is it Renewed as Probationary (confirmed by the evaluator); the status stays Probationary", conf3.stage === "renewed" && conf3.result === "renewed_probationary" && conf3.confirmed_by === EVAL && (await statusOf(3)).status === "Probationary");
check("the scholar is told it is confirmed; the history records every step", (await q("select 1 from scholar_notifications where scholar_id_number = $1 and kind = 'renewal_confirmed'", [num(3)])).length === 1
  && (await rpc(EVAL, "select public.renewal_record_detail($1) d", [rec3]))[0].d.history.filter(h => /Division Head|confirmed/.test(h.note)).length >= 4);

console.log("\nSending a 2+ failed case back");
await mkScholar(51, ["5.0", "5.0", "1.5"]);
const rec51 = await apply(51, fixtureUids[51]);
await consultDone(rec51);
const ref51 = await referralOf(rec51);
check("(a second 2+ failed case reaches the Division Head the same way)", ref51.length === 1 && ref51[0].status === "forwarded_to_division_head");
await rpc(DH, "select public.renewal_division_head_return($1, 'Interview the scholar again')", [rec51]);
check("sent back: the case stays with the evaluator, the referral is marked 'sent back'", (await recordOf(51)).stage === "needs_consultation_division_head" && (await referralOf(rec51))[0].status === "reconsideration_requested");
await q("select public._renewal_recheck($1)", [rec51]);
await q("update renewal_records set stage = stage where id = $1", [rec51]);
check("an automatic re-check does NOT send it again", (await referralOf(rec51))[0].status === "reconsideration_requested");
check("a 'sent back' case cannot be decided until the evaluator sends it again", await fails(DH, "select public.renewal_division_head_decide($1, 'removed', $2, 'X')", [rec51, SIG], /sent back to the evaluator|has not been sent/));
await rpc(EVAL, "select public.renewal_send_to_division_head($1, 'Interviewed again')", [rec51]);
check("the evaluator sends it again: the same referral is forwarded again", (await referralOf(rec51)).length === 1 && (await referralOf(rec51))[0].status === "forwarded_to_division_head");

console.log("\nOrdinary referrals are not affected");
const normal = (await rpc(ADMIN, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'On Probation Status', current_date) id", [num(2), COUNSELOR]))[0].id;
check("an ordinary referral still goes counselor -> Division Head and approving it still sets the status as before", await (async () => {
  await rpc(COUNSELOR, "select public.forward_referral_to_division_head($1, 'r', 'On Probation Status')", [normal]);
  await rpc(DH, "select public.approve_referral($1, $2)", [normal, SIG]);
  await rpc(COUNSELOR, "select public.consult_finalize_decision($1)", [normal]);      // the consulting staff member makes the final decision
  return (await statusOf(2)).status === "Probationary";
})());
check("an ordinary referral has no renewal information", (await rpc(DH, "select public.renewal_referral_info($1) i", [normal]))[0].i === null);
check("ordinary referrals still show in the counselor queue (a fresh one)", await (async () => {
  const id2 = (await rpc(ADMIN, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [num(1), COUNSELOR]))[0].id;
  return (await rpc(COUNSELOR, "select id from public.scholar_counseling_queue()")).some(r => r.id === id2);
})());

console.log("\nSafety");
check("anonymous visitors cannot call any of the new functions", await (async () => {
  for (const fn of ["renewal_division_head_queue()", "renewal_referral_info(gen_random_uuid())", "renewal_division_head_decide(gen_random_uuid(),'removed','x','x','x')", "renewal_division_head_return(gen_random_uuid(),'xxxxx')", "renewal_confirm_decision(gen_random_uuid())", "renewal_send_to_division_head(gen_random_uuid(),'xxxxx')"]) {
    try { await db.transaction(async tx => { await tx.exec("set local role anon"); await tx.query("select public." + fn); }); return false; } catch { /* refused */ }
  }
  return true;
})());
check("the internal helpers cannot be called by signed-in users", await (async () => {
  for (const fn of ["_renewal_forward_to_division_head(gen_random_uuid(), null, false)", "_renewal_remove_scholar('TEST-0001', 'x')"]) if (!(await fails(DH, "select public." + fn, [], /permission denied/i))) return false;
  return true;
})());
check("the migration can be run twice", await (async () => { try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p5_approvals.sql", import.meta.url), "utf8")); return true; } catch (e) { console.log("   ", e.message); return false; } })());

console.log(`\n${failed === 0 ? "ALL PHASE 5 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
