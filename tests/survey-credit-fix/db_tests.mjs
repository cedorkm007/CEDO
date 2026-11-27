// tests/survey-credit-fix/db_tests.mjs — finishing a survey gives the SDP credit again; the check and restore files (5 checks, short on purpose)
// Run:  node tests/survey-credit-fix/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.exec((await import("node:fs")).readFileSync("undo_survey_ask_once.sql", "utf8"));   // an earlier phase's test
// the demo copy of these tables lacks rules the real database has
for (const s of [
  "create unique index if not exists t_rsr on public.research_survey_responses (survey_id, scholar_id_number)",
  "create unique index if not exists t_rsa on public.research_survey_answers (response_id, question_id)",
  "create unique index if not exists t_safn on public.scholar_attendance_finalized_notifications (session_id, scholar_id_number)",
  "create unique index if not exists t_sdpa on public.sdp_attendance (activity_id, scholar_id_number, occurrence_number)",
]) await db.exec(s);

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const file = async f => { try { return { ok: true, results: await db.exec(fs.readFileSync(f, "utf8")) }; } catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, msg: String(e.message) }; } };
async function as(uid, sql, p = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, p)).rows;
  });
}
const attempt = async (uid, sql, p = []) => { try { return { ok: true, rows: await as(uid, sql, p) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const scholars = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 8");
const period = (await q("select current_school_year sy, current_semester sem from grading_period_settings where id = true"))[0];
let seq = 0;
/** An activity with a survey: Q1 (Yes -> end the survey / No -> go on), Q2 written. days > 1 = recurring, one code per day. */
async function makeActivity({ days = 1, consent = false } = {}) {
  const tag = `T${++seq}`;
  const extra = Array.from({ length: days - 1 }, (_, i) => ({ date: new Date(Date.now() + (i + 1) * 864e5).toISOString() }));
  const act = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time, recurring_dates) values ($1, 'community_service', $2, 1, true, now(), $3::jsonb) returning id",
    [`CHECK ${tag}`, days > 1 ? "recurring" : "one_time", JSON.stringify(extra)]))[0].id;
  const ses = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [act]))[0].id;
  const survey = (await q("insert into research_surveys (title, sdp_activity_id, requires_consent) values ($1, $2, $3) returning id", [`S ${tag}`, act, consent]))[0].id;
  const q1 = (await q("insert into research_survey_questions (survey_id, question_type, question_text, sort_order) values ($1, 'multiple_choice', 'Done?', 0) returning id", [survey]))[0].id;
  const q2 = (await q("insert into research_survey_questions (survey_id, question_type, question_text, sort_order, open_ended_format) values ($1, 'open_ended', 'Why?', 1, 'short') returning id", [survey]))[0].id;
  const end = (await q("insert into research_survey_choices (question_id, choice_text, sort_order, ends_survey) values ($1, 'Yes', 0, true) returning id", [q1]))[0].id;
  const goOn = (await q("insert into research_survey_choices (question_id, choice_text, sort_order) values ($1, 'No', 1) returning id", [q1]))[0].id;
  return { act, ses, survey, q1, q2, end, goOn, tag };
}
let codeSeq = 0;
async function scan(a, s, dayOffset = 0) {
  const code = `C${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number, day_date) values ($1, $2, 'voucher', $3, ((now() at time zone 'Asia/Manila')::date + $4::integer))", [a.ses, code, codeSeq, dayOffset]);
  return as(s.id, "select public.redeem_attendance_code($1)", [code]);
}
async function finish(a, s, { skip = true, agree = null } = {}) {
  const opened = (await as(s.id, "select public.start_or_resume_survey_response($1) r", [a.survey]))[0].r;
  if (agree !== null) await as(s.id, "select public.submit_survey_consent($1, $2)", [opened.responseId, agree]);
  if (agree !== false) {
    await as(s.id, "select public.submit_survey_answer($1, $2, $3, null::integer, null::text)", [opened.responseId, a.q1, skip ? a.end : a.goOn]);
    if (!skip) await as(s.id, "select public.submit_survey_answer($1, $2, null, null, 'because')", [opened.responseId, a.q2]);
    await as(s.id, "select public.submit_survey_response($1)", [opened.responseId]);
  }
  return opened;
}
const credits = async (a, s) => q("select attended_date, school_year, semester, activity_day, created_at from sdp_attendance where activity_id = $1 and scholar_id_number = $2 order by occurrence_number", [a.act, s.n]);

// ── the bug as it is today (take the fix out), used for the restore checks ──
await file("undo_survey_triggers.sql");
await file("undo_survey_multi_activity.sql");    // nor about Phase 3
await file("undo_survey_sections_safety.sql");   // Phase 2 makes new surveys drafts; this test is about Phase 1
await file("undo_survey_credit_fix.sql");
const B = await makeActivity(), R = await makeActivity({ days: 3 });
const [s1, s2, s3, s4, s5, s6, s7, s8] = scholars;
await scan(B, s1); await finish(B, s1);                       // lost
await scan(R, s2, 0); await finish(R, s2);                    // lost (recurring, never scanned again)
await scan(R, s3, 0); await finish(R, s3); await scan(R, s3, 1);   // filled in by the later scan
await scan(B, s4); await finish(B, s4);                       // lost, then staff removed a credit: left for a person to decide
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) values ($1, $2, current_date, 1, $3, $4)", [B.act, s4.n, period.sy, period.sem]);
await q("delete from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [B.act, s4.n]);
const bugSeen = (await credits(B, s1)).length === 0;

// 1. the fix applies (twice is safe); finishing by the skip path or the full path gives exactly one credit, and finishing again adds nothing
const f1 = await file("supabase_migration_survey_credit_fix.sql"), f2 = await file("supabase_migration_survey_credit_fix.sql");
const A = await makeActivity();
await scan(A, s5); await scan(A, s6).catch(() => {});
const o5 = await finish(A, s5, { skip: true }); await finish(A, s6, { skip: false });
await attempt(s5.id, "select public.submit_survey_response($1)", [o5.responseId]);
const c5 = await credits(A, s5), c6 = await credits(A, s6);
check("1 before the fix the credit was lost; after it (run twice) the skip path and the full path each give exactly one credit in the current semester, and submitting again adds nothing",
  bugSeen && f1.ok && f2.ok && c5.length === 1 && c6.length === 1 && c5[0].semester === period.sem, `${f1.msg ?? ""} ${f2.msg ?? ""} ${bugSeen} ${c5.length} ${c6.length}`);

// 2. voluntary survey: consent is asked again and enforced; agree-then-finish and decline both credit once
const V = await makeActivity({ consent: true });
await scan(V, s7); await scan(V, s8);
const opened = (await as(s7.id, "select public.start_or_resume_survey_response($1) r", [V.survey]))[0].r;
await as(s7.id, "select public.submit_survey_answer($1, $2, $3, null::integer, null::text)", [opened.responseId, V.q1, V.end]);
const tooSoon = await attempt(s7.id, "select public.submit_survey_response($1)", [opened.responseId]);
await finish(V, s7, { agree: true }); await finish(V, s8, { agree: false });
check("2 a voluntary survey reports itself as voluntary, cannot be finished without agreeing, and gives one credit both after agreeing and after declining",
  opened.requiresConsent === true && opened.consented === null && !tooSoon.ok && /consent/.test(tooSoon.msg) && (await credits(V, s7)).length === 1 && (await credits(V, s8)).length === 1, `${JSON.stringify(opened.requiresConsent)} ${tooSoon.msg}`);

// 3. no double credit; recurring: each scanned day once with its day; the semester of the SCAN is kept
const M = await makeActivity(), N = await makeActivity({ days: 3 });
await scan(M, s1);
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) values ($1, $2, current_date, 1, $3, $4)", [M.act, s1.n, period.sy, period.sem]);   // staff credit while waiting
await finish(M, s1);
await scan(N, s1, 0); await scan(N, s1, 1);
await q("update grading_period_settings set current_semester = 'Changed Semester', updated_at = now() where id = true");
await finish(N, s1);
await q("update grading_period_settings set current_semester = $1, updated_at = now() - interval '90 days' where id = true", [period.sem]);
const cm = await credits(M, s1), cn = await credits(N, s1);
check("3 a credit already added by staff is not repeated; a recurring activity gets one credit for each scanned day, labelled with its day, in the semester of the scan",
  cm.length === 1 && cn.length === 2 && cn.every(c => c.activity_day && c.semester === period.sem) && String(cn[0].activity_day) !== String(cn[1].activity_day), `${cm.length} ${JSON.stringify(cn)}`);

// 4. the read-only check lists exactly what is missing and what is left out; the restore adds only that, once, with history and a notification
const list = async () => { const r = await file("check_survey_sdp_credit_readonly.sql"); return r.ok ? r.results.at(-1).rows : (console.log(r.msg), []); };
const before = await list();
const will = before.filter(r => r.action === "WILL RESTORE").map(r => r.scholar_id_number).sort(), left = before.filter(r => String(r.action).startsWith("NOT restored"));
const r1 = await file("restore_survey_sdp_credits.sql"), r2 = await file("restore_survey_sdp_credits.sql");
const hist = await q("select * from sdp_credit_history where source = 'restore_survey_bug'");
const notes = await q("select scholar_id_number, title from scholar_notifications where kind = 'sdp_credit_restored' order by 1");
check("4 the check lists the two lost credits and leaves out the one staff removed (a later scan had already filled in another); the restore (run twice) adds exactly those, records them as restored and notifies each scholar once",
  will.join() === [s1.n, s2.n].sort().join() && left.length === 1 && left[0].scholar_id_number === s4.n && r1.ok && r2.ok && (await credits(B, s1)).length === 1 && (await credits(R, s2)).length === 1 && (await credits(R, s3)).length === 2
  && (await credits(B, s4)).length === 0 && hist.length === 2 && notes.length === 2 && /^Your SDP credit for CHECK T\d+ has been added$/.test(notes[0].title),
  `${r1.msg ?? ""} ${JSON.stringify(before.map(r => [r.action, r.scholar_id_number]))} hist ${hist.length} notes ${notes.length}`);

// 5. undo of the restore removes only what it added; the fix can be undone and run again
const u = await file("undo_restore_survey_sdp_credits.sql");
const afterUndo = { a: (await credits(B, s1)).length, b: (await credits(R, s2)).length, c: (await credits(R, s3)).length, d: (await credits(A, s5)).length };
const again = await list();
const uf = await file("undo_survey_credit_fix.sql"), ff = await file("supabase_migration_survey_credit_fix.sql");
check("5 undoing the restore removes only the restored credits (they are listed again), and the fix can be undone and re-run",
  u.ok && afterUndo.a === 0 && afterUndo.b === 0 && afterUndo.c === 2 && afterUndo.d === 1 && again.filter(r => r.action === "WILL RESTORE").length === 2 && uf.ok && ff.ok,
  `${u.msg ?? ""} ${uf.msg ?? ""} ${ff.msg ?? ""} ${JSON.stringify(afterUndo)} ${again.length}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
