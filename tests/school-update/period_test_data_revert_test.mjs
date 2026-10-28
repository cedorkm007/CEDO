// tests/school-update/period_test_data_revert_test.mjs — the revert of the test data in the grading periods and SDP credits (sql_oneoff/period_test_data_REVERT.sql)
//   a dry run changes nothing; it stops when anything belongs to a non-test account; the real run backs up, removes only what it says, keeps everything else.
// Run:  node tests/school-update/period_test_data_revert_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const SQL = fs.readFileSync("sql_oneoff/period_test_data_REVERT.sql", "utf8");
let DRY = SQL, REAL = SQL.replace("v_confirm text := 'NO';", "v_confirm text := 'YES';");
check("the file as sent is the dry run (it says 'NO')", /v_confirm text := 'NO';/.test(SQL));
const run = async sql => { const res = await db.exec(sql); return res[res.length - 1]?.rows ?? []; };
const attempt = async sql => { try { return { ok: true, rows: await run(sql) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const tables = ["academic_periods", "grading_period_settings", "scholar_subjects_grades", "school_period_submissions", "school_submission_events", "grade_correction_requests", "grade_documents", "scholar_grade_audit",
  "sdp_attendance", "sdp_reserved_credits", "sdp_credit_history", "scholars", "schools", "renewal_windows"];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await q(`select count(*)::int n from public.${t}`))[0].n])));

// ── the project's situation: testers-only window; the 2nd semester opened for the test; a few grades of the test accounts in the real 1st semester; credits ──
const owners = await q("select distinct w.id, r.scholar_id_number from renewal_records r join renewal_windows w on w.id = r.window_id");
for (const w of [...new Set(owners.map(o => o.id))]) await q("update renewal_windows set testers = $2 where id = $1", [w, owners.filter(o => o.id === w).map(o => o.scholar_id_number)]);
const testers = [...new Set(owners.map(o => o.scholar_id_number))].sort();
const [T1, T2] = testers;
const nonTester = (await q("select scholar_id_number s from scholars where not (scholar_id_number = any ($1)) order by 1 limit 3", [testers])).map(r => r.s);
const schoolLower = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id, schoolHigher = (await q("select id from schools where name like '%Higher-Is-Better%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ('2026-2027', '1st Semester', 'open'), ('2026-2027', '2nd Semester', 'open') on conflict (school_year, term) do update set status = 'open'");
const P1 = (await q("select id from academic_periods where school_year = '2026-2027' and term = '1st Semester'"))[0].id;
const P2 = (await q("select id from academic_periods where school_year = '2026-2027' and term = '2nd Semester'"))[0].id;
const addGrade = (s, sem, subj, grade, school) => q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, recorded_by_school_id) values ($1, '2026-2027', $2, $3, $3, $4, $5)", [s, sem, subj, grade, school]);
// a real school's older grades in the real semester (must stay), and the test setup's grades
await addGrade(nonTester[0], "1st Semester", "REAL-1", "1.5", schoolLower); await addGrade(nonTester[1], "1st Semester", "REAL-2", "2.0", schoolLower);
await q("update scholar_subjects_grades set created_at = '2020-01-01' where subject like 'REAL-%'");
await addGrade(T1, "1st Semester", "TEST-A", "1.5", schoolHigher); await addGrade(T2, "1st Semester", "TEST-B", "5.0", schoolHigher);
await addGrade(T1, "2nd Semester", "TEST-C", "2.0", schoolHigher); await addGrade(T2, "2nd Semester", "TEST-D", "2.0", schoolHigher);
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now()), ($1, $3, 'submitted', now())", [schoolHigher, P1, P2]);
await q("insert into school_submission_events (school_id, period_id, event) values ($1, $2, 'submitted'), ($1, $3, 'submitted')", [schoolHigher, P1, P2]);
await q("insert into grade_correction_requests (school_id, period_id, scholar_id_number, subject, reason) values ($1, $2, $3, 'TEST-A', 'a test reason')", [schoolHigher, P1, T1]);
await q("insert into grade_documents (school_id, scholar_id_number, period_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, $3, 'test/evidence.pdf', 'evidence.pdf', 'application/pdf', 10)", [schoolHigher, T1, P2]);
const act = (await q("select id from sdp_activities order by name limit 1"))[0].id;
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, '2026-10-20', '2026-2027', '1st Semester', 7)", [act, T1]);
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, '2026-10-20', '2026-2027', '1st Semester', 8)", [act, nonTester[0]]);
await q("update scholar_grade_audit set changed_at = '2020-01-01' where scholar_id_number = $1", [nonTester[0]]);
// the demo's own seeded credits of these accounts were made after the renewal windows, so they count as "added since the tests began" too
const testerCredits = (await q("select count(*)::int n from sdp_attendance a where a.scholar_id_number = any ($1) and (to_jsonb(a) ->> 'created_at')::timestamptz >= (select min(created_at) from renewal_windows)", [testers]))[0].n;
const testerCreditsAll = (await q("select count(*)::int n from sdp_attendance where scholar_id_number = any ($1)", [testers]))[0].n;
const before = await counts();
check("the demo now looks like the real project (a 2nd semester with test grades, a submission, evidence; test grades in the 1st; credits)", before.scholar_subjects_grades >= 6 && before.school_period_submissions >= 2 && before.grade_documents === 1);

console.log("\nThe dry run");
const dry = await run(DRY);
const find = (rows, what) => rows.find(r => r.what.startsWith(what));
check("it only counts: nothing in any table changed, and no holding table was made", JSON.stringify(await counts()) === JSON.stringify(before) && (await q("select to_regclass('public._period_test_backup') t"))[0].t === null);
check("it says it is a dry run", dry.some(r => r.step === "RESULT" && /DRY RUN/.test(r.what)));
check("it counts what it would remove: 2 grades in the opened semester, 2 test grades in the real one, both submissions, the correction request, the evidence record, the period, the test accounts' credits",
  Number(find(dry, "grades in 2nd Semester").rows) === 2 && Number(find(dry, "grades of the test accounts in the REAL").rows) === 2 && Number(find(dry, "school submissions").rows) === 2
  && Number(find(dry, "grade correction requests").rows) === 1 && Number(find(dry, "evidence file records").rows) === 1 && Number(find(dry, "the period 2nd Semester").rows) === 1 && Number(find(dry, "SDP credits of the test accounts").rows) === testerCredits && testerCredits >= 1, JSON.stringify(dry.filter(r => r.step === "1. REMOVE")));
check("it says what stays: the real school's two older grades and everyone else's credits", Number(find(dry, "grades in the REAL 1st Semester 2026-2027 that stay").rows) === 2 && dry.some(r => r.what.startsWith("SDP credits of everyone else") && Number(r.rows) >= 1));
check("it lists the scholars and the activities, and the evidence file to delete by hand", dry.some(r => r.step.startsWith("2. GRADES") && r.what.startsWith(T1)) && dry.some(r => r.step.startsWith("3. SDP CREDITS")) && dry.some(r => r.step.startsWith("4. FILE") && r.what === "test/evidence.pdf"));

console.log("\nWhen something is not a test account's, it stops");
await addGrade(nonTester[2], "2nd Semester", "REAL-X", "1.0", schoolHigher);
const stop1 = await attempt(REAL);
check("a grade of someone who is not a test account in the opened semester stops it, lists the Scholar ID, and nothing changed", !stop1.ok && /STOPPED/.test(stop1.msg) && stop1.msg.includes(nonTester[2]) && (await counts()).scholar_subjects_grades === before.scholar_subjects_grades + 1, stop1.msg);
await q("delete from scholar_subjects_grades where subject = 'REAL-X'");
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, '2026-10-20', '2026-2027', '2nd Semester', 9)", [act, nonTester[1]]);
const stop2 = await attempt(REAL);
check("a (possibly real) SDP credit stamped with the opened semester stops it", !stop2.ok && /SDP credits of people who are not test accounts/.test(stop2.msg) && stop2.msg.includes(nonTester[1]), stop2.msg);
await q("delete from sdp_attendance where scholar_id_number = $1 and semester = '2nd Semester'", [nonTester[1]]);
await addGrade(nonTester[0], "1st Semester", "REAL-LOCK", "1.0", schoolHigher);
await q("update scholar_subjects_grades set created_at = '2020-01-01' where subject = 'REAL-LOCK'");
const stop3 = await attempt(REAL);
check("a school that submitted for the real semester but also has other scholars' grades in it stops it (it would not take a real school's submission)", !stop3.ok && /also has grades of other scholars/.test(stop3.msg), stop3.msg);
await q("delete from scholar_subjects_grades where subject = 'REAL-LOCK'");
const clean = await counts();

console.log("\nThe two named scholars (not test accounts) whose 2nd-semester credits were asked to be removed too");
const [X1, X2] = [nonTester[1], nonTester[2]];
const NAMED = "v_extra text[] := array['2306-01451', '2507-00328'];";
check("the file names exactly the two scholars the project's check found", SQL.includes(NAMED));
const withNamed = s => s.replace(NAMED, `v_extra text[] := array['${X1}', '${X2}'];`);
const addCredit = (s, sem, occ) => q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, '2026-10-21', '2026-2027', $3, $4)", [act, s, sem, occ]);
await addCredit(X1, "2nd Semester", 21); await addCredit(X2, "2nd Semester", 22); await addCredit(X1, "1st Semester", 23);
await addCredit(nonTester[0], "2nd Semester", 24);
const stopOther = await attempt(withNamed(REAL));
check("a 2nd-semester credit of ANY OTHER scholar who is not a test account still stops it, and lists only that scholar", !stopOther.ok && /SDP credits of people who are not test accounts/.test(stopOther.msg) && stopOther.msg.includes(nonTester[0]) && !stopOther.msg.includes(X1) && !stopOther.msg.includes(X2), stopOther.msg);
await q("delete from sdp_attendance where scholar_id_number = $1 and semester = '2nd Semester'", [nonTester[0]]);
const beforeNamed = await counts();
const dry2 = await run(withNamed(DRY));
check("with only the two named scholars' credits left, the dry run passes, changes nothing, and counts those credits (and the one of theirs that stays)", JSON.stringify(await counts()) === JSON.stringify(beforeNamed)
  && Number(find(dry2, "SDP credits of the two named scholars (").rows) === 2 && Number(find(dry2, "SDP credits of the two named scholars in any other semester").rows) >= 1, JSON.stringify(dry2.filter(r => /named/.test(r.what))));
check("it lists each of those credits (scholar, activity, category, credits, day) so you can see what goes", dry2.filter(r => r.step.startsWith("3b.")).length === 2 && dry2.some(r => r.step.startsWith("3b.") && r.what.startsWith(X1)));
DRY = withNamed(DRY); REAL = withNamed(REAL);

console.log("\nThe real run");
const real = await run(REAL);
const after = await counts();
check("it says it is done", real.some(r => r.step === "RESULT" && /DONE/.test(r.what)));
check("the opened semester is gone: its grades, submission, evidence record and the period itself", (await q("select count(*)::int n from scholar_subjects_grades where semester = '2nd Semester' and school_year = '2026-2027'"))[0].n === 0
  && (await q("select count(*)::int n from academic_periods where school_year = '2026-2027' and term = '2nd Semester'"))[0].n === 0 && after.grade_documents === 0);
check("in the real 1st semester only the test accounts' grades went; the real school's two grades and the period stay", (await q("select subject from scholar_subjects_grades where semester = '1st Semester' and school_year = '2026-2027' order by 1")).map(r => r.subject).join() === "REAL-1,REAL-2"
  && (await q("select count(*)::int n from academic_periods where school_year = '2026-2027' and term = '1st Semester'"))[0].n === 1);
check("the test submission of the real semester is gone, so no school stays locked out; its correction request and the history lines are gone too", (await q("select count(*)::int n from school_period_submissions"))[0].n === before.school_period_submissions - 2
  && after.grade_correction_requests === before.grade_correction_requests - 1 && after.school_submission_events === before.school_submission_events - 2);
check("the two named scholars' 2nd-semester credits are gone; their 1st-semester credit stays", (await q("select count(*)::int n from sdp_attendance where scholar_id_number = any ($1) and semester = '2nd Semester' and school_year = '2026-2027'", [[X1, X2]]))[0].n === 0
  && (await q("select count(*)::int n from sdp_attendance where scholar_id_number = $1 and semester = '1st Semester' and occurrence_number = 23", [X1]))[0].n === 1);
check("the test accounts' credits since the tests began are gone (older credits of those accounts stay); everyone else's credit stays", (await q("select count(*)::int n from sdp_attendance where scholar_id_number = any ($1)", [testers]))[0].n === testerCreditsAll - testerCredits
  && (await q("select count(*)::int n from sdp_attendance where scholar_id_number = $1 and occurrence_number = 8", [nonTester[0]]))[0].n === 1);
check("the audit trail shows nothing of the test accounts' grades in these periods; the real school's older lines stay", (await q("select count(*)::int n from scholar_grade_audit where scholar_id_number = any ($1) and school_year = '2026-2027' and semester in ('1st Semester', '2nd Semester')", [testers]))[0].n === 0
  && (await q("select count(*)::int n from scholar_grade_audit where scholar_id_number = $1", [nonTester[0]]))[0].n >= 1);
check("everything else is untouched: scholars, schools, the other periods, credits set aside, the current grading period", after.scholars === before.scholars && after.schools === before.schools && after.sdp_reserved_credits === before.sdp_reserved_credits
  && after.grading_period_settings === before.grading_period_settings && after.academic_periods === before.academic_periods - 1);
const backup = Object.fromEntries((await q("select table_name, count(*)::int n from public._period_test_backup group by 1")).map(b => [b.table_name, b.n]));
check("every removed row was copied to the holding table first", backup.scholar_subjects_grades === 4 && backup.school_period_submissions === 2 && backup.grade_correction_requests === 1 && backup.grade_documents === 1 && backup.academic_periods === 1 && backup.sdp_attendance === testerCredits + 2 && backup.school_submission_events === 2, JSON.stringify(backup));
check("the holding table is locked: signed-in people and visitors cannot read it", await (async () => {
  for (const role of ["authenticated", "anon"]) {
    try { await db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query("select count(*) from public._period_test_backup"); }); return false; } catch { /* refused, as it should be */ }
  }
  return true;
})());
const again = await attempt(REAL);
check("running it a second time is harmless", again.ok && Number(find(again.rows, "grades in 2nd Semester").rows) === 0);
await db.exec(fs.readFileSync("sql_oneoff/period_test_data_drop_backup.sql", "utf8"));
check("the second file drops the holding table", (await q("select to_regclass('public._period_test_backup') t"))[0].t === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
