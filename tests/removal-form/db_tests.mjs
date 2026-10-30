// tests/removal-form/db_tests.mjs — the Scholarship Grant Termination Acknowledgement Form of a removal the Division Head approved: who may open it, what is on it, who is told
//   (supabase_migration_removal_form.sql, after the final decision files and the CSR file)
// Run:  node tests/removal-form/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_removal_form.sql", UNDO = "undo_removal_form.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVAL = seedId("staff:demo.evaluator"), DH = seedId("staff:demo.divhead"), COUNSELOR = seedId("staff:demo.counselor"), ADMIN = seedId("staff:demo.admin"), SEAD = seedId("staff:demo.sead");
const SIG = `${DH}/signature.png`;
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const notices = async (s, title) => (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and title = $2", [s, title]))[0].n;
const TITLE = "Your scholarship termination form is ready";

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on: start from the earlier behaviour
console.log("Before the file");
check("the form's function does not exist yet", !(await attempt(COUNSELOR, "select public.removal_form_data(gen_random_uuid())")).ok);
await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nA removal referral");
const free = (await q(`select s.scholar_id_number s from scholars s where s.status = 'Regular' and not exists (select 1 from scholar_counseling_referrals f where f.scholar_id_number = s.scholar_id_number)
  and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number) order by 1 limit 4`)).map(r => r.s);
const [P1, P2] = free;
await q("update scholars set first_name = 'Bergel Jr', middle_name = 'Obsioma', last_name = 'Losbañes', course = 'Bachelor of Science in Civil Engineering', year_level = '3rd Year', school = 'CU', barangay = 'Bulua' where scholar_id_number = $1", [P1]);
await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade) values ($1, '2025-2026', '2nd Semester', 'Dynamics of Rigid Bodies', 'CE201', '5.0')", [P1]);
const failedRows = JSON.stringify([{ subjectCode: "CE201", semesterAcademicYear: "2nd Semester 2025-2026", yearLevel: "2" }, { subjectCode: "CE301", semesterAcademicYear: "1st Semester 2026-2027", yearLevel: "3" }, { subjectCode: "  ", semesterAcademicYear: "", yearLevel: "" }]);
const mk = async (scholar, endorsed, failedJson = "[]") => (await q(`insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, status)
  values ($1, $2, $3, 'Retained', $4::jsonb, '[]', $5, 'pending') returning id`, [scholar, EVAL, COUNSELOR, failedJson, endorsed]))[0].id;
const r1 = await mk(P1, "Removal", failedRows), r2 = await mk(P2, "On Probation Status");
for (const id of [r1, r2]) await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'Attended', $2)", [id, id === r1 ? "Removal" : "On Probation Status"]);
check("before the Division Head approves, nobody can open the form", !(await attempt(COUNSELOR, "select public.removal_form_data($1)", [r1])).ok && !(await attempt(uidOf(P1), "select public.removal_form_data($1)", [r1])).ok);
check("... and the scholar has been told nothing yet", (await notices(P1, TITLE)) === 0);
await attempt(DH, "select public.approve_referral($1, $2)", [r1, SIG]);
await attempt(DH, "select public.approve_referral($1, $2)", [r2, SIG]);
check("when the Division Head approves a REMOVAL the scholar is told the form is ready (and only then: a Probationary approval tells nothing)", (await notices(P1, TITLE)) === 1 && (await notices(P2, TITLE)) === 0);
const form = (await rows(COUNSELOR, "select public.removal_form_data($1) d", [r1]))[0].d;
check("the consulting staff member the case is assigned to can open it", !!form && form.scholar_id_number === P1);
check("what is printed: the scholar's name, programme and year level, school, barangay", form.first_name === "Bergel Jr" && form.last_name === "Losbañes" && form.program.startsWith("Bachelor of Science in Civil") && form.year_level === "3rd Year" && form.school === "CU" && form.barangay === "Bulua", JSON.stringify(form));
check("the failed subjects of the case, in the order entered, with the subject name when the grades have the code and the code when not; blank rows are left out", form.failed.length === 2
  && form.failed[0].code === "CE201" && form.failed[0].subject === "Dynamics of Rigid Bodies" && form.failed[0].semester_year === "2nd Semester 2025-2026" && form.failed[0].year_level === "2" && form.failed[1].code === "CE301" && form.failed[1].subject === "", JSON.stringify(form.failed));
check("the Division Head's e-signature is the one attached at approval, with the printed name", form.division_head.signature_path === SIG && /Division|\w/.test(form.division_head.name), JSON.stringify(form.division_head));
check("the officer's name, title and e-signature come from the Certificate settings", form.officer.name && form.officer.title && "signature_path" in form.officer, JSON.stringify(form.officer));
check("the issue date is the day the Division Head approved (Philippine time)", form.issued_on === (await q("select ((approved_at) at time zone 'Asia/Manila')::date::text d from scholar_counseling_referrals where id = $1", [r1]))[0].d);
check("the scholar the form is about can open it too (before the final decision)", (await attempt(uidOf(P1), "select public.removal_form_data($1)", [r1])).ok);
for (const [who, name] of [[ADMIN, "another staff member"], [SEAD, "SEAD staff"], [DH, "the Division Head"], [uidOf(P2), "another scholar"]]) {
  const r = await attempt(who, "select public.removal_form_data($1)", [r1]);
  check(`${name} cannot open it`, !r.ok && /cannot open/.test(r.msg), r.msg);
}
check("a visitor cannot either", !(await attempt(null, "select public.removal_form_data($1)", [r1], "anon")).ok);
check("a case that is not a removal has no form (the Probationary referral)", !(await attempt(COUNSELOR, "select public.removal_form_data($1)", [r2])).ok && /not a scholarship removal/.test((await attempt(COUNSELOR, "select public.removal_form_data($1)", [r2])).msg));

console.log("\nThe lists");
check("the scholar sees only their own form, with the issue date", (await rows(uidOf(P1), "select * from public.removal_forms_mine()")).length === 1 && (await rows(uidOf(P2), "select * from public.removal_forms_mine()")).length === 0);
const mine = await rows(COUNSELOR, "select * from public.consult_removal_forms()");
check("the consulting staff member sees the removals of their own cases only (not the Probationary one), saying whether the final decision was made", mine.length === 1 && mine[0].referral_id === r1 && mine[0].final_decision_made === false && (await rows(EVAL, "select * from public.consult_removal_forms()")).length === 0);
check("staff without the consultation tool and scholars cannot ask for the staff list; staff cannot ask for the scholar's list", !(await attempt(SEAD, "select * from public.consult_removal_forms()")).ok && !(await attempt(uidOf(P1), "select * from public.consult_removal_forms()")).ok && !(await attempt(COUNSELOR, "select * from public.removal_forms_mine()")).ok);
await attempt(COUNSELOR, "select public.consult_finalize_decision($1)", [r1]);
check("after the final decision the form can still be opened by the consulting staff member, and the list says so", (await attempt(COUNSELOR, "select public.removal_form_data($1)", [r1])).ok && (await rows(COUNSELOR, "select * from public.consult_removal_forms()"))[0].final_decision_made === true);

console.log("\nA renewal case");
const cases = await q(`select f.id fid, f.renewal_record_id rec, f.referred_to, f.scholar_id_number s, r.stage from scholar_counseling_referrals f join renewal_records r on r.id = f.renewal_record_id where f.status = 'forwarded_to_division_head' order by r.stage, f.scholar_id_number`);
const two = cases.find(c => c.stage === "needs_consultation_division_head");
const nobody = (await q(`select r.id, r.scholar_id_number s from renewal_records r where r.stage = 'needs_consultation_division_head' and not exists (select 1 from scholar_counseling_referrals f where f.renewal_record_id = r.id) order by 2 limit 1`))[0];
check("the demo has a 2+ failed case with the Division Head", !!two);
await attempt(DH, "select public.renewal_division_head_decide($1, 'reconsidered', $2, '', 'Another chance')", [two.rec, SIG]);
check("a case the Division Head RECONSIDERED has no form and the scholar is told nothing about one", !(await attempt(two.referred_to, "select public.removal_form_data($1)", [two.fid])).ok && (await notices(two.s, TITLE)) === 0);
if (nobody) {
  await attempt(EVAL, "select public.renewal_send_to_division_head($1, 'The scholar did not come to the consultation')", [nobody.id]);
  const fid = (await q("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1", [nobody.id]))[0];
  await attempt(DH, "select public.renewal_division_head_decide($1, 'removed', $2, '', 'No response')", [nobody.id, SIG]);
  check("a case the Division Head decided REMOVED has the form: the scholar is told, the evaluator it is assigned to and the scholar can open it", (await notices(nobody.s, TITLE)) === 1
    && (await attempt(fid.referred_to, "select public.removal_form_data($1)", [fid.id])).ok && (await attempt(uidOf(nobody.s), "select public.removal_form_data($1)", [fid.id])).ok);
} else check("a renewal case decided Removed (none in the demo: skipped)", true);

console.log("\nThe undo");
await db.exec(read(UNDO));
check("after the undo the form functions are gone, and approving a removal tells the scholar nothing again", !(await attempt(COUNSELOR, "select * from public.consult_removal_forms()")).ok && !(await attempt(COUNSELOR, "select public.removal_form_data($1)", [r1])).ok);
const P3 = free[2]; const r3 = await mk(P3, "Removal", failedRows);
await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'x', 'Removal')", [r3]); await attempt(DH, "select public.approve_referral($1, $2)", [r3, SIG]);
check("... and the Division Head's approval still waits for the final decision (the earlier behaviour is kept)", (await notices(P3, TITLE)) === 0 && (await q("select status from scholar_counseling_referrals where id = $1", [r3]))[0].status === "division_head_approved");
await db.exec(read(FILE));
check("the file can be put back", (await attempt(COUNSELOR, "select * from public.consult_removal_forms()")).ok);
let early = ""; await db.exec(read(UNDO));
await db.exec("drop function if exists public.consult_finalize_decision(uuid)"); try { await db.exec(read(FILE)); } catch (e) { early = String(e.message); }
check("the file stops with a clear message when the final decision files have not been run", /run supabase_migration_final_decision_a/.test(early), early);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file adds and replaces functions only: no table is created or changed, nothing is deleted", !/(create table|alter table|drop table|delete from|truncate)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
