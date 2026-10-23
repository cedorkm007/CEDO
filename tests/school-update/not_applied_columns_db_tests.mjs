// tests/school-update/not_applied_columns_db_tests.mjs — Scholar Renewal > Not applied: SDP status, grades status and the consultation referral
//   (supabase_migration_renewal_not_applied_columns.sql)
// Run:  node tests/school-update/not_applied_columns_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_not_applied_columns.sql", UNDO = "undo_renewal_not_applied_columns.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVALUATOR = seedId("staff:demo.evaluator"), SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), COUNSELOR = seedId("staff:demo.counselor");
// the window with the most applications is the one the demo's "1st Semester" screens use
const win = (await q(`select w.school_year, w.term from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
const page = (uid, query = null, limit = 25, offset = 0) => rows(uid, "select * from public.renewal_not_applied_page($1, $2, $3, $4, $5)", [win.school_year, win.term, query, limit, offset]);
const oldList = await rows(EVALUATOR, "select * from public.renewal_not_applied($1, $2)", [win.school_year, win.term]);

console.log("\nThe paged list");
const first = await page(EVALUATOR, null, 1000);
check("it lists exactly the same scholars as the older list (not Removed, not On leave, no application yet)", first.length === oldList.length && first.map(r => r.scholar_id_number).join() === oldList.map(r => r.scholar_id_number).join(), `${first.length} vs ${oldList.length}`);
check("every row carries the SDP status and the grades status", first.every(r => r.sdp_applicable !== null && ("sdp_complied" in r) && r.grades_state !== undefined && r.failed_count !== undefined));
check("each row's numbers are the same as the renewal check gives for that scholar (it cannot disagree with an application)", await (async () => {
  for (const r of first.slice(0, 12)) {
    const ev = (await q("select public._renewal_evaluate($1, $2, $3) e", [r.scholar_id_number, win.school_year, win.term]))[0].e;
    if ((ev.sdp.complied ?? null) !== r.sdp_complied || ev.grades.state !== r.grades_state || Number(ev.grades.counts.failed) !== r.failed_count || Number(ev.grades.counts.inc) !== r.inc_count) return false;
  }
  return true;
})());
const p1 = await page(EVALUATOR, null, 5, 0), p2 = await page(EVALUATOR, null, 5, 5);
check("pages are in the same order, do not repeat, and say how many scholars there are in all", p1.length === 5 && p2.length === 5 && p1[4].scholar_id_number !== p2[0].scholar_id_number && p1.every(r => Number(r.total_rows) === oldList.length)
  && [...p1, ...p2].map(r => r.scholar_id_number).join() === oldList.slice(0, 10).map(r => r.scholar_id_number).join());
check("a page asked for more than 100 gives at most 100, and a page past the end is empty", (await page(EVALUATOR, null, 5000)).length <= 100 && (await page(EVALUATOR, null, 5, 100000)).length === 0);
const some = oldList[3];
check("the search finds a scholar by ID number, and by name (any order)", (await page(EVALUATOR, some.scholar_id_number)).some(r => r.scholar_id_number === some.scholar_id_number)
  && (await page(EVALUATOR, some.name.split(",")[0])).some(r => r.scholar_id_number === some.scholar_id_number) && (await page(EVALUATOR, "zzzz-nobody")).length === 0);
check("someone who has applied is not on the list; a Removed or On leave scholar is not either", !first.some(r => ["TEST-0026", "TEST-0044"].includes(r.scholar_id_number)) && !first.some(r => ["Removed", "On leave"].includes(r.status)));
check("who may ask: the renewal evaluator; a staff member with no tools and a scholar may not; a visitor may not", first.length > 0
  && !(await attempt(PLAIN, "select * from public.renewal_not_applied_page($1, $2, null, 5, 0)", [win.school_year, win.term])).ok
  && !(await attempt(seedId("scholar:1"), "select * from public.renewal_not_applied_page($1, $2, null, 5, 0)", [win.school_year, win.term])).ok
  && !(await attempt(null, "select * from public.renewal_not_applied_page($1, $2, null, 5, 0)", [win.school_year, win.term], "anon")).ok);

console.log("\nThe referral from this list");
const target = oldList[0].scholar_id_number;
check("before anyone is referred the referral column is empty", (await page(EVALUATOR, target, 5))[0].referral_status === null);
const staffList = await rows(EVALUATOR, "select * from public.list_scholar_counseling_staff()");
check("the evaluator sees the consultation staff to refer to", staffList.length >= 1, JSON.stringify(staffList));
const made = await attempt(EVALUATOR, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [target, COUNSELOR]);
check("the evaluator can make the referral", made.ok, made.msg);
check("the list now shows the scholar as referred, with the referral's status", (await page(EVALUATOR, target, 5))[0].referral_status === "pending");
check("Scholar Management staff can still refer, and a staff member with no tools cannot", (await attempt(SEAD, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [oldList[1].scholar_id_number, COUNSELOR])).ok
  && !(await attempt(PLAIN, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [oldList[2].scholar_id_number, COUNSELOR])).ok
  && (await rows(PLAIN, "select * from public.list_scholar_counseling_staff()")).length === 0);

console.log("\nTesters-only windows, the undo and putting it back");
check("a testers-only window shows only its testers on the list", await (async () => {
  await q("update renewal_windows set testers = $3 where school_year = $1 and term = $2", [win.school_year, win.term, [oldList[0].scholar_id_number, oldList[1].scholar_id_number]]);
  const only = await page(EVALUATOR, null, 100);
  await q("update renewal_windows set testers = null where school_year = $1 and term = $2", [win.school_year, win.term]);
  return only.length === 2;
})());
await db.exec(read(FILE));
check("running the file again changes nothing", (await page(EVALUATOR, null, 3)).length === 3);
await db.exec(read(UNDO));
check("the undo removes the paged function and puts the referral functions back (the evaluator can no longer refer)", (await q("select count(*) n from pg_proc where proname = 'renewal_not_applied_page'"))[0].n == 0
  && !(await attempt(EVALUATOR, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [oldList[3].scholar_id_number, COUNSELOR])).ok
  && (await attempt(SEAD, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [oldList[4].scholar_id_number, COUNSELOR])).ok);
await db.exec(read(FILE));
check("it can be put back after the undo", (await page(EVALUATOR, null, 2)).length === 2);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file changes no table and deletes nothing", !/\b(alter table|drop table|delete from|truncate|insert into|update public)\b/i.test(text.replace(/insert into public\.scholar_counseling_referrals/g, "")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
