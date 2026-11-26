// tests/survey-sections/db_tests.mjs — Survey Tools phase 2: answers are never erased, delete/draft/deactivate rules, sections and skips (5 checks)
// Run:  node tests/survey-sections/db_tests.mjs        (throwaway in-memory database; nothing real is touched)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { realSurveyRules } from "../survey-multi-activity/realRules.mjs";
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

await file("undo_survey_triggers.sql");
await file("undo_survey_multi_activity.sql");   // this test is about Phase 2: take Phase 3 out first
await realSurveyRules(db);

const STAFF = seedId("staff:demo.sead");
const scholars = await q("select s.id, s.scholar_id_number n from scholars s where s.status = 'Regular' order by s.scholar_id_number limit 6");
const [s1, s2, s3, s4, s5] = scholars;
let seq = 0, codeSeq = 0;

async function makeSurvey() {
  const act = (await q("insert into sdp_activities (name, category, activity_type, credits, all_year_levels, date_time) values ($1, 'community_service', 'one_time', 1, true, now()) returning id", [`SEC ${++seq}`]))[0].id;
  const ses = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours) values ($1, 'voucher', 20, 1) returning id", [act]))[0].id;
  const id = (await as(STAFF, "insert into research_surveys (title, sdp_activity_id) values ($1, $2) returning id, is_active", [`S ${seq}`, act]))[0];
  return { act, ses, id: id.id, startedActive: id.is_active };
}
const save = (survey, question, meaning = false) => as(STAFF, "select survey_question_save($1, $2::jsonb, $3) id", [survey, JSON.stringify(question), meaning]).then(r => r[0].id);
const mc = (text, choices, extra = {}) => ({ questionType: "multiple_choice", questionText: text, choices: choices.map(c => typeof c === "string" ? { choiceText: c } : c), ...extra });
const txt = (text, extra = {}) => ({ questionType: "open_ended", questionText: text, openEndedFormat: "short", ...extra });
const outline = async (survey, results = false) => (await as(STAFF, "select survey_outline($1, $2) o", [survey, results]))[0].o;
const activate = (survey, on = true) => attempt(STAFF, "update research_surveys set is_active = $2 where id = $1", [survey, on]);
async function scan(a, s) {
  const code = `P${String(++codeSeq).padStart(6, "0")}`;
  await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', $3)", [a.ses, code, codeSeq]);
  return as(s.id, "select public.redeem_attendance_code($1)", [code]);
}
const open = async (survey, s) => (await as(s.id, "select public.start_or_resume_survey_response($1) r", [survey]))[0].r;
const answer = (s, r, question, choice = null, text = null) => attempt(s.id, "select public.submit_survey_answer($1, $2, $3, null::integer, $4)", [r.responseId, question, choice, text]);
const submit = (s, r) => attempt(s.id, "select public.submit_survey_response($1)", [r.responseId]);
const creditCount = async (a, s) => (await q("select count(*)::int c from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [a.act, s.n]))[0].c;
const answerCount = async survey => (await q("select count(*)::int c from research_survey_answers a join research_survey_responses r on r.id = a.response_id where r.survey_id = $1", [survey]))[0].c;

// 1. draft, activation, and a file that can be run twice
const run1 = await file("supabase_migration_survey_sections_safety.sql"), run2 = await file("supabase_migration_survey_sections_safety.sql");
const A = await makeSurvey();
const noQuestion = await activate(A.id);
const q1 = await save(A.id, mc("How was it?", ["Good", "Bad"]));
const yes = await activate(A.id);
check("1 the file runs twice; a new survey is a draft that cannot be activated without a question, and can be once it has one",
  run1.ok && run2.ok && A.startedActive === false && !noQuestion.ok && /at least one question/.test(noQuestion.msg) && yes.ok, `${run1.msg ?? ""} ${run2.msg ?? ""} ${noQuestion.msg} ${yes.msg ?? ""}`);

// 2. editing never erases answers: wording keeps them, a new meaning keeps them on the earlier version, and so does the OLD screen's delete-and-reinsert
await scan(A, s1);
const r1 = await open(A.id, s1);
const [good, bad] = r1.questions[0].choices;
await answer(s1, r1, q1, good.id); await submit(s1, r1);
await save(A.id, { id: q1, ...mc("How was it today?", [{ id: good.id, choiceText: "Good!" }, { id: bad.id, choiceText: "Bad" }]) }, false);
const wording = await outline(A.id);
const q1b = await save(A.id, { id: q1, ...mc("Would you come again?", [{ id: good.id, choiceText: "Yes" }, { id: bad.id, choiceText: "No" }]) }, true);
const meaning = await outline(A.id, true);
const old = meaning.questions.find(x => x.id === q1);
const fresh = meaning.questions.find(x => x.id === q1b);
// the old live screen: delete every choice of a question, then insert them again; and delete the question itself
const B = await makeSurvey(); const qb = await save(B.id, mc("Pick", ["One", "Two"])); await activate(B.id);
const rb = await open(B.id, s2); await answer(s2, rb, qb, rb.questions[0].choices[0].id);
await as(STAFF, "delete from research_survey_choices where question_id = $1", [qb]);
await as(STAFF, "insert into research_survey_choices (question_id, choice_text, sort_order) values ($1, 'One', 0), ($1, 'Two', 1)", [qb]);
const shownChoices = (await as(STAFF, "select choice_text from research_survey_choices where question_id = $1", [qb])).length;
await as(STAFF, "delete from research_survey_questions where id = $1", [qb]);
check("2 a typo fix keeps the answers on the question; a new meaning starts a new version and keeps them on the earlier one; the old screen's replace-and-delete erases nothing and lists no duplicates",
  wording.questions.length === 1 && wording.questions[0].id === q1 && wording.questions[0].answerCount === 1
  && q1b !== q1 && old.removed && old.answerCount === 1 && fresh.version === 2 && fresh.answerCount === 0
  && shownChoices === 2 && await answerCount(B.id) === 1 && await answerCount(A.id) === 1,
  `${wording.questions.length} ${old?.answerCount} ${fresh?.version} ${shownChoices} ${await answerCount(B.id)}`);

// 3. delete is refused with answers; deactivating gives the waiting credit; a survey without answers can be deleted (with its sections)
const C = await makeSurvey(); await save(C.id, txt("Why?")); await activate(C.id);
await scan(C, s3);
const waitingDelete = await attempt(STAFF, "delete from research_surveys where id = $1", [C.id]);
const before = await creditCount(C, s3);
await activate(C.id, false);
const after = await creditCount(C, s3);
const hist = await q("select 1 from sdp_credit_history where source = 'survey_released' and scholar_id_number = $1", [s3.n]);
const answered = await attempt(STAFF, "delete from research_surveys where id = $1", [A.id]);
const D = await makeSurvey(); await save(D.id, mc("X", ["a", "b"])); const more = (await as(STAFF, "select survey_section_save($1, null, 'More', '') id", [D.id]))[0].id;
const dq = await save(D.id, txt("Y", { sectionId: more }));
const dx = (await outline(D.id)).questions[0];
await save(D.id, { id: dx.id, ...mc("X", [{ id: dx.choices[0].id, choiceText: "a", skipToQuestionId: dq }, { id: dx.choices[1].id, choiceText: "b", skipToSectionId: more }]) });
// deleting an ACTIVITY still removes its survey, answers and all, as before (Phase 3 changes that)
const G = await makeSurvey(); await save(G.id, mc("Z", ["a", "b"])); await activate(G.id); await scan(G, s2);
const rg = await open(G.id, s2); await answer(s2, rg, rg.questions[0].id, rg.questions[0].choices[0].id); await submit(s2, rg);
await q("delete from sdp_attendance where activity_id = $1", [G.act]);
let activityDeleted = true; try { await db.query("delete from sdp_activities where id = $1", [G.act]); } catch (e) { activityDeleted = String(e.message); }
const gLeft = (await q("select count(*)::int c from research_surveys where id = $1", [G.id]))[0].c;
const gone = await attempt(STAFF, "delete from research_surveys where id = $1", [D.id]);
const left = await q("select (select count(*) from research_surveys where id = $1)::int s, (select count(*) from research_survey_questions where survey_id = $1)::int qs", [D.id]);
check("3 a survey with answers or a waiting scholar cannot be deleted; deactivating gives the held credit; one without answers is deleted with its questions and sections",
  !waitingDelete.ok && /waiting/.test(waitingDelete.msg) && before === 0 && after === 1 && hist.length === 1 && !answered.ok && /has answers/.test(answered.msg) && gone.ok && left[0].s === 0 && left[0].qs === 0 && activityDeleted === true && gLeft === 0,
  `${waitingDelete.msg} ${before}/${after} ${hist.length} ${answered.msg} ${gone.msg ?? ""} ${JSON.stringify(left)} ${activityDeleted} ${gLeft}`);

// 4. sections, skip to a section, optional questions, a skip that no longer points forward
const E = await makeSurvey();
const e1 = await save(E.id, mc("Attended before?", ["Yes", "No"]));
const e2 = await save(E.id, txt("Which one?"));
const part2 = (await as(STAFF, "select survey_section_save($1, null, 'Part two', 'intro two') id", [E.id]))[0].id;
const part3 = (await as(STAFF, "select survey_section_save($1, null, 'Part three', '') id", [E.id]))[0].id;
const e3 = await save(E.id, txt("Anything else?", { sectionId: part2, isOptional: true }));
const e4 = await save(E.id, txt("Last word?", { sectionId: part3 }));
let o = await outline(E.id);
const part1 = o.sections[0].id;
const c = o.questions.find(x => x.id === e1).choices;
await save(E.id, { id: e1, ...mc("Attended before?", [{ id: c[0].id, choiceText: "Yes" }, { id: c[1].id, choiceText: "No", skipToSectionId: part3 }]) });
await activate(E.id);
await scan(E, s4); await scan(E, s5);
const r4 = await open(E.id, s4);
const noChoice = r4.questions[0].choices[1];
await answer(s4, r4, e1, noChoice.id);
const early = await submit(s4, r4);               // the last question (section three) still unanswered
await answer(s4, r4, e4, null, "bye");
const skipped = await submit(s4, r4);
const r5 = await open(E.id, s5);
await answer(s5, r5, e1, r5.questions[0].choices[0].id); await answer(s5, r5, e2, null, "the fair"); await answer(s5, r5, e4, null, "bye");
const optionalBlank = await submit(s5, r5);
// move section three to the front: the skip now points backwards and acts as "next question"
await as(STAFF, "select survey_reorder($1, $2::jsonb)", [E.id, JSON.stringify([{ sectionId: part3, questionIds: [e4] }, { sectionId: part1, questionIds: [e1, e2] }, { sectionId: part2, questionIds: [e3] }])]);
const r6 = await open(E.id, scholars[5]);
check("4 existing questions become Section 1; skipping to a section makes only that path required; an optional question may stay blank; a skip left pointing backwards acts as next question",
  o.sections.length === 3 && o.sections[0].title === "Section 1" && o.questions.map(x => x.id).join() === [e1, e2, e3, e4].join()
  && noChoice.skipToQuestionId === e4 && !early.ok && skipped.ok && await creditCount(E, s4) === 1 && optionalBlank.ok && await creditCount(E, s5) === 1
  && r6.sections.map(x => x.id).join() === [part3, part1, part2].join() && r6.questions[1].choices[1].skipToQuestionId === null && r6.questions[1].choices[1].endsSurvey === false,
  `${o.sections.map(x => x.title)} ${noChoice.skipToQuestionId === e4} ${early.msg} ${skipped.msg ?? ""} ${optionalBlank.msg ?? ""} ${JSON.stringify(r6.questions[1]?.choices)}`);

// 5. bulk upload goes after what is there and creates sections; deleting keeps answers; only research staff; the undo runs
const F = await makeSurvey();
const f1 = await save(F.id, txt("first"));
const items = [txt("second"), txt("third", { section: "Extra" }), txt("fourth", { section: "extra" })];
const imported = await attempt(STAFF, "select survey_questions_import($1, $2::jsonb, null) n", [F.id, JSON.stringify(items)]);
const fo = await outline(F.id);
const outsider = await attempt(s1.id, "select survey_outline($1, false)", [F.id]);
await as(STAFF, "select survey_question_delete($1)", [e2]);                               // answered by s5: hidden, not erased
const eAfter = await outline(E.id, true);
const sec = fo.sections.find(x => x.title === "Extra");
await as(STAFF, "select survey_section_delete($1, true)", [sec.id]);
const fo2 = await outline(F.id);
const u = await file("undo_survey_sections_safety.sql"), again = await file("supabase_migration_survey_sections_safety.sql");
check("5 bulk upload adds after the existing questions, in order, creating the named section once; deleting keeps answers and questions; scholars cannot use the staff calls; undo and re-run work",
  imported.ok && fo.questions.map(x => x.questionText).join() === "first,second,third,fourth" && fo.sections.length === 2
  && eAfter.questions.find(x => x.id === e2)?.removed === true && eAfter.questions.find(x => x.id === e2)?.answerCount === 1
  && fo2.sections.length === 1 && fo2.questions.length === 4 && !outsider.ok && u.ok && again.ok,
  `${imported.msg ?? ""} ${fo.questions.map(x => x.questionText)} ${fo.sections.map(x => x.title)} ${outsider.ok} ${u.msg ?? ""} ${again.msg ?? ""}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
