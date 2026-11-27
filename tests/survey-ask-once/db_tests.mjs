// tests/survey-ask-once/db_tests.mjs — a scholar who already responded is not asked the survey again, except for a new reconsideration request (4 checks)
// Run:  node tests/survey-ask-once/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.exec("create unique index if not exists t_sdpa on public.sdp_attendance (activity_id, scholar_id_number, occurrence_number)");

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const file = async f => { try { return { ok: true, results: await db.exec(fs.readFileSync(f, "utf8")) }; } catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, msg: String(e.message) }; } };
async function as(uid, sql, p = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, p)).rows;
  });
}

const STAFF = seedId("staff:demo.sead"), MONITOR = seedId("staff:demo.monitor");
const [s1, s2, s3] = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 3");
let seq = 0, codeSeq = 0;
async function activity() {
  const id = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time) values ($1, 'community_service', 'one_time', 1, true, now()) returning id", [`ONCE ${++seq}`]))[0].id;
  const ses = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [id]))[0].id;
  await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2) on conflict do nothing", [id, MONITOR]);
  return { id, ses };
}
async function makeSurvey(acts, extra = {}) {
  const triggers = { qr: true, scanner: true, manual: true, picture: true, reconsideration: false, ...extra };
  const id = (await as(STAFF, "select survey_save(null, $1, '', false, '', $2::jsonb, $3::jsonb) id", [`O ${++seq}`, JSON.stringify(acts.map(a => ({ type: "sdp", id: a.id }))), JSON.stringify(triggers)]))[0].id;
  await as(STAFF, "select survey_question_save($1, $2::jsonb, false)", [id, JSON.stringify({ questionType: "open_ended", questionText: "How was it?", openEndedFormat: "short" })]);
  await as(STAFF, "update research_surveys set is_active = true where id = $1", [id]);
  return id;
}
async function scan(a, s) {
  const code = `O${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', $3)", [a.ses, code, codeSeq]);
  return (await as(s.id, "select public.redeem_attendance_code($1) r", [code]))[0].r;
}
const pending = async s => (await as(s.id, "select my_pending_surveys() r"))[0].r;
const open = async (survey, s, activityId = null) => (await as(s.id, "select start_or_resume_survey_response($1, $2) r", [survey, activityId]))[0].r;
async function finish(survey, s, activityId) {
  const r = await open(survey, s, activityId);
  await as(s.id, "select submit_survey_answer($1, $2, null::uuid, null::integer, 'ok')", [r.responseId, r.questions[0].id]);
  return (await as(s.id, "select submit_survey_response($1) r", [r.responseId]))[0].r;
}
const credit = async (a, s) => (await q("select count(*)::int c from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [a.id, s.n]))[0].c;
const answers = async survey => (await q("select count(*)::int c from research_survey_answers a join research_survey_responses r on r.id = a.response_id where r.survey_id = $1", [survey]))[0].c;

// 1. waiting before the update, for a survey already answered: listed, then released by the file
await file("undo_survey_ask_once.sql");
// the real database has the Phase 4 file run as a whole; the demo builder runs it piece by piece, so make sure its pieces are all there
const hooked = async () => (await q("select count(*)::int c from pg_trigger where tgname = 'survey_ask_after_reconsideration'"))[0].c;
console.log("reconsideration hook in the demo build:", await hooked());
await file("supabase_migration_survey_triggers.sql");
console.log("after running the Phase 4 file as a whole:", await hooked());
const A = await activity(), B = await activity();
const S = await makeSurvey([A, B]);
await scan(A, s1); await finish(S, s1, A.id);
const askedAgain = (await scan(B, s1)).surveyPending;                       // today's rule: asked again
const listed = (await file("check_survey_ask_once_readonly.sql")).results.at(-1).rows;
const run1 = await file("supabase_migration_survey_ask_once.sql"), run2 = await file("supabase_migration_survey_ask_once.sql");
check("1 today a second activity asks again and holds the credit; the check lists that scholar, and running the file (twice is safe) gives the credit, asks nothing and keeps the answer",
  askedAgain === true && listed.length === 1 && listed[0].scholar_id_number === s1.n && run1.ok && run2.ok && await credit(B, s1) === 1 && (await pending(s1)).length === 0 && await answers(S) === 1,
  `${askedAgain} ${JSON.stringify(listed)} ${run1.msg ?? ""} ${run2.msg ?? ""} ${await credit(B, s1)} ${JSON.stringify(await pending(s1))}`);

// 2. after answering once: no other activity asks, by any route
const C = await activity(), D = await activity(), E = await activity(), F = await activity();
const T = await makeSurvey([C, D, E, F]);
await scan(C, s2); await finish(T, s2, C.id);
const qr = await scan(D, s2);
await as(MONITOR, "select public.record_monitor_attendance('sdp', $1, 'voucher', null, $2)", [E.id, s2.n]);
await as(STAFF, "select credit_scholar_for_day($1, $2)", [F.id, s2.n]);
check("2 having answered once, a QR scan, the Scanning Tools and a manual credit at the other activities give the credit at once and ask nothing",
  qr.surveyPending === false && await credit(D, s2) === 1 && await credit(E, s2) === 1 && await credit(F, s2) === 1 && !(await pending(s2)).some(p => p.surveyId === T),
  `${qr.surveyPending} ${await credit(D, s2)} ${await credit(E, s2)} ${await credit(F, s2)} ${JSON.stringify(await pending(s2))}`);

// 3. two activities waiting at once are one thing to answer; answering releases both; a stale screen says "already answered"
const G = await activity(), H = await activity();
const U = await makeSurvey([G, H]);
await scan(G, s3); await scan(H, s3);
const lines = (await pending(s3)).filter(p => p.surveyId === U);
const done = await finish(U, s3, lines[0].activityId);
const stale = await open(U, s3, G.id);
check("3 two activities waiting for one survey show as one line; answering it once releases both credits; opening it again shows no questions",
  lines.length === 1 && lines[0].holdsCredit && /ONCE \d+, ONCE \d+/.test(lines[0].activityName) && done.finalizedCount === 2 && await credit(G, s3) === 1 && await credit(H, s3) === 1
  && (await pending(s3)).every(p => p.surveyId !== U) && stale.alreadyAnswered === true && stale.questions.length === 0 && await answers(U) === 1,
  `${JSON.stringify(lines)} ${done.finalizedCount} ${JSON.stringify(stale)}`);

// 4. reconsideration still asks for each new request; the undo restores once-per-activity
const R = await makeSurvey([], { qr: false, scanner: false, manual: false, picture: false, reconsideration: true });
const request = async term => (await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term) values ($1, '2026-2027', $2, '2025-2026', '2nd Semester') returning id", [s1.n, term]))[0].id;
const r1 = await request("1st Semester"); await finish(R, s1, r1);
const r2 = await request("2nd Semester");
const second = (await pending(s1)).filter(p => p.surveyId === R);
const opened = await open(R, s1, r2);
const u = await file("undo_survey_ask_once.sql");
const I = await activity(), J = await activity();
const V = await makeSurvey([I, J]);
await scan(I, s2); await finish(V, s2, I.id);
const back = (await scan(J, s2)).surveyPending;
const re = await file("supabase_migration_survey_ask_once.sql");
check("4 a new reconsideration request is still asked (with its questions) after an earlier one was answered; the undo restores asking per activity and the file can be run again",
  second.length === 1 && second[0].activityId === r2 && !opened.alreadyAnswered && opened.questions.length === 1 && u.ok && back === true && re.ok,
  `${JSON.stringify(second)} ${opened.alreadyAnswered} ${u.msg ?? ""} ${back} ${re.msg ?? ""}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
