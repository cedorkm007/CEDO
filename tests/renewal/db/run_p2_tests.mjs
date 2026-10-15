// tests/renewal/db/run_p2_tests.mjs — Phase 2 database checks: the renewal rules, applications, documents, windows, late applications,
// INC handling, the evaluator's actions, notifications and who may do what.
//
// It builds the SAME private database the local demo uses (every real migration file, in memory), loads the demo's TEST data,
// and then exercises it through the real functions, signed in as a scholar / evaluator / counselor with the `authenticated` role
// (so permissions and row-level security are tested too). Run:  node tests/renewal/db/run_p2_tests.mjs   (about a minute)
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import crypto from "node:crypto";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

const day = n => new Date(Date.now() + 8 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), SEAD = staffUid("demo.sead"), DH = staffUid("demo.divhead");

/** Runs fn signed in as `uid` with the `authenticated` role; returns its value. Errors are thrown. */
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
const recordOf = async (n, year, term) => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), year, term]))[0];
const W1 = seedId("window:w1"), W2 = seedId("window:w2"), W3 = seedId("window:w3");
const fixtureUids = {};
const uidOf = n => fixtureUids[n] ?? scholarUid(n);
const iso = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const apply = async (n, windowId, note = "") => (await rpc(uidOf(n), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', $2) as r", [windowId, note]))[0].r;
const kinds = r => (r.evaluation.required_documents ?? []).map(d => d.kind).sort().join(",");

console.log("\nBasis semester");
{
  const rows = (await q(`select (public._renewal_basis('2026-2027','1st Semester')).*`))[0];
  check("1st Semester 2026-2027 is judged on 2nd Semester 2025-2026", rows.basis_school_year === "2025-2026" && rows.basis_term === "2nd Semester");
  const r2 = (await q(`select (public._renewal_basis('2026-2027','2nd Semester')).*`))[0];
  check("2nd Semester 2026-2027 is judged on 1st Semester 2026-2027", r2.basis_school_year === "2026-2027" && r2.basis_term === "1st Semester");
  const r3 = (await q(`select (public._renewal_basis('2026-2027','Summer')).*`))[0];
  check("Summer 2026-2027 is judged on 2nd Semester 2026-2027", r3.basis_school_year === "2026-2027" && r3.basis_term === "2nd Semester");
}

console.log("\nApplying as TEST scholars: the stage, the rule and the documents (scenario numbers from the spec)");
const T = "2026-2027", S1 = "1st Semester";
const scenarios = [
  // [scenario, scholar, stage, rule, documents]
  ["1  All passed, SDP complete", 1, "ready_for_confirmation", "A", ""],
  ["3  SDP met via carry-over", 19, "ready_for_confirmation", "A", ""],
  ["4  1 failed, no probation", 3, "needs_study_plan_consultation", "B", "study_plan"],
  ["5  1 failed, prior probation", 5, "needs_consultation_division_head", "C1P", ""],
  ["6  2 failed", 4, "needs_consultation_division_head", "C2", ""],
  ["7  1 DRP counts as 1 failed", 6, "needs_study_plan_consultation", "B", "study_plan"],
  ["8  1 DRP + 1 failed = 2 failed", 21, "needs_consultation_division_head", "C2", ""],
  ["9  1 failed in an Excluded-from-GWA subject", 20, "needs_study_plan_consultation", "B", "study_plan"],
  ["10 INC only, before consultation", 7, "needs_inc_letter_consultation", "D", "inc_letter"],
  ["15 1 failed + 1 INC", 22, "needs_study_plan_consultation", "B+D", "inc_letter,study_plan"],
  ["16 past temporary probation lifted, now 1 failed", 24, "needs_study_plan_consultation", "B", "study_plan"],
  ["17 INC then set to Probationary, now 1 failed", 25, "needs_consultation_division_head", "C1P", ""],
  ["26 higher-is-better school: 1 failed", 15, "needs_study_plan_consultation", "B", "study_plan"],
  ["26 higher-is-better school: all passed", 14, "ready_for_confirmation", "A", ""],
  ["27 letter-grade school: not submitted yet", 17, "waiting_grades", null, ""],
  ["--  school has no passing mark", 18, "review_needed", "REVIEW", ""],
  ["--  an unreadable mark (W)", 9, "review_needed", "REVIEW", ""],
  ["--  a blank grade", 8, "waiting_grades", "WAITING", ""],
  ["--  grade equal to the passing mark passes", 2, "ready_for_confirmation", "A", ""],
  ["2  SDP 2 credits in one category", 10, "sdp_on_hold", "SDP_HOLD", ""],
];
for (const [label, n, stage, rule, docs] of scenarios) {
  await apply(n, W1);
  const r = await recordOf(n, T, S1);
  check(`${label}: ${stage}${rule ? ` (${rule})` : ""}`, r.stage === stage && (rule === null || r.rule_code === rule) && kinds(r) === docs, `got ${r.stage}/${r.rule_code}/${kinds(r)}`);
}
{
  const r = await recordOf(10, T, S1);
  check("2  on hold shows exactly what is missing", /Formation Program: 2 of 3/.test(r.evaluation.reason), r.evaluation.reason);
  const prev = await recordOf(1, T, S1);
  check("applying records who and when (history)", (await q("select count(*)::int n from renewal_history where record_id = $1", [prev.id]))[0].n >= 1);
}

console.log("\nINC scenarios (10-14)");
{
  const r10 = await recordOf(7, T, S1);
  const item10 = (await q("select * from renewal_inc_items where record_id = $1", [r10.id]))[0];
  check("10 the INC subject becomes an open item with no deadline yet", item10.state === "open" && item10.deadline === null);
  check("10 the scholar is placed on temporary Probationary status", (await q("select status from scholars where scholar_id_number = $1", [num(7)]))[0].status === "Probationary");
  check("10 history marks it TEMPORARY", (await q("select count(*)::int n from scholar_status_history where scholar_id_number = $1 and status = 'Probationary' and is_temporary", [num(7)]))[0].n === 1);
  check("10 temporary probation does NOT count as previous probation", (await q("select public.scholar_had_regular_probation($1) r", [num(7)]))[0].r === false);

  const r11 = await recordOf(33, T, S1);
  const item11 = (await q("select * from renewal_inc_items where record_id = $1", [r11.id]))[0];
  check("only consultation staff may set an INC deadline (not the evaluator, not a scholar)",
    await fails(EVAL, "select public.renewal_set_inc_deadline($1, $2::date, 10, '')", [item11.id, day(0)], /consultation staff/)
    && await fails(scholarUid(33), "select public.renewal_set_inc_deadline($1, $2::date, 10, '')", [item11.id, day(0)], /consultation staff/));
  check("11 deadline = consultation date + 30 days", iso(item11.deadline) === day(-5 + 30) && item11.days_given === 30, String(item11.deadline));
  check("11 the case is waiting for INC compliance", r11.stage === "inc_waiting_compliance");

  // 12 resolved with a passing grade
  const r12 = await recordOf(26, T, S1);
  check("12 before: waiting for INC compliance and Probationary", r12.stage === "inc_waiting_compliance" && (await q("select status from scholars where scholar_id_number = $1", [num(26)]))[0].status === "Probationary");
  await q("update scholar_subjects_grades set grade = '1.5' where scholar_id_number = $1 and subject_code = 'TST100' and school_year = '2025-2026' and semester = '2nd Semester'", [num(26)]);
  const a12 = await recordOf(26, T, S1);
  check("12 INC passed: ready for evaluator confirmation", a12.stage === "ready_for_confirmation" && a12.rule_code === "A", `${a12.stage}/${a12.rule_code}`);
  check("12 temporary probation lifted", (await q("select status from scholars where scholar_id_number = $1", [num(26)]))[0].status === "Regular");
  check("12 the INC item is resolved (passed)", (await q("select state from renewal_inc_items where record_id = $1", [a12.id]))[0].state === "resolved_passed");

  // 13 resolved with a failing grade
  await q("update scholar_subjects_grades set grade = '5.0' where scholar_id_number = $1 and subject_code = 'TST100' and school_year = '2025-2026' and semester = '2nd Semester'", [num(27)]);
  const a13 = await recordOf(27, T, S1);
  check("13 INC failed: counts as 1 failed, study plan requested", a13.stage === "needs_study_plan_consultation" && a13.rule_code === "B" && kinds(a13) === "study_plan", `${a13.stage}/${a13.rule_code}/${kinds(a13)}`);
  check("13 the scholar was told a new document is needed", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'document_required'", [num(27)]))[0].n === 1);

  // 14 deadline passed
  const r14 = await recordOf(28, T, S1);
  check("14 deadline passed: decision needed", r14.stage === "inc_deadline_passed", r14.stage);
  const list = await rpc(EVAL, "select * from public.renewal_inc_list($1, $2)", [T, S1]);
  const row14 = list.find(x => x.scholar_id_number === num(28));
  check("14 appears in the INC compliance list with negative days left", row14 && row14.days_left < 0, JSON.stringify(row14?.days_left));
  check("the INC list is sorted soonest deadline first", list.every((x, i) => i === 0 || x.deadline === null || list[i - 1].deadline === null || iso(list[i - 1].deadline) <= iso(x.deadline)));
}

console.log("\nINC resolved through the REAL correction route (school asks, CEDO approves, school enters the grade)");
{
  const SCHOOL = seedId("schoolacct:lower");
  await mkScholar(102, { grades: ["INC", "1.5"] });
  await apply(102, W1);
  const before = await recordOf(102, T, S1);
  check("a submitted period is locked: the school cannot just change the INC grade", before.stage === "needs_inc_letter_consultation"
    && await fails(SCHOOL, "select public.upsert_scholar_subject_grade($1,$2,'2025-2026','2nd Semester','FX0','TEST – S0','1.75',3,null,null)",
      [(await q("select id from scholar_subjects_grades where scholar_id_number = $1 and subject_code = 'FX0'", [num(102)]))[0].id, num(102)]));
  const gradeId = (await q("select id from scholar_subjects_grades where scholar_id_number = $1 and subject_code = 'FX0'", [num(102)]))[0].id;
  const reqId = (await rpc(SCHOOL, "select public.request_grade_correction($1,'The student finished the make-up exam','1.75') as r", [gradeId]))[0].r;
  check("the school's request does not change the renewal yet", (await recordOf(102, T, S1)).stage === "needs_inc_letter_consultation");
  await rpc(SEAD, "select public.review_grade_correction($1, true, 'ok')", [reqId]);
  await rpc(SCHOOL, "select public.upsert_scholar_subject_grade($1,$2,'2025-2026','2nd Semester','FX0','TEST – S0','1.75',3,null,null)", [gradeId, num(102)]);
  const after = await recordOf(102, T, S1);
  check("the school's entry re-evaluates the renewal by itself: INC passed, ready for the evaluator", after.stage === "ready_for_confirmation" && after.rule_code === "A", `${after.stage}/${after.rule_code}`);
  check("and the temporary probation is lifted", (await q("select status from scholars where scholar_id_number = $1", [num(102)]))[0].status === "Regular");
}

console.log("\nEvaluator decisions after an INC deadline passes");
{
  const r = await recordOf(28, T, S1);
  const item = (await q("select * from renewal_inc_items where record_id = $1", [r.id]))[0];
  check("a reason is required", await fails(EVAL, "select public.renewal_decide_inc($1,'extend','',$2)", [item.id, day(10)], /reason/i));
  check("a counselor cannot decide", await fails(COUNSELOR, "select public.renewal_decide_inc($1,'extend','Student asked for more time',$2)", [item.id, day(10)], /Evaluator/));
  await rpc(EVAL, "select public.renewal_decide_inc($1,'extend','Student asked for more time',$2)", [item.id, day(10)]);
  const after = await recordOf(28, T, S1);
  check("extend: back to waiting for compliance with the new deadline", after.stage === "inc_waiting_compliance"
    && iso((await q("select deadline from renewal_inc_items where id = $1", [item.id]))[0].deadline) === day(10));
  check("extend: the extension is kept in the history with its reason", (await q("select count(*)::int n from renewal_inc_extensions where item_id = $1 and reason like 'Student asked%'", [item.id]))[0].n === 1);
  // let it pass again, then count it as failed
  await q("update renewal_inc_items set deadline = $2 where id = $1", [item.id, day(-1)]);
  await rpc(EVAL, "select 1 from public.renewal_inc_list($1,$2)", [T, S1]);
  check("the deadline passing again is noticed without a scheduler", (await recordOf(28, T, S1)).stage === "inc_deadline_passed");
  await rpc(EVAL, "select public.renewal_decide_inc($1,'count_failed','No completion after extension',null)", [item.id]);
  const cf = await recordOf(28, T, S1);
  check("count as failed: normal rules apply (1 failed -> study plan path)", cf.stage === "needs_study_plan_consultation" && cf.rule_code === "B", `${cf.stage}/${cf.rule_code}`);
  check("count as failed: the temporary probation is lifted", (await q("select status from scholars where scholar_id_number = $1", [num(28)]))[0].status === "Regular");
}
{
  // set the status to regular Probationary -> counts as previous probation later (decision 2e)
  const r = await recordOf(33, T, S1);
  const item = (await q("select * from renewal_inc_items where record_id = $1", [r.id]))[0];
  await q("update renewal_inc_items set deadline = $2 where id = $1", [item.id, day(-1)]);
  await rpc(EVAL, "select 1 from public.renewal_inc_list($1,$2)", [T, S1]);
  await rpc(EVAL, "select public.renewal_decide_inc($1,'set_status','Did not comply; placed on probation',null,'Probationary')", [item.id]);
  check("set status Probationary: it now counts as previous probation", (await q("select public.scholar_had_regular_probation($1) r", [num(33)]))[0].r === true);
  check("set status Probationary: the scholar is Probationary (not temporary)", (await q("select status from scholars where scholar_id_number = $1", [num(33)]))[0].status === "Probationary");
}

console.log("\nLate applications (scenario 21) and the Not applied list (scenario 20)");
{
  const late = await recordOf(29, "2025-2026", S1);
  check("21 a late application is 'Late - needs evaluator acceptance'", late.stage === "late_pending" && late.is_late && late.late_decision === "pending");
  check("21 a reason is required to accept", await fails(EVAL, "select public.renewal_late_decide($1,true,'')", [late.id], /reason/i));
  check("21 only the evaluator can accept", await fails(COUNSELOR, "select public.renewal_late_decide($1,true,'OK by me')", [late.id], /Evaluator/));
  await rpc(EVAL, "select public.renewal_late_decide($1,true,'Hospitalised during the window')", [late.id]);
  const acc = await recordOf(29, "2025-2026", S1);
  check("21 once accepted it continues normally (ready, rule A)", acc.stage === "ready_for_confirmation" && acc.late_decision === "accepted", `${acc.stage}`);
  const na = await rpc(EVAL, "select * from public.renewal_not_applied($1,$2)", [T, S1]);
  const ids = na.map(x => x.scholar_id_number);
  check("20 a scholar who did not apply is on the Not applied list", ids.includes(num(13)) || ids.includes(num(30)));
  check("20 Removed and On leave scholars are not on it", !ids.includes(num(12)) && !ids.includes(num(11)));
  check("20 scholars who applied are not on it", !ids.includes(num(1)) && !ids.includes(num(3)));
  await rpc(EVAL, "select public.renewal_mark_not_required($1,$2,$3,'Graduating')", [num(30), T, S1]);
  check("20 'Not required this term' removes a scholar from the list", !(await rpc(EVAL, "select * from public.renewal_not_applied($1,$2)", [T, S1])).some(x => x.scholar_id_number === num(30)));
}

console.log("\nWaiting for grades re-checks automatically (scenario 19)");
{
  const r = await recordOf(17, T, S1);
  check("19 waiting for grades, not failed", r.stage === "waiting_grades");
  const lettersSchool = seedId("school:letters");
  const period = (await q("select id from academic_periods where school_year = '2025-2026' and term = '2nd Semester'"))[0].id;
  await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1,$2,'submitted', now())", [lettersSchool, period]);
  const after = await recordOf(17, T, S1);
  check("19 when the school submits, the application moves on by itself (1 failed -> study plan)", after.stage === "needs_study_plan_consultation", after.stage);
  await q("update school_period_submissions set status = 'reopened' where school_id = $1 and period_id = $2", [lettersSchool, period]);
  check("19 if CEDO reopens the submission, it goes back to waiting", (await recordOf(17, T, S1)).stage === "waiting_grades");
  await q("update school_period_submissions set status = 'submitted' where school_id = $1 and period_id = $2", [lettersSchool, period]);
}

console.log("\nSDP on hold re-checks automatically");
{
  const r = await recordOf(10, T, S1);
  check("on hold before the credit is recorded", r.stage === "sdp_on_hold");
  const act = (await q("select id from sdp_activities where name = 'TEST – Formation Seminar'"))[0].id;
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) values ($1,$2,'2026-04-20','2025-2026','2nd Semester')", [act, num(10)]);
  check("a new SDP credit releases the hold (ready, rule A)", (await recordOf(10, T, S1)).stage === "ready_for_confirmation");
}

console.log("\nSummer renewal (scenarios 22-25)");
{
  await apply(30, W2).catch(() => null);
  // 30 was marked 'not required' for the 1st Semester only, so Summer is a separate record
  const r22 = await recordOf(30, "2025-2026", "Summer");
  check("22 Summer: SDP is not checked", r22.evaluation.sdp.applicable === false);
  check("22 Summer, all passed: prospectus required, face-to-face consultation", r22.stage === "summer_requirements" && kinds(r22) === "prospectus" && r22.consultation_required);
  check("22 rule code carries the Summer addition", r22.rule_code === "A+S", r22.rule_code);
  const lettersSub = (await q("select school_id, period_id from school_period_submissions where school_id = $1 and status = 'submitted' limit 1", [seedId("school:letters")]))[0];
  await q("update school_period_submissions set status = 'reopened' where school_id = $1 and period_id = $2", [lettersSub.school_id, lettersSub.period_id]);
  await apply(31, W2);
  check("23 Summer, incomplete grades: waiting for complete grades (school not submitted)", (await recordOf(31, "2025-2026", "Summer")).stage === "waiting_grades");
  await q("update school_period_submissions set status = 'submitted' where school_id = $1 and period_id = $2", [lettersSub.school_id, lettersSub.period_id]);
  await apply(3, W2);
  const r24 = await recordOf(3, "2025-2026", "Summer");
  check("24 Summer, 1 failed: prospectus + study plan", r24.rule_code === "B+S" && kinds(r24) === "prospectus,study_plan", `${r24.rule_code}/${kinds(r24)}`);
  await apply(7, W2);
  const r25 = await recordOf(7, "2025-2026", "Summer");
  check("25 Summer, INC: prospectus + INC letter", kinds(r25) === "inc_letter,prospectus", kinds(r25));

  // complete the Summer all-passed case: prospectus, consultation, hard copy -> ready -> confirm
  const doc = (await rpc(scholarUid(30), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
    values ($1, $2, 'prospectus', $3, 'prospectus.pdf', 'application/pdf', 1000) returning id`, [r22.id, num(30), `${num(30)}/${r22.id}/prospectus/${crypto.randomUUID()}-prospectus.pdf`]))[0];
  check("22 the prospectus upload is accepted", !!doc.id);
  check("22 still needs the consultation and hard copy", (await recordOf(30, "2025-2026", "Summer")).stage === "summer_requirements");
  await q("update renewal_records set consultation_done_at = now(), hard_copy_received_at = now() where id = $1", [r22.id]);
  await rpc(EVAL, "select 1 from public.renewal_board('2025-2026','Summer')");
  await q("update renewal_documents set status = 'accepted' where id = $1", [doc.id]);   // fires the automatic re-check
  check("22 prospectus + consultation + hard copy: ready for evaluator confirmation", (await recordOf(30, "2025-2026", "Summer")).stage === "ready_for_confirmation");
  await rpc(EVAL, "select public.renewal_confirm($1, 'Summer confirmed')", [r22.id]);
  const c22 = await recordOf(30, "2025-2026", "Summer");
  check("22 the evaluator's confirmation makes it Renewed", c22.stage === "renewed" && c22.result === "renewed" && !!c22.confirmed_at);
}

console.log("\nConfirming, returning and the one-failed rule");
{
  const r1 = await recordOf(1, T, S1);
  check("only the evaluator can confirm", await fails(COUNSELOR, "select public.renewal_confirm($1,'')", [r1.id], /Evaluator/));
  check("a scholar cannot confirm their own renewal", await fails(scholarUid(1), "select public.renewal_confirm($1,'')", [r1.id], /Evaluator/));
  check("not ready -> cannot confirm", await fails(EVAL, "select public.renewal_confirm($1,'')", [(await recordOf(4, T, S1)).id], /not ready/i));
  await rpc(EVAL, "select public.renewal_confirm($1,'All good')", [r1.id]);
  const c1 = await recordOf(1, T, S1);
  check("1 confirm: Renewed, with who and when", c1.stage === "renewed" && c1.result === "renewed" && c1.confirmed_by === EVAL);
  check("1 the scholar was notified in the portal", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'renewal_confirmed'", [num(1)]))[0].n === 1);
  // after confirmation nothing changes by itself (decision 12)
  await q("update scholar_subjects_grades set grade = '5.0' where scholar_id_number = $1 and subject_code = 'TST100' and school_year = '2025-2026' and semester = '2nd Semester'", [num(1)]);
  const still = await recordOf(1, T, S1);
  check("after confirmation a grade change does NOT change the renewal", still.stage === "renewed" && still.result === "renewed");

  // return with comments, scholar resubmits
  const r2 = await recordOf(2, T, S1);
  check("returning needs a comment", await fails(EVAL, "select public.renewal_return($1,'')", [r2.id], /comment/i));
  await rpc(EVAL, "select public.renewal_return($1,'Please confirm your program first')", [r2.id]);
  check("returned with comments", (await recordOf(2, T, S1)).stage === "returned");
  await rpc(scholarUid(2), "select public.renewal_resubmit($1,'Updated my details')", [r2.id]);
  check("the scholar resubmits and the rules run again", (await recordOf(2, T, S1)).stage === "ready_for_confirmation");

  // 1 failed: the evaluator ENDORSES to the Division Head (not confirmed by the evaluator); an approved probation then counts as previous probation (scenario 18)
  const fx = await mkScholar(101, { grades: ["5.0", "1.5"] });
  await apply(101, W1);
  let rf = await recordOf(101, T, S1);
  check("18 setup: 1 failed, no probation yet -> rule B", rf.rule_code === "B");
  await rpc(fx.uid, `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
    values ($1,$2,'study_plan',$3,'plan.pdf','application/pdf',500)`, [rf.id, num(101), `${num(101)}/${rf.id}/study_plan/${crypto.randomUUID()}-plan.pdf`]);
  await q("update renewal_records set consultation_done_at = now() where id = $1", [rf.id]);
  await q("update renewal_documents set status = 'accepted' where record_id = $1", [rf.id]);
  rf = await recordOf(101, T, S1);
  check("18 study plan + consultation done: ready to endorse to the Division Head", rf.stage === "ready_to_endorse", rf.stage);
  check("the evaluator cannot simply confirm a 1-failed case", await fails(EVAL, "select public.renewal_confirm($1,'')", [rf.id], /endorsed to the Division Head/));
  check("only the evaluator can endorse", await fails(COUNSELOR, "select public.renewal_endorse($1,'')", [rf.id], /Evaluator/) && await fails(fx.uid, "select public.renewal_endorse($1,'')", [rf.id], /Evaluator/));
  await rpc(EVAL, "select public.renewal_endorse($1,'Plan is sound; recommend Probationary')", [rf.id]);
  rf = await recordOf(101, T, S1);
  check("endorsed: the case is with the Division Head and the rules leave it alone", rf.stage === "endorsed_division_head");
  await q("update scholar_subjects_grades set grade = '1.5' where scholar_id_number = $1 and subject_code = 'FX0' and school_year = '2025-2026'", [num(101)]);
  check("a later grade change does not move an endorsed case", (await recordOf(101, T, S1)).stage === "endorsed_division_head");
  check("the scholar was told it went to the Division Head", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and title like '%Division Head%'", [num(101)]))[0].n === 1);
  check("an endorsed case cannot be endorsed twice", await fails(EVAL, "select public.renewal_endorse($1,'')", [rf.id], /not ready/));
  // The Division Head's approval is built in a later phase; here it is simulated so the previous-probation rule can be checked next term.
  await q("select public._renewal_set_status($1,'Probationary',false,'Division Head approved (simulated)')", [num(101)]);
  check("7 an approved probation counts as previous probation", (await q("select public.scholar_had_regular_probation($1) r", [num(101)]))[0].r === true);
  await q("update scholar_subjects_grades set grade = '5.0' where scholar_id_number = $1 and subject_code = 'FX0' and school_year = '2025-2026'", [num(101)]);
  // next term: 2nd Semester 2026-2027 judged on 1st Semester 2026-2027, one failed again
  const w4 = (await rpc(EVAL, "select public.renewal_window_save(null,'2026-2027','2nd Semester',$1,$2,true,'')", [day(-1), day(20)]))[0].renewal_window_save;
  await q("insert into academic_periods (school_year, term, status) values ('2026-2027','1st Semester','open') on conflict do nothing");
  const p1 = (await q("select id from academic_periods where school_year = '2026-2027' and term = '1st Semester'"))[0].id;
  await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1,$2,'submitted', now())", [seedId("school:lower"), p1]);
  await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, units, recorded_by_school_id, period_id) values ($1,'2026-2027','1st Semester','TEST – Math','M1','5.0',3,$2,$3)", [num(101), seedId("school:lower"), p1]);
  await q(`insert into sdp_activities (name, category, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, recurring_dates, credits, all_year_levels, target_year_levels, target_barangays, target_clusters)
    select name || ' (2nd set)', category, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, recurring_dates, credits, all_year_levels, target_year_levels, target_barangays, target_clusters
    from sdp_activities where name in ('TEST – Community Service Day','TEST – Volunteer Drive','TEST – Formation Seminar')`);
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) select a.id, $1, '2026-09-01', '2026-2027', '1st Semester' from sdp_activities a where a.name like '% (2nd set)'", [num(101)]);
  await apply(101, w4);
  const next = await recordOf(101, "2026-2027", "2nd Semester");
  check("18 renewed as Probationary last term, now 1 failed: same as scenario 5 (consultation + Division Head)", next.rule_code === "C1P" && next.stage === "needs_consultation_division_head", `${next.rule_code}/${next.stage}`);
}

console.log("\nApplying: windows, and who may apply");
{
  const w5 = (await rpc(EVAL, "select public.renewal_window_save(null,'2027-2028','1st Semester',$1,$2,true,'')", [day(30), day(50)]))[0].renewal_window_save;
  check("a window that has not opened refuses applications", await fails(scholarUid(2), "select public.renewal_apply($1,'S','P','2nd Year','')", [w5], /opens on/));
  const w6 = (await rpc(EVAL, "select public.renewal_window_save(null,'2024-2025','1st Semester',$1,$2,false,'')", [day(-200), day(-180)]))[0].renewal_window_save;
  check("a closed window with late applications switched off refuses", await fails(scholarUid(2), "select public.renewal_apply($1,'S','P','2nd Year','')", [w6], /not accepting late/));
  check("applying twice for a term is refused", await fails(scholarUid(1), "select public.renewal_apply($1,'S','P','2nd Year','')", [W1], /already applied/));
  check("a Removed scholar cannot apply", await fails(scholarUid(12), "select public.renewal_apply($1,'S','P','2nd Year','')", [W1], /not active/));
  check("confirming school, program and year level is required", await fails(scholarUid(13), "select public.renewal_apply($1,'','','','')", [W1], /confirm your school/));
  check("only the evaluator can open a window", await fails(COUNSELOR, "select public.renewal_window_save(null,'2030-2031','Summer',$1,$2,true,'')", [day(1), day(2)], /Evaluator/));
  check("a closing date before the opening date is refused", await fails(EVAL, "select public.renewal_window_save(null,'2031-2032','Summer',$1,$2,true,'')", [day(5), day(1)], /closing date/));
  check("a second window for the same term is refused", await fails(EVAL, "select public.renewal_window_save(null,'2026-2027','1st Semester',$1,$2,true,'')", [day(1), day(5)], /already/));
  check("a window with applications cannot be deleted", await fails(EVAL, "select public.renewal_window_delete($1)", [W1], /already applied/));
  await rpc(EVAL, "select public.renewal_window_delete($1)", [w5]);
}

console.log("\nDocuments");
{
  const r = await recordOf(3, T, S1);     // needs a study plan only
  const path = n => `${num(3)}/${r.id}/${n}/${crypto.randomUUID()}-f.pdf`;
  const ins = (kind, mime = "application/pdf", size = 100, p) => rpc(scholarUid(3), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,$4,'f',$5,$6)`, [r.id, num(3), kind, p ?? path(kind), mime, size]);
  check("a document that is not needed for the case is refused", await (async () => { try { await ins("inc_letter"); return false; } catch (e) { return /not needed/.test(e.message); } })());
  check("a wrong file type is refused", await (async () => { try { await ins("study_plan", "application/zip"); return false; } catch (e) { return /PDF, Word/.test(e.message); } })());
  check("a file over 10 MB is refused", await (async () => { try { await ins("study_plan", "application/pdf", 20_000_000); return false; } catch (e) { return /10 MB/.test(e.message); } })());
  check("a file outside the scholar's own folder is refused", await (async () => { try { await ins("study_plan", "application/pdf", 100, `other/${r.id}/study_plan/x.pdf`); return false; } catch (e) { return /not stored in your folder/.test(e.message); } })());
  await ins("study_plan");
  check("a study plan is accepted", (await q("select count(*)::int n from renewal_documents where record_id = $1", [r.id]))[0].n === 1);
  check("another scholar cannot add a document to this application", await (async () => { try { await rpc(scholarUid(1), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'study_plan',$3,'f','application/pdf',1)`, [r.id, num(3), path("study_plan")]); return false; } catch (e) { return true; } })());
  const rr = await recordOf(3, T, S1);
  check("the required-documents list shows the study plan as satisfied", rr.evaluation.required_documents.find(d => d.kind === "study_plan")?.satisfied === true);
  check("three files per kind at most", await (async () => { await ins("study_plan"); await ins("study_plan"); try { await ins("study_plan"); return false; } catch (e) { return /at most 3/.test(e.message); } })());
}

console.log("\nFlagging a problem, notifications, who sees what");
{
  await rpc(scholarUid(3), "select public.renewal_flag_problem($1,'My Science grade is wrong')", [(await recordOf(3, T, S1)).id]);
  check("a scholar can flag a problem with a note", (await recordOf(3, T, S1)).scholar_note === "My Science grade is wrong");
  check("a note that is too short is refused", await fails(scholarUid(3), "select public.renewal_flag_problem($1,'x')", [(await recordOf(3, T, S1)).id], /at least 5/));
  const list = await rpc(scholarUid(3), "select * from public.scholar_notifications_list(10)");
  check("the scholar sees their own notifications", list.length >= 1 && list.every(n => n.title));
  await rpc(scholarUid(3), "select public.scholar_notifications_mark_read()");
  check("marking as read works", (await rpc(scholarUid(3), "select * from public.scholar_notifications_list(10)")).every(n => n.read_at));
  const others = await rpc(scholarUid(4), "select * from public.scholar_notifications_list(50)");
  check("a scholar never sees another scholar's notifications", others.every(n => !/Science grade/.test(n.body)));
  const mine = await as(scholarUid(3), async tx => (await tx.query("select scholar_id_number from renewal_records")).rows);
  check("a scholar reads only their own renewal records (row-level security)", mine.length >= 1 && mine.every(r => r.scholar_id_number === num(3)), JSON.stringify(mine.map(m => m.scholar_id_number)));
  const sees = await as(SEAD, async tx => (await tx.query("select count(*)::int n from renewal_records")).rows[0].n);
  check("staff without a renewal tag cannot read renewal records", sees === 0);
  const evalSees = await as(EVAL, async tx => (await tx.query("select count(*)::int n from renewal_records")).rows[0].n);
  check("the evaluator can read renewal records", evalSees > 5);
  check("the Division Head can read them too", (await as(DH, async tx => (await tx.query("select count(*)::int n from renewal_records")).rows[0].n)) > 5);
  check("nobody can write renewal records directly", await (async () => { try { await rpc(EVAL, "update renewal_records set stage = 'renewed' where id = $1", [(await recordOf(4, T, S1)).id]); const s = (await recordOf(4, T, S1)).stage; return s !== "renewed"; } catch { return true; } })());
  check("a scholar cannot call the evaluator's board", await fails(scholarUid(3), "select * from public.renewal_board($1,$2)", [T, S1], /Not authorized/));
  check("a scholar cannot see the staff detail page", await fails(scholarUid(3), "select public.renewal_record_detail($1)", [(await recordOf(3, T, S1)).id], /Not authorized/));
  const detail = (await rpc(EVAL, "select public.renewal_record_detail($1) d", [(await recordOf(5, T, S1)).id]))[0].d;
  check("the detail shows application, SDP, grades, probation history and the rule applied", detail.record && detail.evaluation.sdp && detail.evaluation.grades.failed_subjects.length === 1 && detail.status_history.length >= 1 && /previous|probation/i.test(detail.evaluation.rule_text));
  const board = await rpc(EVAL, "select * from public.renewal_board($1,$2)", [T, S1]);
  check("the board lists applications with counts", board.length >= 20 && board.find(b => b.scholar_id_number === num(22))?.failed_count === 1 && board.find(b => b.scholar_id_number === num(22))?.inc_count === 1);
}

console.log("\nSafety: running the same migration twice changes nothing");
{
  const before = (await q("select (select count(*) from renewal_records) r, (select count(*) from renewal_history) h, (select count(*) from scholar_notifications) n"))[0];
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../../../supabase_migration_renewal_p2_application.sql", import.meta.url), "utf8");
  let ok = true;
  try { await db.exec(sql); } catch (e) { ok = false; console.log("   ", e.message); }
  const after = (await q("select (select count(*) from renewal_records) r, (select count(*) from renewal_history) h, (select count(*) from scholar_notifications) n"))[0];
  check("the migration can be run twice", ok);
  check("and keeps every record, history row and notification", JSON.stringify(before) === JSON.stringify(after));
}

// ── helper: a throw-away scholar for scenarios the seed does not cover ──
async function mkScholar(n, { grades }) {
  const uid = crypto.randomUUID();
  const school = seedId("school:lower");
  await q("insert into auth.users (id, email) values ($1,$2)", [uid, `fx${n}@demo.local`]);
  await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, school_id,
      emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
    values ($1,$2,'TEST','Fixture ${n}','T','2005-05-05',$3,'TEST – Lower-Is-Better University','BS Test Studies','Regular','B','2nd Year','1','S','C','P','PH','0',$4,'G','P','0')`, [uid, num(n), `fx${n}@demo.local`, school]);
  const period = (await q("select id from academic_periods where school_year = '2025-2026' and term = '2nd Semester'"))[0].id;
  for (const [i, g] of grades.entries())
    await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, units, recorded_by_school_id, period_id) values ($1,'2025-2026','2nd Semester',$2,$3,$4,3,$5,$6)", [num(n), `TEST – S${i}`, `FX${i}`, g, school, period]);
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) select a.id, $1, '2026-04-15', '2025-2026', '2nd Semester' from sdp_activities a where a.name in ('TEST – Community Service Day','TEST – Volunteer Drive','TEST – Formation Seminar')", [num(n)]);
  fixtureUids[n] = uid;
  return { uid };
}

console.log(`\n${failed === 0 ? "ALL PHASE 2 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
