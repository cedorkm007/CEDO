// tests/survey-announce/db_tests.mjs — announcing a survey to all scholars (5 checks, short on purpose)
// Run:  node tests/survey-announce/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
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

const STAFF = seedId("staff:demo.sead");
const [s1, s2, s3, gone] = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 4");
await q("update scholars set status = 'Removed' where id = $1", [gone.id]);
const everyone = (await q("select count(*)::int c from scholars where coalesce(status, '') <> 'Removed'"))[0].c;
const activity = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time) values ('ANN', 'community_service', 'one_time', 1, true, now()) returning id"))[0].id;
const session = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [activity]))[0].id;
let codeSeq = 0;
async function scan(s) {
  const code = `A${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', $3)", [session, code, codeSeq]);
  return (await as(s.id, "select public.redeem_attendance_code($1) r", [code]))[0].r;
}
const S = (await as(STAFF, "select survey_save(null, 'Ann survey', '', false, '', $1::jsonb) id", [JSON.stringify([{ type: "sdp", id: activity }])]))[0].id;
const pending = async s => (await as(s.id, "select my_pending_surveys() r"))[0].r.filter(p => p.surveyId === S);
const bells = async s => (await q("select count(*)::int c from scholar_notifications where scholar_id_number = $1 and kind = 'survey'", [s.n]))[0].c;
const roster = async () => (await as(STAFF, "select research_survey_gating_roster($1, null, true) r", [S]))[0].r;
const announce = () => attempt(STAFF, "select survey_announce($1) n", [S]);
const status = async () => (await as(STAFF, "select survey_announcement_status($1) r", [S]))[0].r;
const later = () => q("update research_survey_announcements set announced_at = announced_at - interval '11 minutes' where survey_id = $1", [S]);
async function answer(s, activityId) {
  const r = (await as(s.id, "select start_or_resume_survey_response($1, $2) r", [S, activityId]))[0].r;
  await as(s.id, "select submit_survey_answer($1, $2, null::uuid, null::integer, 'yes')", [r.responseId, r.questions[0].id]);
  return (await as(s.id, "select submit_survey_response($1) r", [r.responseId]))[0].r;
}

const run1 = await file("supabase_migration_survey_announcement.sql"), run2 = await file("supabase_migration_survey_announcement.sql");
const old1 = await file("supabase_migration_survey_ask_once.sql"), old2 = await file("supabase_migration_survey_delete_response.sql");
const noQuestion = await announce();
await as(STAFF, "select survey_question_save($1, $2::jsonb, false)", [S, JSON.stringify({ questionType: "open_ended", questionText: "How?", openEndedFormat: "short" })]);
const inactive = await announce();
await as(STAFF, "update research_surveys set is_active = true where id = $1", [S]);
const asScholar = await attempt(s1.id, "select survey_announce($1)", [S]);
await q("insert into push_subscriptions (owner_kind, scholar_id_number, endpoint, p256dh, auth) values ('scholar', $1, 'https://push.example/1', 'k', 'a')", [s1.n]);

// 1. the first announcement: everyone not Removed who has not responded gets a notification
await scan(s3);                                       // s3 has attendance waiting for this survey
const held = (await pending(s3))[0];
await answer(s3, held.activityId);                    // and responds before the announcement
const first = await announce();
const push = await q("select url from push_outbox where scholar_id_number = $1 and title = 'Please answer our survey'", [s1.n]);
check("1 the file runs twice and older files refuse to run over it; only an active survey with a question can be announced, only by research staff; every scholar not Removed who has not responded gets a bell (and phone) notification",
  run1.ok && run2.ok && !old1.ok && /STOPPED/.test(old1.msg) && !old2.ok && /STOPPED/.test(old2.msg)
  && !noQuestion.ok && !inactive.ok && !asScholar.ok && first.ok && first.rows[0].n === everyone - 1
  && await bells(s1) === 1 && await bells(s3) === 0 && await bells(gone) === 0 && push.length === 1 && push[0].url === "/CEDO/portal",
  `${run1.msg ?? ""} ${old1.msg} ${noQuestion.msg} ${inactive.msg} ${first.msg ?? first.rows[0].n}/${everyone - 1} ${JSON.stringify(push)}`);

// 2. once every 10 minutes
const again = await announce(), wait = (await as(STAFF, "select survey_announcement_waits() r"))[0].r[S], now1 = await status();
await later();
const free = await status(), second = await announce();
const asks = (await q("select count(*)::int c from research_survey_asks where survey_id = $1 and scholar_id_number = $2", [S, s1.n]))[0].c;
check("2 a second press within 10 minutes is refused and says how long to wait; after 10 minutes it sends again, without listing anyone twice",
  !again.ok && /again in 10 minute/.test(again.msg) && wait > 590 && wait <= 600 && now1.secondsLeft > 590 && now1.lastCount === everyone - 1 && now1.lastBy.length > 0
  && free.secondsLeft === 0 && free.toNotify === everyone - 1 && second.ok && await bells(s1) === 2 && asks === 1,
  `${again.msg} ${wait} ${JSON.stringify(now1)} ${second.msg ?? ""} ${asks}`);

// 3. a scholar answers without attending; one who scans afterwards is asked for the activity, not the announcement
const mine = (await pending(s1))[0];
const done = await answer(s1, mine.activityId);
const noCredit = (await q("select count(*)::int c from sdp_attendance where scholar_id_number = $1 and activity_id = $2", [s1.n, activity]))[0].c;
await scan(s2);
const both = await pending(s2);
const finished = await answer(s2, both[0].activityId);
const credit = (await q("select count(*)::int c from sdp_attendance where scholar_id_number = $1 and activity_id = $2", [s2.n, activity]))[0].c;
check("3 an announced scholar can answer from the portal (no attendance or credit appears); with attendance also waiting there is one line, for the activity, and finishing it gives the credit",
  mine.trigger === "announcement" && mine.holdsCredit === false && done.ok && noCredit === 0 && (await pending(s1)).length === 0
  && both.length === 1 && both[0].holdsCredit === true && both[0].activityName === "ANN" && finished.finalizedCount === 1 && credit === 1 && (await pending(s2)).length === 0,
  `${JSON.stringify(mine)} ${noCredit} ${JSON.stringify(both)} ${finished.finalizedCount} ${credit}`);

// 4. the staff list shows only those who opened it; turning the survey off removes the invitation
const list = await roster();
await later();
const third = await announce();
const [s5] = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' and s.id <> all($1::uuid[]) order by s.scholar_id_number limit 1", [[s1.id, s2.id, s3.id, gone.id]]);
const before = (await pending(s5)).length;
await as(STAFF, "update research_surveys set is_active = false where id = $1", [S]);
const off = (await pending(s5)).length;
await as(STAFF, "update research_surveys set is_active = true where id = $1", [S]);
await later();
const fourth = await announce();
check("4 'Who was asked' lists announced scholars only once they open the survey; responders are not told again; turning the survey off removes the invitation and announcing again brings it back",
  list.length === 3 && list.find(r => r.scholarIdNumber === s1.n)?.trigger === "announcement" && list.every(r => r.status === "completed")
  && third.ok && third.rows[0].n === everyone - 3 && await bells(s1) === 2 && before === 1 && off === 0 && fourth.ok && (await pending(s5)).length === 1,
  `${JSON.stringify(list)} ${third.msg ?? third.rows[0].n} ${before} ${off} ${(await pending(s5)).length}`);

// 5. undo, and the file again
const undo = await file("undo_survey_announcement.sql");
const afterUndo = [(await q("select to_regprocedure('public.survey_announce(uuid)') is null x"))[0].x, (await pending(s5)).length, (await roster()).length];
const redo = await file("supabase_migration_survey_announcement.sql");
check("5 the undo file removes the option and unopened invitations but keeps every answer, and the update can be installed again",
  undo.ok && afterUndo[0] === true && afterUndo[1] === 0 && afterUndo[2] === 3 && redo.ok, `${undo.msg ?? ""} ${JSON.stringify(afterUndo)} ${redo.msg ?? ""}`);

console.log(`${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
await db.close();
process.exit(failed ? 1 : 0);
