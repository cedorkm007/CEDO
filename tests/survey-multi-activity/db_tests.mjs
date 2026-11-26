// tests/survey-multi-activity/db_tests.mjs — Survey Tools phase 3: one survey on several activities (5 checks)
// Run:  node tests/survey-multi-activity/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { realSurveyRules } from "./realRules.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

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

// start from the state the real database is in today: the demo built with Phase 3 in it, so take it out
const undone = await file("undo_survey_multi_activity.sql");
await realSurveyRules(db);

const STAFF = seedId("staff:demo.sead"), MONITOR = seedId("staff:demo.monitor");
const scholars = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 6");
const [s1, s2, s3, s4] = scholars;
let seq = 0, codeSeq = 0;
async function activity(name) {
  const id = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time) values ($1, 'community_service', 'one_time', 1, true, now()) returning id", [`${name} ${++seq}`]))[0].id;
  const ses = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [id]))[0].id;
  return { id, ses };
}
async function scan(a, s) {
  const code = `M${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', $3)", [a.ses, code, codeSeq]);
  return (await as(s.id, "select public.redeem_attendance_code($1) r", [code]))[0].r;
}
const open = async (survey, s, activityId = null) => (await as(s.id, "select public.start_or_resume_survey_response($1, $2) r", [survey, activityId]))[0].r;
async function finish(survey, s, activityId, text = "fine") {
  const r = await open(survey, s, activityId);
  await as(s.id, "select public.submit_survey_answer($1, $2, null::uuid, null::integer, $3)", [r.responseId, r.questions[0].id, text]);
  await as(s.id, "select public.submit_survey_response($1)", [r.responseId]);
  return r;
}
const credit = async (a, s) => (await q("select count(*)::int c from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [a.id, s.n]))[0].c;
const links = async survey => q("select activity_id, detached_at, activity_name from research_survey_activities where survey_id = $1 order by attached_at", [survey]);
const save = async (id, title, acts) => (await as(STAFF, "select survey_save($1, $2, '', false, '', $3::jsonb) id", [id, title, JSON.stringify(acts.map(a => ({ type: "sdp", id: a.id })))]))[0].id;
const question = survey => as(STAFF, "select survey_question_save($1, $2::jsonb, false) id", [survey, JSON.stringify({ questionType: "open_ended", questionText: "How was it?", openEndedFormat: "short" })]).then(r => r[0].id);
const activate = (survey, on = true) => as(STAFF, "update research_surveys set is_active = $2 where id = $1", [survey, on]);

// today: one survey on one activity, one finished answer
const OLD = await activity("Old");
const oldSurvey = (await as(STAFF, "insert into research_surveys (title, sdp_activity_id) values ('Before', $1) returning id", [OLD.id]))[0].id;
await q("insert into research_survey_responses (survey_id, scholar_id_number, status, submitted_at) values ($1, $2, 'completed', now())", [oldSurvey, s4.n]);

// 1
const run1 = await file("supabase_migration_survey_multi_activity.sql"), run2 = await file("supabase_migration_survey_multi_activity.sql");
const copied = await links(oldSurvey);
const oldResponse = (await q("select activity_id, activity_name, ask_trigger from research_survey_responses where survey_id = $1", [oldSurvey]))[0];
check("1 the file applies to today's state and can be run twice; the existing link and answer are copied with the activity, how it was asked staying 'not recorded'",
  undone.ok && run1.ok && run2.ok && copied.length === 1 && copied[0].activity_id === OLD.id && oldResponse.activity_id === OLD.id && /^Old /.test(oldResponse.activity_name) && oldResponse.ask_trigger === null,
  `${undone.msg ?? ""} ${run1.msg ?? ""} ${run2.msg ?? ""} ${copied.length} ${JSON.stringify(oldResponse)}`);

// 2. several activities, one survey each, asked once per activity
const A = await activity("Alpha"), B = await activity("Beta"), C = await activity("Gamma");
const S = await save(null, "Shared", [A, B, C]); await question(S); await activate(S);
const taken = await attempt(STAFF, "select survey_save(null, 'Other', '', false, '', $1::jsonb)", [JSON.stringify([{ type: "sdp", id: A.id }])]);
const none = await attempt(STAFF, "select survey_save(null, 'Empty', '', false, '', '[]'::jsonb)");
const scanA = await scan(A, s1); await scan(B, s1);
const picked = await open(S, s1);                         // no activity given: the one scanned last
await finish(S, s1, A.id);
const onlyA = [await credit(A, s1), await credit(B, s1)];
await finish(S, s1, B.id, "good");
const both = [await credit(A, s1), await credit(B, s1)];
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2) on conflict do nothing", [C.id, MONITOR]);
await as(MONITOR, "select public.record_monitor_attendance('sdp', $1, 'voucher', null, $2)", [C.id, s2.n]);
await finish(S, s2, null);
await scan(A, s2); await finish(S, s2, A.id);
const responses = await q("select scholar_id_number n, activity_id, ask_trigger, status from research_survey_responses where survey_id = $1", [S]);
const trigger = (s, a) => responses.find(r => r.n === s.n && r.activity_id === a.id)?.ask_trigger;
check("2 a survey on three activities: another survey cannot take one of them; attending two asks twice, once per activity; finishing one releases only that one; each response records its activity and whether it was a QR scan or the Scanning Tools",
  !taken.ok && /already has the survey "Shared"/.test(taken.msg) && !none.ok && scanA.surveyId === S && /^Beta /.test(picked.activityName)
  && onlyA.join() === "1,0" && both.join() === "1,1" && await credit(C, s2) === 1 && responses.length === 4 && trigger(s1, A) === "qr" && trigger(s2, C) === "scanner",
  `${taken.msg} ${picked.activityName} ${onlyA} ${both} ${responses.length} ${trigger(s1, A)} ${trigger(s2, C)}`);

// 3. detach releases the waiting credit and keeps answers; counts and results per activity; deactivating releases too
await scan(B, s3); await scan(C, s3);
const beforeDetach = await credit(B, s3);
await save(S, "Shared", [A, C]);
const roster = (await as(STAFF, "select research_survey_gating_roster($1, null, true) r", [S]))[0].r;
const oldScreen = (await as(STAFF, "select research_survey_gating_roster($1) r", [S]))[0].r;   // as today's live screen calls it
const rosterB = (await as(STAFF, "select research_survey_gating_roster($1, $2) r", [S, B.id]))[0].r;
const qid = (await q("select id from research_survey_questions where survey_id = $1", [S]))[0].id;
const textsAll = (await as(STAFF, "select research_survey_question_results($1) r", [qid]))[0].r.texts.length;
const textsB = (await as(STAFF, "select research_survey_question_results($1, $2) r", [qid, B.id]))[0].r.texts;
const afterDetachC = await credit(C, s3);
await activate(S, false);
const status = (list, s, a) => list.find(r => r.scholarIdNumber === s.n && r.activityId === a.id)?.status;
check("3 detaching an activity gives its waiting credit (only that activity's), keeps its answers and lists the scholar as released; results and counts can be read per activity; deactivating releases the rest",
  beforeDetach === 0 && await credit(B, s3) === 1 && afterDetachC === 0 && status(roster, s3, B) === "released" && status(roster, s3, C) === "in_progress" && status(roster, s1, B) === "completed" && status(oldScreen, s3, B) === "in_progress" && !oldScreen.some(r => r.status === "released")
  && rosterB.length === 2 && textsAll === 4 && textsB.join() === "good" && await credit(C, s3) === 1,
  `${oldScreen.length} ${beforeDetach} ${afterDetachC} ${status(roster, s3, B)} ${status(roster, s3, C)} ${rosterB.length} ${textsAll} ${textsB}`);

// 4. deleting an activity keeps the survey and its answers; the activity list and the SDP pop-up know the survey
await q("delete from sdp_attendance where activity_id = $1", [A.id]);
let deleted = true; try { await db.query("delete from sdp_activities where id = $1", [A.id]); } catch (e) { deleted = String(e.message); }
const kept = (await q("select (select count(*) from research_surveys where id = $1)::int s, (select count(*) from research_survey_answers a join research_survey_responses r on r.id = a.response_id where r.survey_id = $1)::int a", [S]))[0];
const gone = (await links(S)).find(l => l.activity_id === A.id);
const primary = (await q("select sdp_activity_id from research_surveys where id = $1", [S]))[0].sdp_activity_id;
const options = (await as(STAFF, "select survey_activity_options() o"))[0].o;
const popup = (await as(STAFF, "select survey_for_activity($1) r", [C.id]))[0].r;
const outsider = await attempt(s1.id, "select survey_activity_options()");
check("4 deleting an activity keeps the survey and its answers and marks the activity detached; every activity shows which survey it has; scholars cannot read that list",
  deleted === true && kept.s === 1 && kept.a === 4 && gone.detached_at !== null && /^Alpha /.test(gone.activity_name) && primary === C.id
  && options.find(o => o.id === C.id)?.surveyTitle === "Shared" && options.find(o => o.id === B.id)?.surveyTitle === null && popup.title === "Shared" && popup.active === false && !outsider.ok,
  `${deleted} ${JSON.stringify(kept)} ${primary === C.id} ${popup?.title} ${outsider.ok}`);

// 5. today's live screens keep working; the undo refuses when it cannot merge answers, and otherwise works
const D = await activity("Delta"), E = await activity("Epsilon");
const legacy = (await as(STAFF, "insert into research_surveys (title, sdp_activity_id) values ('Old screen', $1) returning id", [D.id]))[0].id;
const attached = await links(legacy);
await as(STAFF, "update research_surveys set sdp_activity_id = $2 where id = $1", [legacy, E.id]);
const moved = (await links(legacy)).filter(l => !l.detached_at).map(l => l.activity_id);
const refused = await file("undo_survey_multi_activity.sql");
await q("delete from research_survey_responses where survey_id = $1", [S]);
const u = await file("undo_survey_multi_activity.sql"), again = await file("supabase_migration_survey_multi_activity.sql");
check("5 a survey made or moved by the current live screen stays in step; the undo stops when answers exist for two activities of one scholar, and works (and can be re-applied) otherwise",
  attached.length === 1 && attached[0].activity_id === D.id && moved.join() === E.id && !refused.ok && /cannot merge/.test(refused.msg) && u.ok && again.ok,
  `${attached.length} ${moved.length} ${refused.msg} ${u.msg ?? ""} ${again.msg ?? ""}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
