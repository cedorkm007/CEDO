// tests/academic-status-screen/db_tests.mjs — Grades and Academic Management, PHASE 1B: the school screen (5 checks, short on purpose)
// Run:  node tests/academic-status-screen/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_status_screen.sql", UNDO = "undo_academic_status_screen.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const dropHist = () => db.exec("drop function if exists public.academic_status_history_scholar(text); drop function if exists public.academic_status_history_school(uuid, integer, integer);");   // the later upload update changed their return type
await dropHist(); await db.exec(read(NEW)); await dropHist(); await db.exec(read(NEW));      // twice: safe
const MANAGER = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_management') on conflict do nothing", [MANAGER]);
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const OTHER = (await q("select id from schools where name like '%Higher-Is-Better%'"))[0].id;
const ids = (await q("select scholar_id_number s from scholars where school_id = $1 and status <> 'Removed' order by 1 limit 12", [LOWER])).map(r => r.s);
await q("update scholars set course = 'BS Alpha', year_level = '1st Year' where scholar_id_number = any($1)", [ids.slice(0, 5)]);
await q("update scholars set course = 'BS Beta', year_level = '2nd Year' where scholar_id_number = any($1)", [ids.slice(5, 12)]);
await q("delete from scholar_academic_status"); await q("delete from academic_status_history");
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
const total = Number((await q("select count(*)::int n from scholars where school_id = $1 and status <> 'Removed'", [LOWER]))[0].n);
const page = async (filter, sort = "name", dir = "asc", limit = 50, offset = 0) => attempt(MANAGER, "select * from public.academic_school_scholars($1, $2::jsonb, $3, $4, $5, $6)", [LOWER, JSON.stringify(filter), sort, dir, limit, offset]);

// 1. only the Scholar Management staff; a page carries the true total; search (name or Scholar ID, in any order), sorting and combinable filters work on the whole school, not just the page
const denied = await attempt(PLAIN, "select * from public.academic_school_scholars($1, '{}'::jsonb)", [LOWER]);
const p1 = await page({}, "name", "asc", 10, 0), p2 = await page({}, "name", "asc", 10, 10), desc = await page({}, "id", "desc", 3, 0);
const byProg = await page({ programs: ["bs alpha"], years: ["1st Year"] }), srch = await page({ search: ids[2].toLowerCase() });
const first = (await q("select first_name, last_name from scholars where scholar_id_number = $1", [ids[6]]))[0];
const srch2 = await page({ search: `${first.last_name} ${first.first_name}` });
check("1 only the Scholar Management staff can open the list; each page carries the true total (10 of the whole school); the 2nd page continues; sorting by Scholar ID descending; filters combine (program + year = the 5); search finds a Scholar ID and a name in any order",
  !denied.ok && /Scholar Management/i.test(denied.msg) && p1.ok && p1.rows.length === 10 && Number(p1.rows[0].total) === total && p2.rows[0].scholar_id_number !== p1.rows[0].scholar_id_number
  && desc.rows[0].scholar_id_number > desc.rows[2].scholar_id_number && byProg.rows.length === 5 && Number(byProg.rows[0].total) === 5 && srch.rows.length === 1 && srch2.rows.some(r => r.scholar_id_number === ids[6]), `${p1.msg} ${total} ${byProg.rows?.length} ${srch.rows?.length}`);

// 2. the impact before the change; the check refuses a bad status / a custom GWA outside the school's scale
const imp = await attempt(MANAGER, "select public.academic_status_impact($1, $2::jsonb, null, 'non_academic') r", [LOWER, JSON.stringify({ programs: ["bs alpha"] })]);
const bad1 = await attempt(MANAGER, "select public.academic_status_impact($1, '{}'::jsonb, null, 'maybe') r", [LOWER]);
const bad2 = await attempt(MANAGER, "select public.academic_status_impact($1, '{}'::jsonb, $2, 'academic', 9.5) r", [LOWER, ids.slice(0, 2)]);
const r = imp.ok ? imp.rows[0].r : {};
check("2 the impact says what a change would do before anything is saved (5 scholars would change, all from Not set; the GWA rule is on); a bad status or a custom passing GWA outside the school's scale is refused in plain words; nothing was saved",
  imp.ok && r.total === 5 && r.will_change === 5 && r.from_not_set === 5 && r.rule_on === true && !bad1.ok && /Choose Academic/.test(bad1.msg) && !bad2.ok && /between/.test(bad2.msg) && Number((await q("select count(*)::int n from scholar_academic_status"))[0].n) === 0, JSON.stringify({ r, b1: bad1.msg, b2: bad2.msg }));

// 3. "select all N matching": the change is made for ALL that match (not just a page), with a reason; one history row each; the guard refuses when the numbers changed; a second time changes nothing
const stale = await attempt(MANAGER, "select public.academic_status_apply($1, $2::jsonb, null, 'non_academic', null, false, 'x', 4) r", [LOWER, JSON.stringify({ programs: ["bs alpha"] })]);
const ok = await attempt(MANAGER, "select public.academic_status_apply($1, $2::jsonb, null, 'non_academic', null, false, 'Program is non-academic', 5) r", [LOWER, JSON.stringify({ programs: ["bs alpha"] })]);
const again = await attempt(MANAGER, "select public.academic_status_apply($1, $2::jsonb, null, 'non_academic') r", [LOWER, JSON.stringify({ programs: ["bs alpha"] })]);
const hist = await q("select * from academic_status_history where how = 'matching'");
const v = await q("select public._scholar_academic($1) a", [ids[0]]);
check("3 'select all matching' changes ALL that match with the reason (5), the history has one row each (how = matching, with the reason and who); a guard refuses when the number is not the one shown; saving the same again changes nothing; the renewal uses the new status (Non-academic = 3.00)",
  !stale.ok && /numbers changed/.test(stale.msg) && ok.ok && ok.rows[0].r.changed === 5 && hist.length === 5 && hist.every(h => h.reason === "Program is non-academic" && h.old_status === null && h.new_status === "non_academic") && again.rows[0].r.changed === 0
  && /3(\.0+)?/.test(JSON.stringify(v[0])), `${stale.msg} ${ok.msg} ${hist.length} ${JSON.stringify(v)}`);

// 4. chosen scholars only (one or several), the custom passing GWA, Not set; a school's scholars can only be changed through that school; the history of a scholar and of a school; the Information list reader
const one = await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'academic', 2.5, false, null) r", [LOWER, [ids[0]]]);
const wrong = await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'academic') r", [OTHER, [ids[1]]]);
const clr = await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'not_set') r", [LOWER, [ids[2]]]);
const e0 = (await q("select * from public._scholar_academic($1)", [ids[0]]))[0], e2 = (await q("select * from public._scholar_academic($1)", [ids[2]]))[0];
const hs = await attempt(MANAGER, "select * from public.academic_status_history_scholar($1)", [ids[0]]), hsc = await attempt(MANAGER, "select * from public.academic_status_history_school($1, 50, 0)", [LOWER]);
const of = await attempt(PLAIN, "select * from public.academic_status_of_scholars($1)", [[ids[0], ids[2]]]);
check("4 one scholar can get a status and a custom passing GWA (2.50); a scholar of another school is not touched (0 changed); Not set takes the status away (checked as Academic, flagged not set); the scholar's history and the school's history list it; staff accounts can read the status for the Information list",
  one.rows[0].r.changed === 1 && Number(e0.passing_gwa) === 2.5 && e0.special === true && wrong.rows[0].r.total === 0 && clr.rows[0].r.changed === 1 && e2.is_set === false && e2.academic_status === "academic"
  && hs.rows.length >= 2 && hs.rows[0].new_custom_gwa !== undefined && Number(hsc.rows[0].total) >= 7 && of.ok && of.rows.length === 2 && of.rows.find(x => x.scholar_id_number === ids[0]).custom === true, `${one.msg} ${wrong.msg} ${hs.msg} ${hsc.msg} ${of.msg}`);

// 5. the undo removes the functions and keeps the statuses and the history; the migration can be run again
const before = Number((await q("select count(*)::int n from scholar_academic_status"))[0].n), hb = Number((await q("select count(*)::int n from academic_status_history"))[0].n);
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const gone = Number((await q("select count(*)::int n from pg_proc where proname in ('academic_school_scholars', 'academic_status_apply', 'academic_status_impact', 'academic_status_of_scholars')"))[0].n);
await db.exec(read(NEW));
const back = Number((await q("select count(*)::int n from pg_proc where proname in ('academic_school_scholars', 'academic_status_apply', 'academic_status_impact', 'academic_status_of_scholars')"))[0].n);
check("5 the undo removes the screen's functions and keeps every status and the history; the migration can be run again", gone === 0 && back === 4 && before === Number((await q("select count(*)::int n from scholar_academic_status"))[0].n) && hb === Number((await q("select count(*)::int n from academic_status_history"))[0].n));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
