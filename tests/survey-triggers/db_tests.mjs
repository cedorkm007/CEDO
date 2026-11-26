// tests/survey-triggers/db_tests.mjs — Survey Tools phase 4: the creator chooses when a survey is asked (5 checks)
// Run:  node tests/survey-triggers/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.exec("create unique index if not exists t_sdpa on public.sdp_attendance (activity_id, scholar_id_number, occurrence_number)");

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const file = async f => { try { await db.exec(fs.readFileSync(f, "utf8")); return { ok: true }; } catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, msg: String(e.message) }; } };
async function as(uid, sql, p = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, p)).rows;
  });
}
const attempt = async (uid, sql, p = []) => { try { return { ok: true, rows: await as(uid, sql, p) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const STAFF = seedId("staff:demo.sead"), MONITOR = seedId("staff:demo.monitor");
const scholars = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 6");
const [s1, s2, s3, s4, s5] = scholars;
let seq = 0, codeSeq = 0;
async function activity() {
  const id = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time) values ($1, 'community_service', 'one_time', 1, true, now()) returning id", [`TRG ${++seq}`]))[0].id;
  const ses = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [id]))[0].id;
  await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2) on conflict do nothing", [id, MONITOR]);
  return { id, ses };
}
const save = async (id, title, acts, triggers = null) => (await as(STAFF, "select survey_save($1, $2, '', false, '', $3::jsonb, $4::jsonb) id", [id, title, JSON.stringify(acts.map(a => ({ type: "sdp", id: a.id }))), triggers && JSON.stringify(triggers)]))[0].id;
const triggers = (...on) => ({ qr: on.includes("qr"), scanner: on.includes("scanner"), manual: on.includes("manual"), picture: on.includes("picture"), reconsideration: on.includes("reconsideration") });
async function makeSurvey(acts, t = null, title = `S ${++seq}`) {
  const id = await save(null, title, acts, t);
  await as(STAFF, "select survey_question_save($1, $2::jsonb, false)", [id, JSON.stringify({ questionType: "open_ended", questionText: "How was it?", openEndedFormat: "short" })]);
  await as(STAFF, "update research_surveys set is_active = true where id = $1", [id]);
  return id;
}
async function scan(a, s) {
  const code = `T${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', $3)", [a.ses, code, codeSeq]);
  return (await as(s.id, "select public.redeem_attendance_code($1) r", [code]))[0].r;
}
const monitorScan = (a, s) => as(MONITOR, "select public.record_monitor_attendance('sdp', $1, 'voucher', null, $2) r", [a.id, s.n]);
const pending = async s => (await as(s.id, "select my_pending_surveys() r"))[0].r;
async function finish(survey, s, activityId) {
  const r = (await as(s.id, "select start_or_resume_survey_response($1, $2) r", [survey, activityId]))[0].r;
  await as(s.id, "select submit_survey_answer($1, $2, null::uuid, null::integer, 'ok')", [r.responseId, r.questions[0].id]);
  await as(s.id, "select submit_survey_response($1)", [r.responseId]);
}
const credit = async (a, s) => (await q("select count(*)::int c from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [a.id, s.n]))[0].c;
const response = async (survey, s) => q("select activity_id, ask_trigger, status from research_survey_responses where survey_id = $1 and scholar_id_number = $2", [survey, s.n]);
const staffCredit = (a, s) => as(STAFF, "select credit_scholar_for_day($1, $2) r", [a.id, s.n]);
const hinted = async (hint, a, s) => db.transaction(async tx => {
  await tx.query("select set_config('app.sdp_source', $1, true)", [hint]);
  await tx.query("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) values ($1, $2, current_date, 1, '2026-2027', '1st Semester')", [a.id, s.n]);
});

// 1. settings
const run1 = await file("supabase_migration_survey_triggers.sql"), run2 = await file("supabase_migration_survey_triggers.sql");
const A = await activity();
const S1 = await makeSurvey([A]);
const defaults = (await q("select ask_qr, ask_scanner, ask_manual, ask_picture, ask_reconsideration from research_surveys where id = $1", [S1]))[0];
const nothing = await attempt(STAFF, "select survey_save($1, 'x', '', false, '', $2::jsonb, $3::jsonb)", [S1, JSON.stringify([{ type: "sdp", id: A.id }]), JSON.stringify(triggers())]);
const noActivity = await attempt(STAFF, "select survey_save(null, 'x', '', false, '', '[]'::jsonb, $1::jsonb)", [JSON.stringify(triggers("qr"))]);
const R1 = await makeSurvey([], triggers("reconsideration"), "Recon one");
const R2 = await makeSurvey([], triggers("reconsideration"), "Recon two");
const holders = await q("select id from research_surveys where ask_reconsideration");
check("1 the file runs twice; surveys keep asking as today (QR and Scanning Tools only); at least one time must be ticked; only a reconsideration survey may have no activity, and there is only ever one",
  run1.ok && run2.ok && defaults.ask_qr && defaults.ask_scanner && !defaults.ask_manual && !defaults.ask_picture && !defaults.ask_reconsideration
  && !nothing.ok && /at least one time/.test(nothing.msg) && !noActivity.ok && /at least one activity/.test(noActivity.msg) && holders.length === 1 && holders[0].id === R2,
  `${run1.msg ?? ""} ${run2.msg ?? ""} ${JSON.stringify(defaults)} ${nothing.msg} ${noActivity.msg} ${holders.length}`);

// 2. QR and Scanning Tools each only when ticked
const B = await activity(), C = await activity();
const noQr = await makeSurvey([B], triggers("scanner"));
const noScanner = await makeSurvey([C], triggers("qr"));
const qrB = await scan(B, s1);
await monitorScan(B, s2);
const qrC = await scan(C, s1);
await monitorScan(C, s2);
check("2 with QR unticked a scholar's scan is credited at once and the monitor's scan waits for the survey; with Scanning Tools unticked it is the other way round",
  qrB.surveyPending === false && await credit(B, s1) === 1 && await credit(B, s2) === 0 && (await pending(s2)).some(p => p.surveyId === noQr && p.holdsCredit && p.trigger === "scanner")
  && qrC.surveyPending === true && await credit(C, s1) === 0 && await credit(C, s2) === 1 && !(await pending(s2)).some(p => p.surveyId === noScanner),
  `${qrB.surveyPending} ${await credit(B, s1)} ${await credit(B, s2)} ${qrC.surveyPending} ${await credit(C, s2)} ${JSON.stringify(await pending(s2))}`);

// 3. manual and picture: credit at once, asked once afterwards; import never; unticked asks nothing
const D = await activity(), E = await activity(), F = await activity(), G = await activity();
const manual = await makeSurvey([D, E], triggers("qr", "manual", "picture"));
const plain = await makeSurvey([F]);                       // manual not ticked
await staffCredit(D, s3);
const afterManual = [await credit(D, s3), await pending(s3)];
await q("insert into attendance_records (session_id, scholar_id_number, status, voucher_redemption_count) values ($1, $2, 'present', 1)", [E.ses, s3.n]);
const selected = (await as(STAFF, "select sdp_credit_selected($1, $2) n", [E.id, [s3.n]]))[0].n;
const two = await pending(s3);
await finish(manual, s3, D.id);
await q("delete from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [D.id, s3.n]);
await staffCredit(D, s3);                                  // credited again: not asked again
const scanAfter = await scan(D, s3).catch(e => ({ error: String(e.message) }));
await staffCredit(F, s3);
await hinted("progress_picture", D, s4);
await hinted("import", D, s5);
const r3 = await response(manual, s3);
check("3 manual credit and crediting selected scholars give the credit at once and ask afterwards (nothing waits); answering records 'manual' and a later credit or scan asks nothing more; picture approval asks, import never, and a survey without the tick asks nothing",
  afterManual[0] === 1 && afterManual[1].length >= 1 && afterManual[1].some(p => p.surveyId === manual && !p.holdsCredit && p.trigger === "manual") && selected === 1 && two.filter(p => p.surveyId === manual).length === 2
  && r3.length === 1 && r3[0].ask_trigger === "manual" && r3[0].status === "completed" && await credit(D, s3) === 1 && scanAfter.surveyPending !== true
  && !(await pending(s3)).some(p => p.surveyId === plain || (p.surveyId === manual && p.activityId === D.id))
  && (await pending(s4)).some(p => p.surveyId === manual && p.trigger === "picture") && !(await pending(s5)).some(p => p.surveyId === manual),
  `${afterManual[0]} ${JSON.stringify(afterManual[1])} ${selected} ${two.length} ${JSON.stringify(r3)} ${JSON.stringify(scanAfter)}`);

// 4. SDP reconsideration; results by trigger; turning the survey off
const request = async (s, term) => (await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term) values ($1, '2026-2027', $2, '2025-2026', '2nd Semester') returning id, status", [s.n, term]))[0];
const req1 = await request(s1, "1st Semester");
const asked = (await pending(s1)).filter(p => p.trigger === "reconsideration");
await finish(R2, s1, req1.id);
const stillPending = (await q("select status from sdp_reconsideration_requests where id = $1", [req1.id]))[0].status;
await request(s1, "2nd Semester");
await request(s2, "1st Semester");
const again = (await pending(s1)).filter(p => p.trigger === "reconsideration");
const qid = (await q("select id from research_survey_questions where survey_id = $1", [R2]))[0].id;
const byTrigger = async t => (await as(STAFF, "select research_survey_question_results($1, null, $2) r", [qid, t]))[0].r.texts.length;
const counts = [await byTrigger("reconsideration"), await byTrigger("manual"), await byTrigger(null)];
await as(STAFF, "update research_surveys set is_active = false where id = $1", [R2]);
const roster = (await as(STAFF, "select research_survey_gating_roster($1, null, true) r", [R2]))[0].r;
await request(s3, "1st Semester");
check("4 the reconsideration survey is asked when the request is sent (again for another request), the request itself does not wait, answers can be filtered by how they were asked, and once it is off nothing more is asked",
  asked.length === 1 && asked[0].surveyId === R2 && !asked[0].holdsCredit && /^SDP reconsideration – 2026-2027 1st Semester$/.test(asked[0].activityName) && req1.status === "pending" && stillPending === "pending"
  && again.length === 1 && counts.join() === "1,0,1" && !(await pending(s1)).some(p => p.surveyId === R2) && !(await pending(s3)).some(p => p.surveyId === R2)
  && roster.filter(r => r.status === "completed").length === 1 && roster.filter(r => r.status === "released").length === 2 && roster.every(r => r.trigger === "reconsideration" && r.activityType === "reconsideration"),
  `${JSON.stringify(asked)} ${again.length} ${counts} ${JSON.stringify(roster.map(r => [r.status, r.trigger]))}`);

// 5. scholars cannot use staff steps; the undo puts back Phase 3, and Phase 4 can be run again
const outsider = await attempt(s1.id, "select survey_save(null, 'x', '', false, '', '[]'::jsonb, $1::jsonb)", [JSON.stringify(triggers("reconsideration"))]);
const oldFile = await file("supabase_migration_survey_multi_activity.sql");
const u = await file("undo_survey_triggers.sql");
const H = await activity();
// after the undo, saving takes no triggers (Phase 3)
const old = (await as(STAFF, "select survey_save(null, 'Back', '', false, '', $1::jsonb) id", [JSON.stringify([{ type: "sdp", id: H.id }])]))[0].id;
await as(STAFF, "select survey_question_save($1, $2::jsonb, false)", [old, JSON.stringify({ questionType: "open_ended", questionText: "Q", openEndedFormat: "short" })]);
await as(STAFF, "update research_surveys set is_active = true where id = $1", [old]);
const scanned = await scan(H, s4);
const afterUndo = scanned.surveyPending === true && scanned.surveyId === old;
await staffCredit(G, s4);
const reapply = await file("supabase_migration_survey_triggers.sql");
check("5 only research staff can save surveys; the Phase 3 file refuses to run over Phase 4; the undo restores QR and Scanning Tools asking, and Phase 4 can be re-applied",
  !outsider.ok && !oldFile.ok && /Phase 4 update is already in place/.test(oldFile.msg) && u.ok && afterUndo && await credit(G, s4) === 1 && reapply.ok,
  `${outsider.ok} ${oldFile.msg} ${u.msg ?? ""} ${afterUndo} ${reapply.msg ?? ""}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
