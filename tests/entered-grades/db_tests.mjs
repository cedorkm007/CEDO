// tests/entered-grades/db_tests.mjs — grades entered by the scholar during renewal (supabase_migration_entered_grades_a / b / c)
// Run:  node tests/entered-grades/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
await db.exec(read("undo_entered_grades_e.sql"));      // this test is about the entered grades after applying; the later rule that grades must be in before applying (file E) has its own test
const FILES = ["supabase_migration_entered_grades_a_tables.sql", "supabase_migration_entered_grades_b_grading_columns.sql", "supabase_migration_entered_grades_c_functions.sql"];
const UNDOS = ["undo_entered_grades_c.sql", "undo_entered_grades_b.sql", "undo_entered_grades_a.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVALUATOR = seedId("staff:demo.evaluator"), SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), ITADMIN = seedId("staff:it.admin1"), COUNSELOR = seedId("staff:demo.counselor");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
await q("update renewal_windows set school_ids = null where id = $1", [win.id]).catch(() => {});
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]);
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];

for (const f of FILES) await db.exec(read(f));
for (const f of FILES) await db.exec(read(f));     // twice: safe
await db.exec(read("supabase_migration_sdp_reconsideration_a_tables.sql")).catch(() => {});

// ── the schools: "letters" has NOT uploaded its grades (letters A-F, passing 1.0); "lower" has (passing 3.0) ──
const schoolId = async key => (await q("select id from schools where name like $1", [`%${key}%`]))[0].id;
const LETTERS = await schoolId("Letter-Grade"), LOWER = await schoolId("Lower-Is-Better");
const periodOf = async () => {
  await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
  return (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
};
const PERIOD = await periodOf();
await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
await q("delete from scholar_subjects_grades where school_year = $1 and semester = $2 and scholar_id_number in (select scholar_id_number from scholars where school_id = $3)", [basis.basis_school_year, basis.basis_term, LETTERS]);

const letterScholars = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') order by 1", [LETTERS])).map(r => r.s);
const evalOf = async s => (await q("select public._renewal_evaluate($1, $2, $3) e", [s, Y, T]))[0].e;
const applied = [];
for (const s of letterScholars) {
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0].n === 0) {
    const r = await attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);
    if (!r.ok) continue;
  }
  applied.push(s);
}
check("the demo has scholars of a school that has not uploaded its grades, with applications", applied.length >= 3, String(applied.length));
const [A, B, C] = applied;
const recOf = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const recA = await recOf(A), recB = await recOf(B), recC = await recOf(C);
const lines = (...g) => JSON.stringify(g.map((x, i) => ({ code: `SUBJ${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: x })));
const folder = (s, rec) => `${s}/${rec.id}/grade-entries/`;
const files = (s, rec, n = 1) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ path: `${folder(s, rec)}${i}-shot.png`, name: `shot${i}.png`, mime: "image/png", size: 12345 })));
const submit = (s, rec, l, f, ack = true) => attempt(uidOf(s), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, $4) id", [rec.id, l, f, ack]);
const decide = (uid, id, approve, note = "") => attempt(uid, "select public.renewal_self_grades_decide($1, $2, $3) r", [id, approve, note]);
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);

console.log("\nWho may approve");
check("only an account with the Grades Approver tag may; the evaluator, SEAD staff, the counselor and it.admin1 may not unless tagged", (await rows(PLAIN, "select public.can_approve_scholar_grades() v"))[0].v === true
  && (await Promise.all([EVALUATOR, SEAD, COUNSELOR, ITADMIN].map(u => rows(u, "select public.can_approve_scholar_grades() v")))).every(r => r[0].v === false));

console.log("\nEntering grades");
const mine = await rows(uidOf(A), "select public.renewal_my_self_grades($1) m", [recA.id]);
check("a scholar whose school has not uploaded can enter grades (no reason given), and has nothing entered yet", mine[0].m.cannot_enter_reason === null && mine[0].m.submission === null && mine[0].m.lines.length === 0);
check("the renewal check says the school has not uploaded, and that nothing was entered", (await evalOf(A)).grades.school_submitted === false && (await evalOf(A)).grades.self_reported === false);
check("a scholar of a school that HAS uploaded is told so and cannot enter grades", await (async () => {
  const lowerScholar = (await q("select scholar_id_number s from scholars where school_id = $1 and status not in ('Removed', 'On leave') order by 1 limit 1 offset 20", [LOWER]))[0]?.s ?? (await q("select scholar_id_number s from scholars where school_id = $1 order by 1 limit 1", [LOWER]))[0].s;
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [lowerScholar, Y, T]))[0].n === 0) await attempt(uidOf(lowerScholar), "select public.renewal_apply($1, 'S', 'P', '2nd Year', '') id", [win.id]);
  const rec = await recOf(lowerScholar);
  if (!rec) return true;
  const m = (await rows(uidOf(lowerScholar), "select public.renewal_my_self_grades($1) m", [rec.id]))[0].m;
  const r = await submit(lowerScholar, rec, lines("1.5"), files(lowerScholar, rec));
  return /already uploaded/.test(m.cannot_enter_reason ?? "") && !r.ok && /already uploaded/.test(r.msg);
})());
const L2 = lines("A", "C"), F1 = files(A, recA);
check("it needs the tick that wrong or false information means disciplinary action", !(await submit(A, recA, L2, F1, false)).ok && /tick the box/.test((await submit(A, recA, L2, F1, false)).msg));
check("it needs at least one subject, and no more than 25", !(await submit(A, recA, "[]", F1)).ok && !(await submit(A, recA, JSON.stringify(Array.from({ length: 26 }, (_, i) => ({ code: `C${i}`, subject: "S", units: 3, grade: "A" }))), F1)).ok);
check("every subject needs a code, a name, units and a grade; units must be a sensible number; a code cannot repeat", !(await submit(A, recA, JSON.stringify([{ code: "", subject: "S", units: 3, grade: "A" }]), F1)).ok
  && !(await submit(A, recA, JSON.stringify([{ code: "X", subject: "S", units: 0, grade: "A" }]), F1)).ok && !(await submit(A, recA, JSON.stringify([{ code: "X", subject: "S", units: "abc", grade: "A" }]), F1)).ok
  && !(await submit(A, recA, JSON.stringify([{ code: "X", subject: "S", units: 3, grade: "A" }, { code: "x", subject: "S2", units: 3, grade: "B" }]), F1)).ok);
check("at least one image is needed, at most 5; only JPG / PNG / WEBP; not too big; only from the scholar's own folder for this application", !(await submit(A, recA, L2, "[]")).ok && !(await submit(A, recA, L2, files(A, recA, 6))).ok
  && !(await submit(A, recA, L2, JSON.stringify([{ path: `${folder(A, recA)}x.pdf`, name: "x.pdf", mime: "application/pdf", size: 10 }]))).ok
  && !(await submit(A, recA, L2, JSON.stringify([{ path: `${folder(A, recA)}x.png`, name: "x.png", mime: "image/png", size: 99999999 }]))).ok
  && !(await submit(A, recA, L2, files(B, recB))).ok && !(await submit(A, recA, L2, files(A, recB))).ok);
check("nothing was saved by the refused tries", (await q("select count(*)::int n from renewal_self_grade_submissions"))[0].n === 0);
check("a scholar cannot enter grades for someone else's application", !(await submit(B, recA, L2, F1)).ok);
const ok1 = await submit(A, recA, L2, F1);
check("a correct try is saved", ok1.ok, ok1.msg);
const s1 = (await q("select * from renewal_self_grade_submissions where record_id = $1", [recA.id]))[0];
check("it is waiting (pending), version 1, for the semester the renewal looks at, with the tick time; subjects and the image are saved", s1.status === "pending" && s1.version === 1 && s1.basis_school_year === basis.basis_school_year && s1.basis_term === basis.basis_term && s1.acknowledged_at
  && (await q("select count(*)::int n from renewal_self_grade_lines where submission_id = $1", [s1.id]))[0].n === 2 && (await q("select count(*)::int n from renewal_self_grade_files where submission_id = $1", [s1.id]))[0].n === 1);
check("the scholar is told it was sent for approval; the Grades Approver gets a bell notice (the evaluator does not)", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'grades_entry_submitted'", [A]))[0].n === 1
  && (await q("select user_id from notifications where type = 'renewal' and title = 'Entered grades to approve'")).map(r => r.user_id).join() === PLAIN);
const evPending = await evalOf(A);
check("until it is approved the renewal waits, and says it waits for the Grades Approver", evPending.grades.state === "waiting" && /waiting for the Grades Approver/.test(evPending.grades.reason) && evPending.grades.self_status === "pending" && evPending.grades.self_reported === false, JSON.stringify(evPending.grades));
const ok2 = await submit(A, recA, lines("A", "C", "D"), F1);
check("sending it again while it waits replaces the old try (the old one is 'superseded')", ok2.ok && (await q("select status, version from renewal_self_grade_submissions where record_id = $1 order by version", [recA.id])).map(r => `${r.version}:${r.status}`).join() === "1:superseded,2:pending");
check("the scholar sees their newest try with its subjects, images and status", await (async () => {
  const m = (await rows(uidOf(A), "select public.renewal_my_self_grades($1) m", [recA.id]))[0].m;
  return m.submission.status === "pending" && m.submission.version === 2 && m.lines.length === 3 && m.files.length === 1;
})());
check("another scholar cannot read these tables directly", (await rows(uidOf(B), "select count(*)::int n from renewal_self_grade_submissions"))[0].n === 0 && !(await attempt(uidOf(A), "update renewal_self_grade_submissions set status = 'approved'")).ok);

console.log("\nDeciding");
const id2 = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recA.id]))[0].id;
check("the evaluator, SEAD staff, it.admin1, a scholar and a visitor cannot decide", (await Promise.all([EVALUATOR, SEAD, ITADMIN, uidOf(A)].map(u => decide(u, id2, true)))).every(r => !r.ok && /Only a Grades Approver/.test(r.msg))
  && !(await attempt(null, "select public.renewal_self_grades_decide($1, true, '')", [id2], "anon")).ok);
const list = uid => rows(uid, "select * from public.renewal_self_grades_list('pending')");
check("the approver and the evaluator can read the list (the evaluator cannot decide); SEAD staff and scholars cannot", (await list(PLAIN)).length === 1 && (await list(EVALUATOR)).length === 1 && (await list(EVALUATOR))[0].can_decide === false && (await list(PLAIN))[0].can_decide === true
  && !(await attempt(SEAD, "select * from public.renewal_self_grades_list('pending')")).ok && !(await attempt(uidOf(A), "select * from public.renewal_self_grades_list('pending')")).ok);
const row = (await list(PLAIN))[0];
check("each row carries who, the subjects, the images, whether the school has uploaded and whether the school's grading system can judge the grades", row.lines.length === 3 && row.files.length === 1 && row.school_submitted === false && row.grading_ready === true && row.scholar_id_number === A);
const counts = (await rows(PLAIN, "select * from public.renewal_self_grades_counts()"))[0];
check("the counts say 1 waiting, and whether the viewer may decide", Number(counts.pending) === 1 && counts.can_decide === true && (await rows(EVALUATOR, "select * from public.renewal_self_grades_counts()"))[0].can_decide === false);
check("returning needs a reason", !(await decide(PLAIN, id2, false, "")).ok);
const returned = await decide(PLAIN, id2, false, "The grade of Subject 2 does not match your screenshot.");
check("the approver returns it with a reason", returned.ok && returned.rows[0].r === "returned", returned.msg);
check("the scholar is told, with the reason; the renewal waits for the school again; the same try cannot be decided twice", (await q("select body from scholar_notifications where scholar_id_number = $1 and kind = 'grades_entry_returned'", [A])).some(n => /does not match your screenshot/.test(n.body))
  && (await evalOf(A)).grades.state === "waiting" && !(await decide(PLAIN, id2, true)).ok);
check("after a return the scholar can enter again (a new try)", (await submit(A, recA, lines("A", "F", "2.5"), F1)).ok && (await q("select max(version)::int v from renewal_self_grade_submissions where record_id = $1", [recA.id]))[0].v === 3);
const id3 = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recA.id]))[0].id;
const approved = await decide(PLAIN, id3, true, "Matches the screenshot.");
check("the approver approves it", approved.ok && approved.rows[0].r === "approved", approved.msg);
const evA = await evalOf(A);
check("the scholar now counts as having complete grades: the renewal check uses the entered grades, says they are the scholar's own, and judges them with the school's grading system (A passes, F fails, 2.5 is not a letter or a number on the school's list)",
  evA.grades.self_reported === true && evA.grades.school_submitted === false && evA.grades.state !== "waiting" && evA.grades.counts.total === 3 && evA.grades.counts.failed === 1, JSON.stringify(evA.grades.counts) + evA.grades.state);
check("the scholar is told it was approved; the renewal is no longer 'waiting for grades'", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'grades_entry_approved'", [A]))[0].n === 1 && (await recOf(A)).stage !== "waiting_grades");
check("an approved try cannot be entered again", !(await submit(A, recA, L2, F1)).ok && /were approved/.test((await submit(A, recA, L2, F1)).msg));
check("the application's history records the entry, the return and the approval", (await q("select count(*)::int n from renewal_history where record_id = $1 and (note like 'The scholar entered grades%' or note like 'Entered grades%')", [recA.id]))[0].n >= 4);

console.log("\nA school whose grading system is not set up");
const evB0 = await evalOf(B);
await q("update school_grading_configs set passing_mark = null where school_id = $1", [LETTERS]);
check("without a passing mark the school's own marks cannot be judged", true);
await submit(B, recB, lines("A", "B"), files(B, recB));
const idB = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [recB.id]))[0].id;
const needsSetup = await decide(PLAIN, idB, true, "");
check("approving still works but says the school's grading system must be set up first, and the grades wait for review", needsSetup.ok && needsSetup.rows[0].r === "approved_needs_setup" && (await evalOf(B)).grades.state === "review", needsSetup.ok ? needsSetup.rows[0].r : needsSetup.msg);

console.log("\nSetting up the grading system (Scholars' Grades Monitoring staff)");
check("only Scholars' Grades Monitoring staff may see or change it (SEAD staff has the tag; the approver, the evaluator and scholars do not)", (await attempt(SEAD, "select * from public.grading_setup_schools()")).ok
  && !(await attempt(PLAIN, "select * from public.grading_setup_schools()")).ok && !(await attempt(EVALUATOR, "select * from public.grading_setup_schools()")).ok && !(await attempt(uidOf(A), "select * from public.grading_setup_schools()")).ok
  && !(await attempt(PLAIN, "select public.grading_setup_get($1) g", [LETTERS])).ok);
const schoolsList = await rows(SEAD, "select * from public.grading_setup_schools()");
check("the list shows every school with whether it has a setup, its passing mark and whether it was set by staff", schoolsList.length >= 4 && schoolsList.find(s => s.school_id === LETTERS).has_setup === true && schoolsList.find(s => s.school_id === LETTERS).passing_mark === null);
const cfg = (min, max, pass, dir = "higher_is_better", letters = true) => JSON.stringify({ scale_min: min, scale_max: max, passing_mark: pass, direction: dir, uses_letter_grades: letters });
const save = (school, c, l, m, note = "") => attempt(SEAD, "select public.grading_setup_save($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)", [school, c, l, m, note]);
const LET = JSON.stringify([{ letter: "A", numeric_value: 4 }, { letter: "B", numeric_value: 3 }, { letter: "C", numeric_value: 2 }, { letter: "D", numeric_value: 1 }, { letter: "F", numeric_value: 0 }]);
const MARKS = JSON.stringify([{ mark: "W", meaning: "Withdrawn", outcome: "review" }, { mark: "NG", meaning: "No grade", outcome: "incomplete" }]);
check("a setup that does not make sense is refused (lowest not below highest, passing mark off the scale, repeated letter, a number or INC as a mark, an unknown outcome)", !(await save(LETTERS, cfg(4, 0, 1), LET, "[]")).ok && !(await save(LETTERS, cfg(0, 4, 9), LET, "[]")).ok
  && !(await save(LETTERS, cfg(0, 4, 1), JSON.stringify([{ letter: "A", numeric_value: 4 }, { letter: "a", numeric_value: 3 }]), "[]")).ok && !(await save(LETTERS, cfg(0, 4, 1), LET, JSON.stringify([{ mark: "5", meaning: "x", outcome: "passed" }]))).ok
  && !(await save(LETTERS, cfg(0, 4, 1), LET, JSON.stringify([{ mark: "INC", meaning: "x", outcome: "passed" }]))).ok && !(await save(LETTERS, cfg(0, 4, 1), LET, JSON.stringify([{ mark: "Z", meaning: "x", outcome: "maybe" }]))).ok
  && !(await save("99999999-9999-9999-9999-999999999999", cfg(0, 4, 1), LET, "[]")).ok);
const saved = await save(LETTERS, cfg(0, 4, 1), LET, MARKS, "Temporary: taken from the school's grading sheet.");
check("a good setup is saved", saved.ok, saved.msg);
const got = (await rows(SEAD, "select public.grading_setup_get($1) g", [LETTERS]))[0].g;
check("it is marked 'set by staff, temporary', with the note; the letters and the marks are replaced by the new lists", got.config.set_by_staff === true && got.config.passing_mark === 1 && /Temporary/.test(got.config.staff_note) && got.letters.length === 5 && got.marks.length === 2);
check("the grades that waited for a passing mark are judged now (the application is checked again)", (await evalOf(B)).grades.state !== "review", JSON.stringify((await evalOf(B)).grades));
check("the school saving its own setup removes the 'temporary' mark", await (async () => {
  const schoolAcct = (await q("select id from school_accounts where school_id = $1", [LETTERS]))[0]?.id;
  if (!schoolAcct) return true;
  await as(schoolAcct, async tx => { await tx.query("update school_grading_configs set passing_mark = 1.5 where school_id = $1", [LETTERS]); });
  return (await q("select set_by_staff from school_grading_configs where school_id = $1", [LETTERS]))[0].set_by_staff === false;
})());

console.log("\nWhen the school uploads its grades");
await q("update school_grading_configs set passing_mark = 1 where school_id = $1", [LETTERS]);
// scholar A entered A / F / 2.5 (approved); scholar B entered A / B (approved, school setup now done); scholar C entered nothing but applied
const rowsOf = async (s, ...g) => { for (const [i, [code, subject, grade]] of g.entries()) await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, recorded_by_school_id) values ($1, $2, $3, $4, $5, $6, $7)", [s, basis.basis_school_year, basis.basis_term, subject, code, grade, LETTERS]); };
await rowsOf(A, ["SUBJ1", "Subject 1", "A"], ["SUBJ2", "Subject 2", "D"], ["SUBJ4", "Subject 4", "B"]);     // SUBJ2 differs (F vs D), SUBJ3 missing in the school's, SUBJ4 missing in the entered
await rowsOf(B, ["SUBJ1", "Subject 1", "A"], ["SUBJ2", "Subject 2", "B"]);                                  // the same as entered
await rowsOf(C, ["SUBJ1", "Subject 1", "C"]);
await q("delete from notifications where type = 'renewal'");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_renewal_evaluator') on conflict do nothing", [EVALUATOR]);
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now())", [LETTERS, PERIOD]);
const subA = (await q("select * from renewal_self_grade_submissions where record_id = $1 and status = 'approved'", [recA.id]))[0];
const subB = (await q("select * from renewal_self_grade_submissions where record_id = $1 and status = 'approved'", [recB.id]))[0];
check("the school's grades were compared with the entered ones: subject differences are listed (different grade, missing in the school's, missing in the entered)", subA.official_checked_at && Array.isArray(subA.differences)
  && subA.differences.some(d => d.code === "SUBJ2" && d.kind === "different" && d.entered === "F" && d.school === "D") && subA.differences.some(d => d.code === "SUBJ3" && d.kind === "missing_in_school")
  && subA.differences.some(d => d.code === "SUBJ4" && d.kind === "missing_in_entered"), JSON.stringify(subA.differences));
check("a scholar whose grades all match gets an empty list of differences", subB.official_checked_at && subB.differences.length === 0, JSON.stringify(subB.differences));
check("the school's grades are the ones that count now (not the entered ones), for both", await (async () => {
  const a = await evalOf(A), b = await evalOf(B);
  return a.grades.school_submitted === true && a.grades.self_reported === false && a.grades.counts.total === 3 && b.grades.school_submitted === true && b.grades.self_reported === false && b.grades.counts.total === 2;
})());
const notes = async (s) => (await q("select body from scholar_notifications where scholar_id_number = $1 and kind = 'grades_school_uploaded'", [s])).map(r => r.body);
check("the scholars are told the school uploaded: the one with differences is told how many differ, the matching one that they match, the one who entered nothing that the grades are being checked",
  (await notes(A)).some(b => /3 subjects differ/.test(b)) && (await notes(B)).some(b => /They match/.test(b)) && (await notes(C)).some(b => /We are checking them/.test(b)), JSON.stringify([await notes(A), await notes(B), await notes(C)]));
const diffBell = await q("select user_id from notifications where type = 'renewal' and title = 'Entered grades differ from the school''s grades'");
const evaluatorsN = (await q("select count(distinct staff_id)::int n from staff_account_tags where tag_key = 'scholar_renewal_evaluator'"))[0].n;
check("the Grades Approver and every evaluator are alerted to the differences, once, and only for the scholar whose grades differ", diffBell.some(b => b.user_id === PLAIN) && diffBell.some(b => b.user_id === EVALUATOR) && diffBell.length === evaluatorsN + 1, JSON.stringify(diffBell));
check("the list shows the differences and that the school has uploaded", (await rows(PLAIN, "select * from public.renewal_self_grades_list('approved')")).find(r => r.scholar_id_number === A).school_submitted === true
  && Number((await rows(PLAIN, "select * from public.renewal_self_grades_counts()"))[0].differing) === 1);
check("once the school has uploaded, nobody can enter grades any more", (await rows(uidOf(C), "select public.renewal_my_self_grades($1) m", [recC.id]))[0].m.cannot_enter_reason?.includes("already uploaded"));

console.log("\nRunning again, the undo and putting it back");
for (const f of FILES) await db.exec(read(f));
check("running the files again keeps every try and decision", (await q("select count(*)::int n from renewal_self_grade_submissions"))[0].n >= 4);
check("deleting an application takes its entered grades with it (clearing test data stays clean)", await (async () => {
  const n0 = (await q("select count(*)::int n from renewal_self_grade_lines"))[0].n;
  await q("delete from renewal_records where id = $1", [recC.id]);
  return (await q("select count(*)::int n from renewal_self_grade_lines"))[0].n === n0;
})());
for (const f of UNDOS) await db.exec(read(f));
check("after the undo the tables, the functions and the new columns are gone, and the renewal check is the old one", (await q("select to_regclass('public.renewal_self_grade_submissions') t"))[0].t === null
  && (await q("select count(*)::int n from pg_proc where proname in ('renewal_self_grades_submit', 'renewal_self_grades_decide', 'grading_setup_save', 'can_approve_scholar_grades')"))[0].n === 0
  && (await q("select count(*)::int n from information_schema.columns where table_name = 'school_grading_configs' and column_name = 'set_by_staff'"))[0].n === 0
  && !("self_reported" in (await evalOf(B)).grades));
for (const f of FILES) await db.exec(read(f));
check("it can be put back after the undo", (await q("select to_regclass('public.renewal_self_grade_submissions') t"))[0].t !== null);
const text = FILES.map(f => read(f).replace(/--.*$/gm, "")).join("\n");
check("file A changes no table; file B changes only the grading setup table; nothing is deleted from existing tables", !/alter table public\.(?!renewal_self_grade_)/i.test(read(FILES[0]).replace(/--.*$/gm, "")) && !/alter table public\.(?!school_grading_configs)/i.test(read(FILES[1]).replace(/--.*$/gm, ""))
  && !/\b(truncate|drop table)\b/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
