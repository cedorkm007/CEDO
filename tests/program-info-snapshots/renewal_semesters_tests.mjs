// tests/program-info-snapshots/renewal_semesters_tests.mjs — 1st Semester 2026-2027 = before the renewal (saved once); a renewal semester fills in as scholars are renewed.
//   (supabase_migration_scholarship_program_snapshots_b_semesters.sql + ..._c_renewal_sync.sql)      Run:  node tests/program-info-snapshots/renewal_semesters_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const F0 = "supabase_migration_scholarship_program_snapshots.sql", FB = "supabase_migration_scholarship_program_snapshots_b_semesters.sql", FC = "supabase_migration_scholarship_program_snapshots_c_renewal_sync.sql", FD = "supabase_migration_scholarship_program_snapshots_d_status_fix.sql", UNDO = "undo_scholarship_program_snapshots_b_c.sql";
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

await db.exec(read(F0));
const INFO = seedId("staff:demo.plain"), OTHER = seedId("staff:demo.counselor");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholarship_program_info') on conflict do nothing", [INFO]);
const total = Number((await q("select count(*) n from scholars"))[0].n);
const Y = "2026-2027", T1 = "1st Semester", T2 = "2nd Semester";
// the renewal scholars: take the first few real scholars
const sch = await q("select scholar_id_number s, school, course, year_level, status, barangay from scholars order by scholar_id_number limit 6");
const periods = uid => rows(uid, "select * from public.program_info_periods()");

console.log("File B: the copy of 'before the renewal'");
// the demo builds its tables before the scholars are added, so remove the empty copy the build made: in the real database the scholars exist when file B runs
await q("delete from scholar_period_snapshots"); await q("delete from scholar_snapshot_runs");
await db.exec(read(FB)); await db.exec(read(FB));      // twice is safe
const base = (await q("select * from scholar_snapshot_runs where school_year = $1 and term = $2", [Y, T1]));
check("1st Semester 2026-2027 is saved once, with every scholar, as a saved copy", base.length === 1 && base[0].source === "saved" && Number(base[0].scholar_count) === total && Number((await q("select count(*) n from scholar_period_snapshots where school_year = $1 and term = $2", [Y, T1]))[0].n) === total);
const baseStatus = JSON.stringify((await q("select scholar_id_number, status, school, year_level from scholar_period_snapshots where school_year = $1 and term = $2 order by 1", [Y, T1])));
check("running file B again does not replace it", Number((await q("select count(*) n from scholar_snapshot_runs"))[0].n) === 1);
check("only tagged staff can list the semesters", !(await attempt(OTHER, "select * from public.program_info_periods()")).ok && (await periods(INFO)).length >= 1);
check("saving a semester by hand still works for a semester without a renewal window, and refuses one that fills from the renewal", await (async () => {
  await q("insert into renewal_windows (school_year, term, opens_on, closes_on) values ($1, $2, current_date - 2, current_date + 20)", [Y, T2]);
  const refused = await attempt(INFO, "select public.scholar_snapshot_take($1, $2, false)", [Y, T2]);
  const ok = await attempt(INFO, "select public.scholar_snapshot_take($1, 'Summer', false)", [Y]);
  await q("delete from scholar_period_snapshots where term = 'Summer'"); await q("delete from scholar_snapshot_runs where term = 'Summer'");
  return !refused.ok && /fills in by itself/.test(refused.msg) && ok.ok;
})());

console.log("\nFile C: the renewal semester fills in by itself");
await db.exec(read(FC)); await db.exec(read(FC)); await db.exec(read(FD)); await db.exec(read(FD));
const win = (await q("select id from renewal_windows where school_year = $1 and term = $2 and testers is null", [Y, T2]))[0].id;
const list = (await periods(INFO)).map(p => `${p.period_school_year}|${p.period_term}|${p.kind}|${p.scholars}`);
check("the list offers 1st Semester (saved) and 2nd Semester (from the renewal, 0 so far)", list.includes(`${Y}|${T1}|saved|${total}`) && list.includes(`${Y}|${T2}|renewal|0`), JSON.stringify(list));
const add = (s, result, extra = {}) => q(`insert into renewal_records (scholar_id_number, school_year, term, window_id, stage, result, confirmed_school, confirmed_program, confirmed_year_level)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [s.s, Y, T2, extra.window ?? win, result === "removed" ? "removed" : "renewed", result, extra.school ?? "New School", extra.program ?? "New Program", extra.year ?? "3rd Year"]);
await add(sch[0], "renewed"); await add(sch[1], "renewed_probationary"); await add(sch[2], "reconsidered"); await add(sch[3], "removed");
await q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage) values ($1, $2, $3, $4, 'submitted')", [sch[4].s, Y, T2, win]);
const snap = async () => q("select * from scholar_period_snapshots where school_year = $1 and term = $2 order by scholar_id_number", [Y, T2]);
let s2 = await snap();
check("a renewed scholar appears with the school, program and year level confirmed in the renewal, and their status", s2.length === 4 && s2[0].status === "Regular" && s2[0].school === "New School" && s2[0].course === "New Program" && s2[0].year_level === "3rd Year");
check("renewed (probationary) → Probationary, reconsidered → Reconsidered, removed → Removed", s2[1].status === "Probationary" && s2[2].status === "Reconsidered" && s2[3].status === "Removed");
check("a scholar who only applied (no result yet) is not in the semester", !s2.some(r => r.scholar_id_number === sch[4].s));
check("the numbers of the 2nd semester come from the same functions as before", JSON.stringify((await rows(INFO, "select * from scholarship_status_counts_snapshot($1, $2)", [Y, T2]))[0].regular_count) === "1" && Number((await rows(INFO, "select * from scholarship_status_counts_snapshot($1, $2)", [Y, T2]))[0].removed_count) === 1);
check("the list now says 4 scholars in the 2nd semester", (await periods(INFO)).some(p => p.period_term === T2 && Number(p.scholars) === 4));
await q("update renewal_records set result = 'renewed_probationary' where scholar_id_number = $1 and school_year = $2 and term = $3", [sch[4].s, Y, T2]);
check("when the result is confirmed later, the scholar joins", (await snap()).length === 5);
await q("update renewal_records set confirmed_year_level = '4th Year' where scholar_id_number = $1 and term = $2", [sch[0].s, T2]);
check("a change in the renewal changes the row", (await snap()).find(r => r.scholar_id_number === sch[0].s).year_level === "4th Year");
await q("delete from renewal_records where scholar_id_number = $1 and term = $2", [sch[1].s, T2]);
check("a reverted application (deleted) leaves the semester", (await snap()).length === 4 && !(await snap()).some(r => r.scholar_id_number === sch[1].s));
await q("update renewal_records set result = null, stage = 'submitted' where scholar_id_number = $1 and term = $2", [sch[2].s, T2]);
check("a record whose result is taken away leaves the semester", (await snap()).length === 3);

console.log("\nA renewed scholar who is on Probationary");
{
  const extra = await q("select scholar_id_number s from scholars where scholar_id_number not in (select scholar_id_number from renewal_records where term = $1) order by scholar_id_number limit 2", [T2]);
  await q("update scholars set status = 'Probationary' where scholar_id_number = $1", [extra[0].s]);
  await q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage, result) values ($1, $2, $3, $4, 'renewed', 'renewed')", [extra[0].s, Y, T2, win]);
  const st = async id => (await snap()).find(r => r.scholar_id_number === id)?.status;
  check("a scholar confirmed as plain 'renewed' but on Probationary is counted as Probationary, not Regular", await st(extra[0].s) === "Probationary");
  check("the Probationary number of the semester shows them", Number((await rows(INFO, "select * from scholarship_status_counts_snapshot($1, $2)", [Y, T2]))[0].probationary_count) >= 1);
  await q("update scholars set status = 'Regular' where scholar_id_number = $1", [extra[0].s]);
  check("if the probation is lifted later, the semester follows (Regular)", await st(extra[0].s) === "Regular");
  await q("update scholars set status = 'Probationary' where scholar_id_number = $1", [extra[0].s]);
  check("and follows again when the scholar becomes Probationary", await st(extra[0].s) === "Probationary");
  await q("update scholar_period_snapshots set status = 'Regular' where scholar_id_number = $1 and term = $2", [extra[0].s, T2]);     // as file C alone had left it
  await db.exec(read(FD));
  check("running file D corrects the rows already filled", await st(extra[0].s) === "Probationary");
  await q("update scholars set status = 'Probationary' where scholar_id_number = $1", [sch[3].s]);
  check("a removed scholar stays Removed, whatever the scholar's status says", await st(sch[3].s) === "Removed");
  await q("delete from renewal_records where scholar_id_number = $1 and term = $2", [extra[0].s, T2]);
  await q("update scholars set status = 'Regular' where scholar_id_number in ($1, $2)", [extra[0].s, sch[3].s]);
}

console.log("\nWhat is never touched");
check("the saved 'before the renewal' copy did not change", JSON.stringify((await q("select scholar_id_number, status, school, year_level from scholar_period_snapshots where school_year = $1 and term = $2 order by 1", [Y, T1]))) === baseStatus);
await q("update renewal_records set result = 'renewed' where scholar_id_number = $1 and school_year = $2 and term = $3", [(await q("select scholar_id_number s from renewal_records where school_year = $1 and term = $2 limit 1", [Y, T1]))[0]?.s ?? sch[5].s, Y, T1]);
check("a renewal of the saved semester does not change its copy either", JSON.stringify((await q("select scholar_id_number, status, school, year_level from scholar_period_snapshots where school_year = $1 and term = $2 order by 1", [Y, T1]))) === baseStatus);
const testWin = (await q("insert into renewal_windows (school_year, term, opens_on, closes_on, testers) values ($1, 'Summer', current_date, current_date + 5, $2) returning id", [Y, [sch[5].s]]))[0].id;
await q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage, result) values ($1, $2, 'Summer', $3, 'renewed', 'renewed')", [sch[5].s, Y, testWin]);
check("a record of a test window is not counted, and a test-only semester is not offered", Number((await q("select count(*) n from scholar_period_snapshots where school_year = $1 and term = 'Summer'", [Y]))[0].n) === 0 && !(await periods(INFO)).some(p => p.period_school_year === Y && p.period_term === "Summer"));
check("a failure inside the sync never blocks the renewal (it only warns)", /exception when others then\s+raise warning/.test(read(FC)));
const rec = (await q("select count(*) n from renewal_records"))[0].n;
check("changing a scholar's current information afterwards does not change the 2nd semester's school/year level", await (async () => {
  await q("update scholars set school = 'Moved Later' where scholar_id_number = $1", [sch[0].s]);
  return (await snap()).find(r => r.scholar_id_number === sch[0].s).school === "New School";
})(), rec);
check("scholars of a renewal semester cannot be read without the tag", (await rows(OTHER, "select count(*)::int n from scholar_period_snapshots"))[0].n === 0);

console.log("\nBackfill and undo");
await db.exec(read(UNDO));
check("the undo removes the trigger, the list and the rows the renewal filled, but keeps the saved copy", !(await q("select 1 from pg_trigger where tgname = 'program_info_renewal_sync'")).length && !(await q("select 1 from pg_proc where proname = 'program_info_periods'")).length
  && Number((await q("select count(*) n from scholar_period_snapshots where term = $1", [T2]))[0].n) === 0 && Number((await q("select count(*) n from scholar_period_snapshots where school_year = $1 and term = $2", [Y, T1]))[0].n) === total);
await db.exec(read(FB)); await db.exec(read(FC)); await db.exec(read(FD));
check("it can be put back; file C then fills in the scholars already decided", Number((await q("select count(*) n from scholar_period_snapshots where term = $1", [T2]))[0].n) === 3);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
