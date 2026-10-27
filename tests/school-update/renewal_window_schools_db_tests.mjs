// tests/school-update/renewal_window_schools_db_tests.mjs — a renewal window limited to chosen SCHOOLS
//   (supabase_migration_renewal_window_schools_a_column.sql + _b_functions.sql)
// Run:  node tests/school-update/renewal_window_schools_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_renewal_window_schools_a_column.sql", "supabase_migration_renewal_window_schools_b_functions.sql"];
const UNDOS = ["undo_renewal_window_schools_b.sql", "undo_renewal_window_schools_a.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

// The demo applies the migration files in the order they were added to git, which can put an old Phase 2 reading rule after the Phase 8b file that drops it. On the real project the order is
// Phase 2, Phase 8b, then these files, so they are applied again here, last.
for (const file of FILES) await db.exec(read(file));
const EVALUATOR = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor");
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const school = async key => (await q("select id from schools where name like $1", [`%${key}%`]))[0].id;
const [LOWER, HIGHER, LETTERS] = [await school("Lower-Is-Better"), await school("Higher-Is-Better"), await school("Letter-Grade")];
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const save = (schools, testers = null, extra = {}) => attempt(EVALUATOR, "select public.renewal_window_save($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9::uuid[]) id",
  [win.id, win.school_year, win.term, ymd(win.opens_on), ymd(win.closes_on), win.late_allowed, win.note ?? "", testers, schools]);
const page = (query = null, limit = 100) => rows(EVALUATOR, "select * from public.renewal_not_applied_page($1, $2, $3, $4, 0)", [win.school_year, win.term, query, limit]);
const schoolOf = async ids => Object.fromEntries((await q("select scholar_id_number s, school_id from scholars where scholar_id_number = any ($1)", [ids])).map(r => [r.s, r.school_id]));
const all = await page();
check("the demo has scholars of several schools who have not applied yet", all.length >= 4, String(all.length));

console.log("\nChoosing the schools of a window");
check("the evaluator can see the schools to tick, with how many active scholars each has (and how many have no school)", await (async () => {
  const list = await rows(EVALUATOR, "select * from public.renewal_window_schools()");
  return list.length >= 4 && list.some(r => r.school_id === HIGHER && Number(r.scholars) >= 2) && list.some(r => r.school_id === null);
})());
check("a staff member who is not the evaluator cannot read that list or save a window", !(await attempt(COUNSELOR, "select * from public.renewal_window_schools()")).ok);
const s1 = await save([HIGHER]);
check("the evaluator limits the window to one school", s1.ok, s1.msg);
check("the window remembers the school", (await q("select school_ids from renewal_windows where id = $1", [win.id]))[0].school_ids?.join() === HIGHER);
const only = await page();
const ownerOf = await schoolOf(only.map(r => r.scholar_id_number));
check("the Not applied list now has only the scholars of that school", only.length >= 1 && only.length < all.length && only.every(r => ownerOf[r.scholar_id_number] === HIGHER), `${only.length} of ${all.length}`);
check("the older list (and the page's total) agree", (await rows(EVALUATOR, "select * from public.renewal_not_applied($1, $2)", [win.school_year, win.term])).length === only.length && Number(only[0].total_rows) === only.length);
const dash = (await rows(EVALUATOR, "select public.renewal_dashboard($1, $2) d", [win.school_year, win.term]))[0].d;
check("the dashboard counts only the scholars of the chosen school", Number(dash.totals.not_applied) === only.length, JSON.stringify(dash.totals));
check("a school that does not exist is refused", !(await save([HIGHER, "99999999-9999-9999-9999-999999999999"])).ok);
check("saving with no list leaves the schools as they are (the older save call still works)", (await save(null)).ok && (await q("select school_ids from renewal_windows where id = $1", [win.id]))[0].school_ids?.join() === HIGHER);

console.log("\nWhat a scholar sees and can do");
const highAvail = only[0].scholar_id_number;
const lowAvail = all.find(r => ownerOf[r.scholar_id_number] !== HIGHER && !only.some(o => o.scholar_id_number === r.scholar_id_number)).scholar_id_number;
const seesWindow = async s => (await rows(uidOf(s), "select public.renewal_my_overview() o"))[0].o.windows.some(w => w.window.id === win.id);
check("a scholar of the chosen school sees the window; a scholar of another school does not", (await seesWindow(highAvail)) && !(await seesWindow(lowAvail)));
check("the database also hides the window row from a scholar of another school (not only the screen)", (await rows(uidOf(lowAvail), "select count(*)::int n from renewal_windows where id = $1", [win.id]))[0].n === 0
  && (await rows(uidOf(highAvail), "select count(*)::int n from renewal_windows where id = $1", [win.id]))[0].n === 1 && (await rows(COUNSELOR, "select count(*)::int n from renewal_windows where id = $1", [win.id]))[0].n === 1);
const refused = await attempt(uidOf(lowAvail), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [win.id]);
check("a scholar of another school cannot apply, and is told it is not open for their school", !refused.ok && /not open for your school/.test(refused.msg), refused.msg);
const applied = await attempt(uidOf(highAvail), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [win.id]);
check("a scholar of the chosen school can apply", applied.ok, applied.msg);
const hasRecord = (await q("select r.scholar_id_number s, sc.school_id from renewal_records r join scholars sc on sc.scholar_id_number = r.scholar_id_number where r.window_id = $1 and sc.school_id <> $2 limit 1", [win.id, HIGHER]))[0];
check("a scholar of another school who ALREADY applied keeps seeing the window and the application", hasRecord && (await seesWindow(hasRecord.s)));
check("the applied scholar is no longer on the list of those who have not applied", !(await page()).some(r => r.scholar_id_number === highAvail));

console.log("\nAlerts and combinations");
await q("delete from scholar_notifications where kind = 'window_open'"); await q("delete from renewal_notice_log");
await save([LOWER]);
const noon = new Date(`${ymd(win.opens_on)}T11:00:00+08:00`);
noon.setUTCDate(noon.getUTCDate() + 1);
await q("select public.renewal_notification_jobs($1::timestamptz)", [noon.toISOString()]);
const recipients = await q("select distinct n.scholar_id_number s, sc.school_id from renewal_notice_log n join scholars sc on sc.scholar_id_number = n.scholar_id_number where n.kind = 'window_open' and n.ref = $1", [win.id]);
check("the 'Renewal is now open' alert goes only to scholars of the chosen school", recipients.length >= 1 && recipients.every(r => r.school_id === LOWER), JSON.stringify(recipients.map(r => r.school_id)));
await save([HIGHER, LOWER, LETTERS], [highAvail, lowAvail]);
const both = await page();
check("a testers-only window with schools needs BOTH: the tester must be in a chosen school", both.every(r => [highAvail, lowAvail].includes(r.scholar_id_number)) && both.length <= 2);
await save([], []);
check("an empty list of schools (and testers) means everyone again", (await page()).length === all.length - 1 /* the one who applied */);
await q("update scholars set school_id = null where scholar_id_number = $1", [lowAvail]);
await save([HIGHER]);
check("a scholar with no school set cannot be matched, so is not included when schools are chosen; the list says how many there are", !(await page()).some(r => r.scholar_id_number === lowAvail)
  && Number((await rows(EVALUATOR, "select * from public.renewal_window_schools()")).find(r => r.school_id === null).scholars) >= 1);
await save([]);

console.log("\nRunning again, the undo and putting it back");
for (const f of FILES) await db.exec(read(f));
check("running the files again changes nothing", (await page()).length >= 1);
await save([HIGHER]);
for (const f of UNDOS) await db.exec(read(f));
check("after the undo every window is for everyone again, as before", (await page()).length === all.length - 1 && (await q("select count(*)::int n from information_schema.columns where table_name = 'renewal_windows' and column_name = 'school_ids'"))[0].n === 0);
check("the older save call (without schools) still works after the undo", (await attempt(EVALUATOR, "select public.renewal_window_save($1, $2, $3, $4::date, $5::date, $6, $7) id", [win.id, win.school_year, win.term, ymd(win.opens_on), ymd(win.closes_on), win.late_allowed, ""])).ok);
for (const f of FILES) await db.exec(read(f));
await save([HIGHER]);
check("it can be put back after the undo", (await page()).every(r => true) && (await q("select school_ids from renewal_windows where id = $1", [win.id]))[0].school_ids?.join() === HIGHER);
const text = FILES.map(f => read(f).replace(/--.*$/gm, "")).join("\n");
check("file A changes only the windows table; neither file deletes anything", !/alter table public\.(?!renewal_windows)/i.test(text) && !/\b(delete from|truncate|drop table)\b/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
