// tests/program-info-snapshots/db_tests.mjs — Scholarship Program Information by semester and academic year (saved snapshots)
//   (supabase_migration_scholarship_program_snapshots.sql)      Run:  node tests/program-info-snapshots/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_scholarship_program_snapshots.sql", UNDO = "undo_scholarship_program_snapshots.sql";
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

await db.exec(read(FILE)); await db.exec(read(FILE));      // twice is safe
const INFO = seedId("staff:demo.plain"), OTHER = seedId("staff:demo.counselor"), SCHOLAR = seedId("scholar:1"), EVAL = seedId("staff:demo.evaluator");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholarship_program_info') on conflict do nothing", [INFO]);
const Y = "2026-2027", T = "1st Semester";
const total = Number((await q("select count(*) n from scholars"))[0].n);
const take = (uid, y = Y, t = T, replace = false) => attempt(uid, "select public.scholar_snapshot_take($1, $2, $3) n", [y, t, replace]);

console.log("Who can save and read");
check("a staff member without the tag cannot save a semester, and a scholar cannot", !(await take(OTHER)).ok && !(await take(SCHOLAR)).ok && /Not authorized/.test((await take(OTHER)).msg));
check("without the tag the saved tables and the numbers cannot be read", !(await attempt(OTHER, "select * from public.scholarship_status_counts_snapshot($1, $2)", [Y, T])).ok && (await rows(OTHER, "select count(*)::int n from scholar_period_snapshots"))[0].n === 0 && (await rows(OTHER, "select count(*)::int n from scholar_snapshot_runs"))[0].n === 0);
check("a wrong academic year or semester is refused", /must look like 2026-2027/.test((await take(INFO, "2026", T)).msg ?? "") && /Choose 1st Semester/.test((await take(INFO, Y, "Fall")).msg ?? ""));

console.log("\nSaving a semester");
const first = await take(INFO);
check("saving copies every scholar, and says how many", first.ok && Number(first.rows[0].n) === total && (await q("select count(*)::int n from scholar_period_snapshots where school_year = $1 and term = $2", [Y, T]))[0].n === total, first.msg);
const run = (await rows(INFO, "select * from scholar_snapshot_runs"))[0];
check("the run says which semester, when, by whom and how many", run.school_year === Y && run.term === T && Number(run.scholar_count) === total && run.taken_at && run.taken_by === INFO, JSON.stringify(run));
const again = await take(INFO);
check("saving the same semester again is REFUSED, with the date it was saved, unless the person chooses to save again", !again.ok && /was already saved on/.test(again.msg) && /Save again/.test(again.msg), again.msg);
check("a copy holds only what the page shows (no password, grades, documents)", !(await q("select column_name from information_schema.columns where table_name = 'scholar_period_snapshots'")).some(c => /pass|grade|document|email$/.test(c.column_name) && c.column_name !== "contact_email"));

console.log("\nThe saved numbers are the same as the live numbers at the moment of saving");
const sortJson = rs => JSON.stringify(rs.map(r => JSON.stringify(Object.values(r).map(String))).sort());
const same = async (live, snap, params = [], snapParams = [Y, T, ...params]) => {
  const a = await rows(INFO, `select * from public.${live}(${params.map((_, i) => `$${i + 1}`).join(", ")})`, params);
  const b = await rows(INFO, `select * from public.${snap}(${snapParams.map((_, i) => `$${i + 1}`).join(", ")})`, snapParams);
  return sortJson(a) === sortJson(b) && a.length > 0;
};
check("status counts", await same("scholarship_status_counts", "scholarship_status_counts_snapshot"));
check("by barangay", await same("scholars_by_barangay", "scholars_by_barangay_snapshot"));
check("by school", await same("scholars_by_school", "scholars_by_school_snapshot"));
const school = (await q("select school, count(*) n from scholars where school is not null group by school order by n desc limit 1"))[0].school;
const yl = (await q("select year_level, count(*) n from scholars where school = $1 and year_level is not null group by year_level order by n desc limit 1", [school]))[0].year_level;
check("by year level of a school", await same("scholars_by_school_year_level", "scholars_by_school_year_level_snapshot", [school]));
check("by program of a year level of a school", await same("scholars_by_school_year_level_course", "scholars_by_school_year_level_course_snapshot", [school, yl]));
for (const [live, snap] of [["scholars_by_year_level_for_status", "scholars_by_year_level_for_status_snapshot"], ["scholars_by_school_for_status", "scholars_by_school_for_status_snapshot"], ["scholars_by_barangay_for_status", "scholars_by_barangay_for_status_snapshot"], ["scholars_by_course_for_status", "scholars_by_course_for_status_snapshot"]])
  check(`${live}: the same for Regular`, await same(live, snap, ["Regular"]));

console.log("\nA saved semester stays as it was");
const target = (await q("select scholar_id_number s, status, school from scholars where status = 'Regular' limit 1"))[0];
const countsBefore = JSON.stringify((await rows(INFO, "select * from scholarship_status_counts_snapshot($1, $2)", [Y, T]))[0]);
await q("update scholars set status = 'Probationary', school = 'Another School' where scholar_id_number = $1", [target.s]);
const liveNow = (await rows(INFO, "select * from scholarship_status_counts()"))[0];
check("the live numbers change when a scholar changes (as always)", Number(liveNow.probationary_count) === Number(JSON.parse(countsBefore).probationary_count) + 1);
check("…but the saved semester does not", JSON.stringify((await rows(INFO, "select * from scholarship_status_counts_snapshot($1, $2)", [Y, T]))[0]) === countsBefore);
check("the saved copy of that scholar still says what it said", (await q("select status, school from scholar_period_snapshots where scholar_id_number = $1 and school_year = $2 and term = $3", [target.s, Y, T]))[0].status === target.status);
const rep = await take(INFO, Y, T, true);
check("'Save again' replaces the saved semester with the information as it is now (one row per scholar, the date and number updated)", rep.ok && Number(rep.rows[0].n) === total && (await q("select count(*)::int n from scholar_period_snapshots where school_year = $1 and term = $2", [Y, T]))[0].n === total
  && (await q("select status from scholar_period_snapshots where scholar_id_number = $1 and school_year = $2 and term = $3", [target.s, Y, T]))[0].status === "Probationary" && (await q("select count(*)::int n from scholar_snapshot_runs"))[0].n === 1);
const other = await take(INFO, "2026-2027", "2nd Semester");
check("another semester is saved on its own and does not touch the first", other.ok && (await rows(INFO, "select count(*)::int n from scholar_snapshot_runs"))[0].n === 2);
check("the saved list can be read by tagged staff with the same filters the page uses (column names match the page's list)", (await rows(INFO, "select id, scholar_id_number, first_name, last_name, middle_name, year_level, school, status, status_before_removal, barangay, course, birthday, civil_status, contact_no, contact_email, father_first_name, father_middle_initial, father_last_name, mother_first_name, mother_middle_initial, mother_last_name from scholar_period_snapshots where school_year = $1 and term = $2 and status <> 'Removed'", [Y, T])).length > 0);

console.log("\nIs a renewal ongoing?");
await q("update renewal_windows set testers = null");
const ongoing = async () => (await rows(INFO, "select public.renewal_ongoing() v"))[0].v;
const w = (await q("select id from renewal_windows order by opens_on desc limit 1"))[0];
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 10 where id = $1", [w.id]);
check("a window that is open today: yes", await ongoing() === true);
await q("update renewal_windows set testers = $2 where id = $1", [w.id, ["TEST-0001"]]);
await q("update renewal_windows set opens_on = current_date + 20, closes_on = current_date + 30 where id <> $1", [w.id]);
check("a test window (for test accounts) does not count, and windows in the future or past do not either", await ongoing() === false);
await q("update renewal_windows set testers = null where id = $1", [w.id]);
await q("update renewal_windows set opens_on = current_date - 30, closes_on = current_date - 20");
check("no window open: no", await ongoing() === false);
check("it can be asked by a scholar's account only as a yes/no (no details)", (await attempt(SCHOLAR, "select public.renewal_ongoing() v")).ok);

console.log("\nThe file");
check("it creates two tables and functions only: no existing table is changed, nothing is deleted", !/alter table public\.(?!scholar_period_snapshots|scholar_snapshot_runs)/i.test(read(FILE)) && !/delete from public\.(?!scholar_period_snapshots)/i.test(read(FILE)) && !/drop table/i.test(read(FILE)));
await db.exec(read(UNDO));
check("the undo removes the tables and the functions (the live page's functions stay)", !(await q("select 1 from pg_class where relname in ('scholar_period_snapshots', 'scholar_snapshot_runs')")).length && !(await q("select 1 from pg_proc where proname in ('scholarship_status_counts_snapshot','scholars_by_barangay_snapshot','scholars_by_school_snapshot','scholars_by_school_year_level_snapshot','scholars_by_school_year_level_course_snapshot','scholars_by_year_level_for_status_snapshot','scholars_by_school_for_status_snapshot','scholars_by_barangay_for_status_snapshot','scholars_by_course_for_status_snapshot','scholar_snapshot_take','renewal_ongoing')")).length && (await q("select 1 from pg_proc where proname = 'scholarship_status_counts'")).length === 1);
await db.exec(read(FILE));
check("it can be put back after the undo", (await rows(INFO, "select count(*)::int n from scholar_snapshot_runs"))[0].n === 0 && (await take(INFO)).ok);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
