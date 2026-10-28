// tests/entered-grades/apply_flow_db_tests.mjs — grades inside the application form, and the SDP reconsideration waiting for the grades
//   (supabase_migration_entered_grades_d_apply_flow.sql)
// Run:  node tests/entered-grades/apply_flow_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_entered_grades_d_apply_flow.sql", UNDO = "undo_entered_grades_d.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const PLAIN = seedId("staff:demo.plain"), ITADMIN = seedId("staff:it.admin1"), EVALUATOR = seedId("staff:demo.evaluator");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
await q("update renewal_windows set school_ids = null where id = $1", [win.id]).catch(() => {});
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]);
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);

await db.exec(read("undo_entered_grades_e.sql"));      // this test is about file D alone (file E, which makes grades a must for applying, has its own test)
await db.exec(read(FILE));
await db.exec(read(FILE));     // twice: safe

const schoolId = async key => (await q("select id from schools where name like $1", [`%${key}%`]))[0].id;
const LETTERS = await schoolId("Letter-Grade"), LOWER = await schoolId("Lower-Is-Better");
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
const PERIOD = (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LOWER, PERIOD]);
const pickScholars = async school => (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1", [school, Y, T])).map(r => r.s);
// the school that has not uploaded has only a few scholars in the demo: move four free scholars of the other school there for this test
for (const s of (await pickScholars(LOWER)).slice(0, 4)) await q("update scholars set school_id = $1, school = (select name from schools where id = $1) where scholar_id_number = $2", [LETTERS, s]);
const letters = await pickScholars(LETTERS), lowers = await pickScholars(LOWER);
const lackSdp = s => q("delete from sdp_attendance where scholar_id_number = $1", [s]);
for (const s of [...letters.slice(0, 6), ...lowers.slice(0, 3)]) await lackSdp(s);
const [A, B, C, D, E, F] = letters;       // the school has NOT uploaded
const [L1, L2] = lowers;                  // this school will upload
check("the demo has scholars of a school that has not uploaded and of one that will, none applied yet", letters.length >= 6 && lowers.length >= 2);

const lines = (...g) => JSON.stringify(g.map((x, i) => ({ code: `SUBJ${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: x })));
const folder = (s, id) => `${s}/${id}/grade-entries/`;
const file = (s, id, n = 0) => ({ path: `${folder(s, id)}${n}-shot.png`, name: `shot${n}.png`, mime: "image/png", size: 12345 });
const apply9 = (s, o = {}) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', $2, $3::jsonb, $4::jsonb, $5) id",
  [win.id, o.request ?? false, o.lines ?? "[]", JSON.stringify(o.files ?? []), o.ack ?? true]);
const apply6 = (s, request) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', $2) id", [win.id, request]);
const recOf = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const evalOf = async s => (await q("select public._renewal_evaluate($1, $2, $3) e", [s, Y, T]))[0].e;
const status = async s => (await q("select public._eg_grades_status($1, $2, $3) s", [s, basis.basis_school_year, basis.basis_term]))[0].s;

console.log("Where the grades stand");
check("with nothing entered and no school upload the status is 'none', and the grades are not in", await status(A) === "none" && (await q("select public._eg_grades_available($1, $2, $3) v", [A, basis.basis_school_year, basis.basis_term]))[0].v === false);

check("the scholar's preview before applying says the form can carry grades (so the form offers the grades step only when this file is installed)", (await rows(uidOf(A), "select public.renewal_my_preview($1) p", [win.id]))[0].p.grades_in_form === true);

console.log("\nAn SDP reconsideration needs the grades first");
const noGrades = await apply6(A, true);
check("asking for an SDP reconsideration without any grades is refused, and no application is left behind", !noGrades.ok && /Enter your grades first/.test(noGrades.msg) && !(await recOf(A)), noGrades.msg);
const noGrades9 = await apply9(A, { request: true });
check("the same through the new form (no grades, with the request) is refused too", !noGrades9.ok && /Enter your grades first/.test(noGrades9.msg) && !(await recOf(A)), noGrades9.msg);
const okWithGrades = await apply9(B, { request: true, lines: lines("A", "F"), files: [file(B, win.id)] });
check("with the grades entered in the form, the application, the grades and the request are all saved together", okWithGrades.ok, okWithGrades.msg);
const recB = await recOf(B);
const entryB = (await q("select * from renewal_self_grade_submissions where record_id = $1", [recB.id]))[0];
check("the entered grades wait for the Grades Approver (version 1, 2 subjects, 1 image, with the tick time) and the SDP request is waiting", entryB.status === "pending" && entryB.version === 1 && entryB.acknowledged_at
  && (await q("select count(*)::int n from renewal_self_grade_lines where submission_id = $1", [entryB.id]))[0].n === 2 && (await q("select count(*)::int n from renewal_self_grade_files where submission_id = $1", [entryB.id]))[0].n === 1
  && (await q("select status from sdp_reconsideration_requests where record_id = $1", [recB.id]))[0].status === "pending");
check("the scholar is told about both; the Grades Approver and the SDP approver (it.admin1) get a bell notice", (await q("select kind from scholar_notifications where scholar_id_number = $1 and kind in ('grades_entry_submitted', 'sdp_reconsideration_requested')", [B])).length === 2
  && (await q("select user_id from notifications where type = 'renewal' and title = 'Entered grades to approve'")).some(r => r.user_id === PLAIN)
  && (await q("select user_id from notifications where type = 'renewal' and title = 'SDP reconsideration requested'")).some(r => r.user_id === ITADMIN));
check("images from the wrong folder (another scholar's, or another application's) refuse the whole application, and nothing is left behind", await (async () => {
  const wrong1 = await apply9(C, { request: true, lines: lines("A"), files: [file(B, win.id)] });
  const wrong2 = await apply9(C, { lines: lines("A"), files: [{ ...file(C, win.id), path: `${C}/some-other-id/grade-entries/x.png` }] });
  return !wrong1.ok && !wrong2.ok && /own folder/.test(wrong1.msg) && !(await recOf(C));
})());
check("the usual checks still apply to the form's grades (the tick, at least one image, no repeated code)", !(await apply9(C, { lines: lines("A"), files: [file(C, win.id)], ack: false })).ok
  && !(await apply9(C, { lines: lines("A"), files: [] })).ok && !(await apply9(C, { lines: JSON.stringify([{ code: "X", subject: "S", units: 3, grade: "A" }, { code: "x", subject: "S", units: 3, grade: "B" }]), files: [file(C, win.id)] })).ok && !(await recOf(C)));
const noRequest = await apply9(C, { lines: lines("A", "B"), files: [file(C, win.id)] });
check("a scholar can apply with the grades and no SDP request (nothing is asked for)", noRequest.ok && (await q("select count(*)::int n from sdp_reconsideration_requests where scholar_id_number = $1", [C]))[0].n === 0);
check("after applying, the form's grades and request cannot be added through the form again (the renewal page is used)", !(await apply9(B, { request: true, lines: lines("A"), files: [file(B, win.id)] })).ok && /only when you first apply/.test((await apply9(B, { request: true, lines: lines("A"), files: [file(B, win.id)] })).msg));
const old5 = await attempt(uidOf(D), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);
check("the older application call (no grades, no request) still works", old5.ok, old5.msg);
check("after applying without grades, a later request (the older 6-argument call) is refused anyway: only when first applying", !(await attempt(uidOf(D), "select public._renewal_sdp_request_create($1)", [(await recOf(D)).id])).ok);

console.log("\nWhen the school's grades are in");
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now())", [LOWER, PERIOD]);
check("a scholar of a school that uploaded is 'school' (the grades are in)", await status(L1) === "school");
const withSchool = await apply9(L1, { request: true });
check("such a scholar can ask for an SDP reconsideration without entering anything", withSchool.ok, withSchool.msg);
const recL2 = await attempt(uidOf(L2), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', true, $2::jsonb, $3::jsonb, true) id", [win.id, lines("A"), JSON.stringify([file(L2, win.id)])]);
check("but entering grades is refused when the school has already uploaded them", !recL2.ok && /already uploaded/.test(recL2.msg) && !(await recOf(L2)), recL2.msg);

console.log("\nApproving the SDP reconsideration needs complete grades");
const reqB = (await q("select id from sdp_reconsideration_requests where record_id = $1", [recB.id]))[0].id;
const reqL1 = (await q("select r.id from sdp_reconsideration_requests r join renewal_records x on x.id = r.record_id where x.scholar_id_number = $1", [L1]))[0].id;
const list = (await rows(ITADMIN, "select * from public.sdp_reconsideration_list('pending')"));
check("the approvers' list says where each scholar's grades stand", list.find(r => r.id === reqB)?.grades_status === "pending" && list.find(r => r.id === reqB)?.grades_complete === false
  && list.find(r => r.id === reqL1)?.grades_status === "school" && list.find(r => r.id === reqL1)?.grades_complete === true, JSON.stringify(list.map(r => [r.grades_status, r.grades_complete])));
const approveEarly = await attempt(ITADMIN, "select public.renewal_sdp_reconsideration_decide($1, true, '') r", [reqB]);
check("approving while the entered grades still wait for the Grades Approver is refused, and nothing changed", !approveEarly.ok && /grades are not complete yet/.test(approveEarly.msg) && (await q("select status from sdp_reconsideration_requests where id = $1", [reqB]))[0].status === "pending"
  && (await q("select count(*)::int n from sdp_reconsideration_debts where request_id = $1", [reqB]))[0].n === 0, approveEarly.msg);
check("approving is allowed at once when the school has uploaded the grades", (await attempt(ITADMIN, "select public.renewal_sdp_reconsideration_decide($1, true, '') r", [reqL1])).ok && (await q("select status from sdp_reconsideration_requests where id = $1", [reqL1]))[0].status === "approved");
// the Grades Approver returns the entered grades first: still not complete
const idEntry = entryB.id;
await attempt(PLAIN, "select public.renewal_self_grades_decide($1, false, 'Please correct Subject 2.') r", [idEntry]);
check("after a return the grades are 'returned' (not complete) and a request is still refused to approve", await status(B) === "returned" && !(await attempt(ITADMIN, "select public.renewal_sdp_reconsideration_decide($1, true, '') r", [reqB])).ok);
await attempt(uidOf(B), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [recB.id, lines("A", "C"), JSON.stringify([file(B, recB.id, 1)])]);
const entry2 = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recB.id]))[0].id;
check("a new try is 'pending' again; the older saving call (for an existing application) still works the same", await status(B) === "pending");
check("a denial is always possible, even while the grades wait", await (async () => {
  const r = await attempt(ITADMIN, "select public.renewal_sdp_reconsideration_decide($1, false, 'Not now.') r", [reqB]);
  return r.ok && r.rows[0].r === "denied";
})());
// a second scholar: approve once the Grades Approver has approved the entered grades
const okE = await apply9(E, { request: true, lines: lines("A", "B"), files: [file(E, win.id)] });
const recE = await recOf(E);
const reqE = (await q("select id from sdp_reconsideration_requests where record_id = $1", [recE.id]))[0].id;
check("another scholar applies with grades and a request", okE.ok, okE.msg);
const entryE = (await q("select id from renewal_self_grade_submissions where record_id = $1", [recE.id]))[0].id;
await attempt(PLAIN, "select public.renewal_self_grades_decide($1, true, '') r", [entryE]);
check("once the Grades Approver approved the entered grades, the grades are complete and the SDP reconsideration can be approved (and it moves the application on)", await status(E) === "approved"
  && (await rows(ITADMIN, "select * from public.sdp_reconsideration_list('pending')")).find(r => r.id === reqE).grades_complete === true
  && (await attempt(ITADMIN, "select public.renewal_sdp_reconsideration_decide($1, true, 'ok') r", [reqE])).ok && (await q("select count(*)::int n from sdp_reconsideration_debts where request_id = $1", [reqE]))[0].n >= 1);
check("only approvers decide, as before", !(await attempt(EVALUATOR, "select public.renewal_sdp_reconsideration_decide($1, true, '') r", [reqE])).ok);

console.log("\nThe undo and putting it back");
await db.exec(read(UNDO));
check("after the undo the 9-argument application call is gone, the list has its older columns, and the helpers are gone", (await q("select count(*)::int n from pg_proc where proname = 'renewal_apply' and pronargs = 9"))[0].n === 0
  && (await q("select count(*)::int n from pg_proc where proname in ('_eg_save', '_eg_grades_status', '_eg_grades_complete', '_eg_grades_available')"))[0].n === 0
  && (await attempt(ITADMIN, "select * from public.sdp_reconsideration_list('all')")).rows.every(r => !("grades_status" in r)));
check("after the undo the preview no longer says so", (await rows(uidOf(A), "select public.renewal_my_preview($1) p", [win.id]))[0].p.grades_in_form === undefined);
check("after the undo a request no longer needs grades (the earlier behaviour), and entering grades for an existing application still works", await (async () => {
  const r = await attempt(uidOf(F), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', true) id", [win.id]);
  const rec = await recOf(F);
  const enter = rec ? await attempt(uidOf(F), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [rec.id, lines("A"), JSON.stringify([file(F, rec.id)])]) : { ok: false };
  return r.ok && enter.ok;
})());
await db.exec(read(FILE));
check("it can be put back after the undo", (await q("select count(*)::int n from pg_proc where proname = '_eg_save'"))[0].n === 1);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file replaces functions only: no table is created or changed, nothing is deleted", !/\b(create table|alter table|drop table|delete from|truncate)\b/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
