// tests/academic-template-filter/db_tests.mjs — the template of a school follows the filters of the school screen (3 checks, short on purpose)
// Run:  node tests/academic-template-filter/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_template_filter.sql", UNDO = "undo_academic_template_filter.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const MANAGER = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_management') on conflict do nothing", [MANAGER]);
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
await q("delete from scholar_academic_status");
const ids = (await q("select scholar_id_number s from scholars where school_id = $1 and status <> 'Removed' order by 1 limit 10", [LOWER])).map(r => r.s);
await q("update scholars set course = 'BS Alpha', year_level = '1st Year' where scholar_id_number = any($1)", [ids.slice(0, 4)]);
await q("update scholars set course = 'BS Beta', year_level = '2nd Year' where scholar_id_number = any($1)", [ids.slice(4, 10)]);
await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'non_academic', 3.0, false, null)", [LOWER, ids.slice(0, 2)]).catch(() => null);
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
await attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, 'non_academic')", [LOWER, ids.slice(0, 2)]);
const tpl = (filter, off = 0, lim = 1000) => attempt(MANAGER, "select * from public.academic_template_rows($1, $2, $3, $4::jsonb)", [LOWER, off, lim, filter === null ? null : JSON.stringify(filter)]);
const total = Number((await q("select count(*)::int n from scholars where school_id = $1 and status <> 'Removed'", [LOWER]))[0].n);

// 1. no filter = the whole school (as before); a program filter = only those scholars; filters combine (program + status); the same list as the screen (same order)
const all = await tpl(null), none = await tpl({}), prog = await tpl({ programs: ["bs alpha"] }), combo = await tpl({ programs: ["bs alpha"], status: "non_academic" });
const screen = await attempt(MANAGER, "select scholar_id_number from public.academic_school_scholars($1, $2::jsonb, 'name', 'asc', 50, 0)", [LOWER, JSON.stringify({ programs: ["bs alpha"] })]);
check("1 with no filter the template has the whole school; with a program filter only that program's scholars (4); program + status combine (2 Non-academic of them); and the list is the very same scholars, in the same order, as the screen shows for that filter",
  all.ok && all.rows.length === total && none.rows.length === total && prog.rows.length === 4 && combo.rows.length === 2 && prog.rows.map(r => r.scholar_id_number).join() === screen.rows.map(r => r.scholar_id_number).join() && combo.rows.every(r => r.academic_status === "non_academic"), `${all.msg} ${all.rows?.length}/${total} ${prog.rows?.length} ${combo.rows?.length}`);

// 2. search and year level, paging still works (1,000 at a time), the status shown is the scholar's today, removed scholars stay out unless asked
const year = await tpl({ years: ["2nd Year"] }), search = await tpl({ search: ids[5].toLowerCase() }), page = await tpl({}, 2, 3);
await q("update scholars set status = 'Removed' where scholar_id_number = $1", [ids[9]]);
const noRemoved = await tpl({ programs: ["bs beta"] }), withRemoved = await tpl({ programs: ["bs beta"], include_removed: true });
check("2 year level and search narrow it down (everybody but the 4 first-years, 1 by Scholar ID), paging still works (offset 2, 3 rows), and a removed scholar is left out unless the filter shows removed scholars",
  year.rows.length === total - 4 && search.rows.length === 1 && search.rows[0].scholar_id_number === ids[5] && page.rows.length === 3 && noRemoved.rows.length === 5 && withRemoved.rows.length === 6, `${year.rows?.length} ${search.rows?.length} ${page.rows?.length} ${noRemoved.rows?.length} ${withRemoved.rows?.length}`);

// 3. only the Scholar Management staff; the undo gives the whole school again (no filter value) and the update runs again
const denied = await attempt(PLAIN, "select * from public.academic_template_rows($1, 0, 10, null)", [LOWER]);
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const old = await attempt(MANAGER, "select * from public.academic_template_rows($1, 0, 1000)", [LOWER]);
const sigGone = (await q("select to_regprocedure('public.academic_template_rows(uuid,integer,integer,jsonb)') f"))[0].f === null;
await db.exec(read(NEW));
check("3 only the Scholar Management staff can use it; after the undo the template is the whole school again (the old 3-value function) and the update can be run again",
  !denied.ok && /Scholar Management/i.test(denied.msg) && old.ok && old.rows.length >= total - 1 && sigGone && (await q("select to_regprocedure('public.academic_template_rows(uuid,integer,integer,jsonb)') f"))[0].f !== null, `${denied.msg} ${old.rows?.length}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
