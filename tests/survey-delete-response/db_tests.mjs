// tests/survey-delete-response/db_tests.mjs — deleting and restoring a response (4 checks, short on purpose)
// Run:  node tests/survey-delete-response/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
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
const [s1, s2, s3] = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 3");
let seq = 0, codeSeq = 0;
async function activity() {
  const id = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time) values ($1, 'community_service', 'one_time', 1, true, now()) returning id", [`DEL ${++seq}`]))[0].id;
  const ses = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [id]))[0].id;
  return { id, ses };
}
async function scan(a, s) {
  const code = `D${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', $3)", [a.ses, code, codeSeq]);
  return (await as(s.id, "select public.redeem_attendance_code($1) r", [code]))[0].r;
}
async function finish(survey, s, activityId, text) {
  const r = (await as(s.id, "select start_or_resume_survey_response($1, $2) r", [survey, activityId]))[0].r;
  await as(s.id, "select submit_survey_answer($1, $2, null::uuid, null::integer, $3)", [r.responseId, r.questions[0].id, text]);
  await as(s.id, "select submit_survey_response($1)", [r.responseId]);
}
const credit = async (a, s) => (await q("select count(*)::int c from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [a.id, s.n]))[0].c;
const roster = async survey => (await as(STAFF, "select research_survey_gating_roster($1, null, true) r", [survey]))[0].r;
const texts = async question => (await as(STAFF, "select research_survey_question_results($1, null, null) r", [question]))[0].r.texts;
const del = (survey, s, a, reason = null) => attempt(STAFF, "select survey_delete_response($1, $2, $3, $4) id", [survey, s.n, a.id, reason]);
const deleted = async survey => (await as(STAFF, "select survey_deleted_list($1) r", [survey]))[0].r;

const run1 = await file("supabase_migration_survey_delete_response.sql"), run2 = await file("supabase_migration_survey_delete_response.sql");
const A = await activity(), B = await activity();
const S = (await as(STAFF, "select survey_save(null, 'Del', '', false, '', $1::jsonb) id", [JSON.stringify([{ type: "sdp", id: A.id }, { type: "sdp", id: B.id }])]))[0].id;
await as(STAFF, "select survey_question_save($1, $2::jsonb, false)", [S, JSON.stringify({ questionType: "open_ended", questionText: "How?", openEndedFormat: "short" })]);
await as(STAFF, "update research_surveys set is_active = true where id = $1", [S]);
const question = (await q("select id from research_survey_questions where survey_id = $1", [S]))[0].id;
await scan(A, s1); await finish(S, s1, A.id, "first");
await scan(A, s2); await finish(S, s2, A.id, "second");

// 1. delete: gone from the list and the charts, kept as a copy, credit stays, never asked again
const d1 = await del(S, s1, A, "test entry"), twice = await del(S, s1, A);
const after = [await roster(S), await texts(question), await deleted(S)];
const scanB = await scan(B, s1);
const pendingAfter = (await as(s1.id, "select my_pending_surveys() r"))[0].r;
check("1 the file runs twice; deleting a response takes it off the list and the charts, keeps a copy with who and why, leaves the credit, and the survey is not asked of that scholar again",
  run1.ok && run2.ok && d1.ok && !twice.ok && /already deleted/.test(twice.msg) && !after[0].some(r => r.scholarIdNumber === s1.n) && after[1].join() === "second"
  && after[2].length === 1 && after[2][0].reason === "test entry" && after[2][0].answerCount === 1 && after[2][0].deletedBy.length > 0 && await credit(A, s1) === 1
  && scanB.surveyPending === false && await credit(B, s1) === 1 && !pendingAfter.some(p => p.surveyId === S),
  `${run1.msg ?? ""} ${d1.msg ?? ""} ${twice.msg} ${JSON.stringify(after[0])} ${after[1]} ${JSON.stringify(after[2])} ${scanB.surveyPending}`);

// 2. restore puts it back as it was
const lost = (await as(STAFF, "select survey_restore_response($1) n", [after[2][0].id]))[0].n;
const back = await roster(S);
check("2 restoring brings back the answers and the line on the list, and empties the deleted list",
  lost === 0 && back.find(r => r.scholarIdNumber === s1.n)?.status === "completed" && (await texts(question)).sort().join() === "first,second" && (await deleted(S)).length === 0,
  `${lost} ${JSON.stringify(back)}`);

// 3. a waiting one (not opened yet): the held credit is given, and it is not asked again
await scan(B, s3);
const heldBefore = await credit(B, s3);
const d3 = await del(S, s3, B);
const scanA = await scan(A, s3);
check("3 deleting a line that is still waiting gives the held credit, removes the line and stops the survey for that scholar",
  heldBefore === 0 && d3.ok && await credit(B, s3) === 1 && !(await roster(S)).some(r => r.scholarIdNumber === s3.n) && scanA.surveyPending === false,
  `${heldBefore} ${d3.msg ?? ""} ${await credit(B, s3)} ${scanA.surveyPending}`);

// 4. only research staff; a survey with only deleted responses still cannot be deleted (the copy is kept); undo
const outsider = await attempt(s1.id, "select survey_delete_response($1, $2, $3, null)", [S, s2.n, A.id]);
const peek = await attempt(s1.id, "select * from survey_deleted_responses");
await del(S, s2, A); await del(S, s1, A);
const survey = await attempt(STAFF, "delete from research_surveys where id = $1", [S]);
const u = await file("undo_survey_delete_response.sql"), re = await file("supabase_migration_survey_delete_response.sql");
check("4 scholars cannot delete or read the copies; a survey whose responses were deleted still cannot be deleted; the undo runs and the file can be run again",
  !outsider.ok && !peek.ok && !survey.ok && /has answers/.test(survey.msg) && u.ok && re.ok && (await deleted(S)).length === 3,
  `${outsider.ok} ${peek.ok} ${survey.msg} ${u.msg ?? ""} ${re.msg ?? ""} ${(await deleted(S)).length}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
