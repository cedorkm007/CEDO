// tests/entered-grades/apply_needs_grades_db_tests.mjs — a scholar cannot apply for renewal without their grades
//   (supabase_migration_entered_grades_e_apply_needs_grades.sql, after _d)
// Run:  node tests/entered-grades/apply_needs_grades_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE_D = "supabase_migration_entered_grades_d_apply_flow.sql", UNDO_D = "undo_entered_grades_d.sql", FILE = "supabase_migration_entered_grades_e_apply_needs_grades.sql", UNDO = "undo_entered_grades_e.sql";
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

await db.exec(read(UNDO));      // start from the earlier behaviour (file D only), then put this file on, twice: safe
await db.exec(read(FILE_D));
await db.exec(read(FILE));
await db.exec(read(FILE));

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

const plain = s => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);

console.log("A new application needs the grades");
const p1 = await plain(A);
check("the plain application without any grades is refused, and nothing is left behind", !p1.ok && /Enter your grades first/.test(p1.msg) && !(await recOf(A)), p1.msg);
const p6 = await apply6(A, false);
check("the application with the choice (no request, no grades) is refused too", !p6.ok && /Enter your grades first/.test(p6.msg) && !(await recOf(A)), p6.msg);
const p6r = await apply6(A, true);
check("asking for an SDP reconsideration without grades is refused as before", !p6r.ok && /Enter your grades first/.test(p6r.msg) && !(await recOf(A)), p6r.msg);
const p9 = await apply9(A, {});
check("the form with the grades part left empty is refused", !p9.ok && /Enter your grades first/.test(p9.msg) && !(await recOf(A)), p9.msg);
const p9r = await apply9(A, { request: true });
check("the form with the request and no grades is refused", !p9r.ok && /Enter your grades first/.test(p9r.msg) && !(await recOf(A)), p9r.msg);
check("a refused application sends no notice to the scholar", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'application_received'", [A]))[0].n === 0);

console.log("\nWith the grades entered in the form");
const okB = await apply9(B, { lines: lines("A", "B"), files: [file(B, win.id)] });
check("the application goes in together with the entered grades (waiting for the Grades Approver)", okB.ok && (await recOf(B)) && (await status(B)) === "pending", okB.msg);
const okC = await apply9(C, { request: true, lines: lines("A"), files: [file(C, win.id)] });
check("with the request too: the application, the grades and the request are all saved", okC.ok && (await q("select status from sdp_reconsideration_requests where scholar_id_number = $1", [C]))[0]?.status === "pending", okC.msg);
const leak = await plain(D);
check("the grades of one application do not let anyone else apply without grades (the permission lasts only for that one application)", !leak.ok && /Enter your grades first/.test(leak.msg) && !(await recOf(D)), leak.msg);
const badGrades = await apply9(D, { lines: lines("A"), files: [file(D, win.id)], ack: false });
check("grades that fail the usual checks (no tick) do not let the application in either", !badGrades.ok && !(await recOf(D)), badGrades.msg);

console.log("\nWhen the school's grades are in");
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) values ($1, $2, 'submitted', now())", [LOWER, PERIOD]);
const s5 = await plain(L1);
check("a scholar whose school uploaded the grades applies without entering anything", s5.ok && (await recOf(L1)), s5.msg);
const s6 = await apply6(L2, true);
check("and can ask for an SDP reconsideration", s6.ok && (await q("select status from sdp_reconsideration_requests where scholar_id_number = $1", [L2]))[0]?.status === "pending", s6.msg);

console.log("\nOther cases");
await q("update renewal_records set stage = 'returned' where scholar_id_number = $1 and school_year = $2 and term = $3", [B, Y, T]);
const again = await plain(B);
check("a returned application can still be sent again (it already went through the grades check)", again.ok, again.msg);
check("a scholar who applied (with grades) can still enter or correct them from the renewal page", (await attempt(uidOf(B), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [(await recOf(B)).id, lines("A", "C"), JSON.stringify([file(B, (await recOf(B)).id, 1)])])).ok);

console.log("\nThe undo, the order of the files, and putting it back");
await db.exec(read(UNDO));
const back = await plain(E);
check("after the undo a scholar can apply without grades again (as in file D)", back.ok && (await recOf(E)), back.msg);
await db.exec(read(UNDO_D));
await db.exec(read(UNDO));
let early = "";
try { await db.exec(read(FILE)); } catch (e) { early = String(e.message); }
check("this file stops with a clear message when file D has not been run", /run supabase_migration_entered_grades_d_apply_flow.sql first/.test(early), early);
await db.exec(read(FILE_D));
await db.exec(read(FILE));
check("it can be put back", !(await plain(F)).ok);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file replaces functions only: no table is created or changed, nothing is deleted", !/(create table|alter table|drop table|delete from|truncate)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
