// tests/school-update/non_numeric_marks_db_tests.mjs — School Portal: a school's own non-numeric marks (F, D/F...), supabase_migration_school_non_numeric_marks.sql
//   saving and checking the list, who can read it, what the database accepts as a grade, what each mark means for renewal, the undo.
// Run:  node tests/school-update/non_numeric_marks_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_school_non_numeric_marks.sql", UNDO = "undo_school_non_numeric_marks.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const lower = (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like '%Lower-Is-Better%'"))[0];
const higher = (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like '%Higher-Is-Better%'"))[0];
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), EVALUATOR = seedId("staff:demo.evaluator");
const scholarUid = n => seedId(`scholar:${n}`);
const MARKS = [
  { mark: "F", meaning: "Failed", outcome: "failed" }, { mark: "D/F", meaning: "Dropped, failed", outcome: "failed" },
  { mark: "P", meaning: "Passed (no number)", outcome: "passed" }, { mark: "IP", meaning: "In progress", outcome: "incomplete" }, { mark: "NG", meaning: "No grade", outcome: "review" },
];
const save = (uid, marks) => attempt(uid, "select public.set_school_marks($1::jsonb)", [JSON.stringify(marks)]);
const outcomeOf = async (schoolId, grade) => (await q("select public._grade_outcome($1, $2) o", [schoolId, grade]))[0].o;
const errorOf = async (schoolId, grade) => (await q("select public._school_grade_error($1, $2) e", [schoolId, grade]))[0].e;

console.log("\nBefore any marks are added");
check("a grade like F is refused for a school that has not added it, and the message mentions the list of other marks", /not on your grading scale/.test(await errorOf(lower.school_id, "F")) && /other marks/.test(await errorOf(lower.school_id, "F")));
check("INC and DRP are accepted for every school, as before", (await errorOf(lower.school_id, "INC")) === null && (await errorOf(lower.school_id, "drp")) === null);

console.log("\nA school saves its own marks");
const saved = await save(lower.uid, MARKS);
check("the school saves its list", saved.ok, saved.msg);
const stored = await q("select mark, meaning, outcome from school_marks where school_id = $1 order by mark", [lower.school_id]);
check("all five marks are stored with what they stand for and what they mean", stored.length === 5 && stored.find(m => m.mark === "D/F")?.meaning === "Dropped, failed" && stored.find(m => m.mark === "IP")?.outcome === "incomplete");
check("saving again replaces the whole list (not added on top)", (await save(lower.uid, [MARKS[0]])).ok && (await q("select count(*) n from school_marks where school_id = $1", [lower.school_id]))[0].n == 1);
await save(lower.uid, MARKS);

console.log("\nThe list is checked");
const bad = async (marks, pattern) => { const r = await save(lower.uid, marks); return !r.ok && pattern.test(r.msg); };
check("a number is refused", await bad([{ mark: "3.5", meaning: "x", outcome: "failed" }], /is a number/));
check("INC and DRP cannot be redefined (any capitals)", await bad([{ mark: "inc", meaning: "x", outcome: "passed" }], /built in/) && await bad([{ mark: "DRP", meaning: "x", outcome: "passed" }], /built in/));
check("a mark with no meaning is refused", await bad([{ mark: "Z", meaning: " ", outcome: "failed" }], /stands for/));
check("an outcome that is not one of the four is refused", await bad([{ mark: "Z", meaning: "x", outcome: "maybe" }], /means for renewal/));
check("the same mark twice (any capitals) is refused", await bad([{ mark: "F", meaning: "a", outcome: "failed" }, { mark: "f", meaning: "b", outcome: "failed" }], /twice/));
check("a mark longer than 12 characters is refused", await bad([{ mark: "ABCDEFGHIJKLM", meaning: "x", outcome: "failed" }], /too long/));
check("a refused save changes nothing", (await q("select count(*) n from school_marks where school_id = $1", [lower.school_id]))[0].n == 5);
check("only a school account can save (a scholar, staff and a visitor cannot)", !(await save(scholarUid(1), MARKS)).ok && !(await save(SEAD, MARKS)).ok && !(await save(null, MARKS)).ok);

console.log("\nWho can read the list");
const count = async (uid) => { const r = await attempt(uid, "select count(*) n from school_marks"); return r.ok ? Number(r.rows[0].n) : -1; };
check("the school reads its own marks; another school reads none of them", (await count(lower.uid)) === 5 && (await count(higher.uid)) === 0);
check("another school cannot add marks for this school", !(await attempt(higher.uid, "insert into school_marks (school_id, mark, meaning, outcome) values ($1, 'X', 'x', 'failed')", [lower.school_id])).ok);
check("Grades Monitoring / SEAD staff and the renewal evaluator read them; a staff member with no tools does not", (await count(SEAD)) === 5 && (await count(EVALUATOR)) === 5 && (await count(PLAIN)) === 0);
check("a visitor who is not signed in reads nothing", (await count(null)) <= 0);
const scholar3 = scholarUid(3);   // a scholar of the lower school
check("a scholar reads the marks of their own school through the scholar function", (await rows(scholar3, "select * from public.get_scholar_school_marks()")).length === 5);
check("a scholar of another school does not get them", (await rows(scholarUid(14), "select * from public.get_scholar_school_marks()")).length === 0);
check("CEDO staff read one scholar's school marks through the staff function; no-tool staff and scholars get none", (await rows(SEAD, "select * from public.get_scholar_school_marks_for_staff('TEST-0003')")).length === 5
  && (await rows(PLAIN, "select * from public.get_scholar_school_marks_for_staff('TEST-0003')")).length === 0 && (await rows(scholar3, "select * from public.get_scholar_school_marks_for_staff('TEST-0003')")).length === 0);

console.log("\nWhat the database accepts and what each mark means");
check("every mark in the list is accepted as a grade (any capitals); one not in the list is still refused", (await errorOf(lower.school_id, "F")) === null && (await errorOf(lower.school_id, "d/f")) === null && (await errorOf(lower.school_id, "Q")) !== null);
check("F and D/F count as failed; P as passed; IP as incomplete (like INC); NG as needs review", (await outcomeOf(lower.school_id, "F")) === "failed" && (await outcomeOf(lower.school_id, "D/F")) === "failed" && (await outcomeOf(lower.school_id, "P")) === "passed" && (await outcomeOf(lower.school_id, "IP")) === "inc" && (await outcomeOf(lower.school_id, "NG")) === "review");
check("INC and DRP keep their built-in meaning", (await outcomeOf(lower.school_id, "INC")) === "inc" && (await outcomeOf(lower.school_id, "DRP")) === "drp");
check("numbers are still judged by the passing mark; an unknown mark still needs review", (await outcomeOf(lower.school_id, "2.5")) === "passed" && (await outcomeOf(lower.school_id, "4")) === "failed" && (await outcomeOf(lower.school_id, "W")) === "review");
check("the other school is not affected (F is still not accepted there)", (await errorOf(higher.school_id, "F")) !== null && (await outcomeOf(higher.school_id, "F")) === "review");

console.log("\nIn the renewal check");
const probe = (await q("select scholar_id_number, school_year, semester, subject_code from scholar_subjects_grades where scholar_id_number = 'TEST-0002' order by subject_code limit 1"))[0];
// The renewal for a term looks at the semester just finished: 2nd Semester <- the same year's 1st; 1st Semester <- the previous year's 2nd.
const nextYear = y => { const [a, b] = y.split("-").map(Number); return `${a + 1}-${b + 1}`; };
const evaluate = async () => (await q("select public._renewal_evaluate('TEST-0002', $1, $2) r", probe.semester === "1st Semester" ? [probe.school_year, "2nd Semester"] : [nextYear(probe.school_year), "1st Semester"]))[0].r.grades;
const before = await evaluate();
await q("update scholar_subjects_grades set grade = 'F' where scholar_id_number = 'TEST-0002' and subject_code = $1", [probe.subject_code]);
const withF = await evaluate();
check("a scholar who was passing now has one failed subject once one grade is F", Number(before.counts.failed) === 0 && Number(withF.counts.failed) === 1 && withF.failed_subjects.some(s => s.grade === "F"), JSON.stringify([before.counts, withF.counts]));
await q("update scholar_subjects_grades set grade = 'IP' where scholar_id_number = 'TEST-0002' and subject_code = $1", [probe.subject_code]);
const withIp = await evaluate();
check("an IP (incomplete) grade is tracked like INC: not failed, listed with the INC subjects", Number(withIp.counts.failed) === 0 && Number(withIp.counts.inc) === 1 && withIp.inc_subjects.some(s => s.grade === "IP"), JSON.stringify(withIp.counts));
await q("update scholar_subjects_grades set grade = 'NG' where scholar_id_number = 'TEST-0002' and subject_code = $1", [probe.subject_code]);
const withNg = await evaluate();
check("an NG (needs review) grade is sent to the evaluator as needs review", Number(withNg.counts.review) === 1 && withNg.review_subjects.some(s => s.grade === "NG"), JSON.stringify(withNg.counts));

console.log("\nRunning the file again, the undo, and putting it back");
await db.exec(read(FILE));
check("running the file again keeps the marks", (await q("select count(*) n from school_marks"))[0].n >= 5);
await db.exec(read(UNDO));
check("the undo removes the new table and functions", (await q("select to_regclass('public.school_marks') t"))[0].t === null && (await q("select count(*) n from pg_proc where proname in ('set_school_marks', 'get_scholar_school_marks', 'get_scholar_school_marks_for_staff')"))[0].n == 0);
check("after the undo, F is refused again and INC / DRP still work", (await errorOf(lower.school_id, "F")) !== null && (await errorOf(lower.school_id, "INC")) === null && (await outcomeOf(lower.school_id, "INC")) === "inc");
await db.exec(read(FILE));
check("the file can be put back after the undo", (await save(lower.uid, MARKS)).ok && (await outcomeOf(lower.school_id, "F")) === "failed");
const fileText = read(FILE).replace(/delete from public.school_marks/g, "").replace(/alter table public.school_marks/g, "");
check("the file creates one table and functions only: no existing table is changed", !/drop table|alter table|update public.|delete from/i.test(fileText));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
