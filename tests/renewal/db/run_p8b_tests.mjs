// tests/renewal/db/run_p8b_tests.mjs — Phase 8b database checks: the "testers only" renewal window.
// Everyone who is not on the list must see nothing, get no alert, be unable to apply and not be counted; the listed scholars use the window like any other.
// Same setup as the earlier suites (every real migration file in memory + the demo's TEST data, run as signed-in people).  Run:  node tests/renewal/db/run_p8b_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
// The demo builder retries a few statements of older files at the very end (statements that had to wait for a table); on the real project the files
// simply run in order, so apply this one once more to get exactly that final state.
await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p8b_test_windows.sql", import.meta.url), "utf8"));

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), DH = staffUid("demo.divhead"), SEADHEAD = staffUid("demo.seadhead");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const fails = async (uid, sql, params, pattern) => { try { await rpc(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const day = (await q("select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') d"))[0].d;
const closes = (await q("select to_char((now() at time zone 'Asia/Manila')::date + 20, 'YYYY-MM-DD') d"))[0].d;
const SAVE = "select public.renewal_window_save($1, $2, $3, $4::date, $5::date, true, 'TEST window', $6::text[]) id";
const YEAR = "2027-2028", TERM = "1st Semester";
const windowOf = async () => (await q("select * from renewal_windows where school_year = $1 and term = $2", [YEAR, TERM]))[0];
const overviewHas = async n => (await rpc(scholarUid(n), "select public.renewal_my_overview() o"))[0].o.windows.some(w => w.window.school_year === YEAR && w.window.term === TERM);
const apply = (n, id) => rpc(scholarUid(n), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') r", [id]);
const everyoneBefore = (await q("select count(*)::int n from scholars where status not in ('Removed', 'On leave')"))[0].n;

console.log("\nOpening a testers-only window");
const wid = (await rpc(EVAL, SAVE, [null, YEAR, TERM, day, closes, [` ${num(1)} `, num(2), num(1), ""]]))[0].id;
let w = await windowOf();
check("the list is tidied (spaces, repeats, empty entries) and saved", JSON.stringify(w.testers) === JSON.stringify([num(1), num(2)]));
check("only the evaluator can save or clear a window", await fails(COUNSELOR, SAVE, [null, "2028-2029", TERM, day, closes, [num(1)]], /Only the Scholar Renewal Evaluator/) && await fails(DH, "select public.renewal_window_clear_test_data($1)", [wid], /Only the Scholar Renewal Evaluator/));
check("an ID that is not a scholar is refused, and says which", await fails(EVAL, SAVE, [null, "2028-2029", TERM, day, closes, [num(1), "NOPE-1", "NOPE-2"]], /not found: NOPE-1, NOPE-2/));
check("more than 100 scholars are refused", await fails(EVAL, SAVE, [null, "2028-2029", TERM, day, closes, Array.from({ length: 101 }, (_, i) => `X${i}`)], /at most 100/));

console.log("\nChoosing the test scholars on screen");
const lk = async (uid, query, ids) => rpc(uid, "select * from public.renewal_scholar_lookup($1, $2)", [query ?? null, ids ?? null]);
check("only the evaluator can look scholars up", await fails(COUNSELOR, "select * from public.renewal_scholar_lookup('test', null)", [], /Only the Scholar Renewal Evaluator/) && await fails(scholarUid(1), "select * from public.renewal_scholar_lookup('test', null)", [], /Only the Scholar Renewal Evaluator/));
check("a search by part of an ID or a name finds scholars (at least 2 letters; nothing for 1 letter)", (await lk(EVAL, "TEST-0001")).some(r => r.scholar_id_number === num(1)) && (await lk(EVAL, "Renewed With")).some(r => r.scholar_id_number === num(46)) && (await lk(EVAL, "T")).length === 0 && (await lk(EVAL, null)).length === 0);
const removedId = (await q("select scholar_id_number from scholars where status = 'Removed' limit 1"))[0]?.scholar_id_number;
check("a search never offers a Removed or On leave scholar, and gives at most 120 rows", (!removedId || !(await lk(EVAL, removedId)).some(r => r.scholar_id_number === removedId)) && (await lk(EVAL, "TEST")).length <= 120);
check("already chosen IDs can be looked up by ID (to show their names)", await (async () => { const r = await lk(EVAL, null, [num(1), num(2)]); return r.length === 2 && r.every(x => x.name && x.school); })());

console.log("\nWho can see it");
check("a listed scholar sees the window on their Renewal tile", await overviewHas(1) && await overviewHas(2));
check("every other scholar does NOT see it, however they ask", !(await overviewHas(3)) && !(await overviewHas(46)) && !(await overviewHas(10)));
const readable = async uid => (await as(uid, async tx => (await tx.query("select id from renewal_windows where school_year = $1 and term = $2", [YEAR, TERM])).rows)).length === 1;
const reads = { s1: await readable(scholarUid(1)), s3: await readable(scholarUid(3)), ev: await readable(EVAL), co: await readable(COUNSELOR), dh: await readable(DH), sh: await readable(SEADHEAD) };
check("reading the table directly shows it only to the listed scholars and to renewal staff", reads.s1 && !reads.s3 && reads.ev && reads.co && reads.dh && reads.sh, JSON.stringify(reads));
check("normal windows stay readable by every scholar (the demo's earlier windows)", (await as(scholarUid(3), async tx => (await tx.query("select count(*)::int n from renewal_windows where testers is null")).rows))[0].n >= 1);

console.log("\nWho can apply");
check("a scholar who is not listed cannot apply, not even by calling the function with the window's id", await fails(scholarUid(3), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '')", [wid], /not open for you/) && (await q("select count(*)::int n from renewal_records where school_year = $1 and term = $2 and scholar_id_number = $3", [YEAR, TERM, num(3)]))[0].n === 0);
await apply(1, wid);
check("a listed scholar applies like in any window", (await q("select stage from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(1), YEAR, TERM])).length === 1);
check("even a direct insert for someone else is stopped by the database", await (async () => { try { await q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage) values ($1, $2, $3, $4, 'submitted')", [num(3), YEAR, TERM, wid]); return false; } catch (e) { return /not open for you/.test(String(e.message)); } })());

console.log("\nWho is counted");
const notApplied = (await rpc(EVAL, "select * from public.renewal_not_applied($1, $2)", [YEAR, TERM])).map(r => r.scholar_id_number);
check("'Not applied' lists only the listed scholars who have not applied yet", JSON.stringify(notApplied) === JSON.stringify([num(2)]));
const dash = (await rpc(EVAL, "select public.renewal_dashboard($1, $2) d", [YEAR, TERM]))[0].d;
check("the dashboard counts the listed scholars only (1 applied, 1 not yet, 2 can renew)", dash.totals.applied === 1 && dash.totals.not_applied === 1 && dash.totals.can_renew === 2, JSON.stringify(dash.totals));
const exp = (await rpc(EVAL, "select public.renewal_export_data($1, $2) d", [YEAR, TERM]))[0].d;
check("the Excel data has the same people", exp.applications.length === 1 && exp.not_applied.length === 1 && exp.not_applied[0].scholar_id_number === num(2));
check("a normal window's numbers still count everyone", (await rpc(EVAL, "select public.renewal_not_applied('2026-2027', '1st Semester') x", [])).length > 5);

console.log("\nAlerts");
const jobsAt = (await q("select ((now() at time zone 'Asia/Manila')::date + time '10:00') at time zone 'Asia/Manila' as t"))[0].t;
await q("delete from scholar_notifications where title like '%1st Semester 2027-2028%'");
await q("delete from renewal_notice_log");
await q("select public.renewal_notification_jobs($1)", [jobsAt]);
const told = await q("select scholar_id_number from scholar_notifications where title like '%1st Semester 2027-2028%' and kind = 'window_open' order by 1");
check("'Renewal is now open' goes to the listed scholars who have not applied, and to nobody else", JSON.stringify(told.map(t => t.scholar_id_number)) === JSON.stringify([num(2)]), JSON.stringify(told));
await q("update renewal_windows set opens_on = (now() at time zone 'Asia/Manila')::date - 5, closes_on = (now() at time zone 'Asia/Manila')::date + 3 where id = $1", [wid]);
await q("select public.renewal_notification_jobs($1)", [jobsAt]);
const closing = await q("select scholar_id_number from scholar_notifications where title like 'Renewal closes in%' and body like '%1st Semester 2027-2028%' order by 1");
check("'closes in 3 days' goes to the listed scholars who have not applied, and to nobody else", JSON.stringify(closing.map(t => t.scholar_id_number)) === JSON.stringify([num(2)]), JSON.stringify(closing));
await q("update renewal_windows set opens_on = $2::date, closes_on = $3::date where id = $1", [wid, day, closes]);

console.log("\nChanging the list");
check("an edit that does not send a list leaves the list as it is (an old screen cannot open the window by accident)", await (async () => {
  await rpc(EVAL, "select public.renewal_window_save($1, $2, $3, $4::date, $5::date, true, 'new note') id", [wid, YEAR, TERM, day, closes]);
  const x = await windowOf(); return JSON.stringify(x.testers) === JSON.stringify([num(1), num(2)]) && x.note === "new note";
})());
await rpc(EVAL, SAVE, [wid, YEAR, TERM, day, closes, [num(1), num(2), num(3)]]);
check("a scholar added to the list sees the window at once; one who is not on it still does not", await overviewHas(3) && !(await overviewHas(46)));
await rpc(EVAL, SAVE, [wid, YEAR, TERM, day, closes, []]);
w = await windowOf();
check("an empty list opens the window to everyone", w.testers === null && await overviewHas(46) && await overviewHas(10));
await rpc(EVAL, SAVE, [wid, YEAR, TERM, day, closes, [num(1), num(2)]]);
check("and a list can be set again", JSON.stringify((await windowOf()).testers) === JSON.stringify([num(1), num(2)]) && !(await overviewHas(46)));

console.log("\nAfter the test: clearing");
await q("update renewal_records set stage = 'renewed', result = 'renewed', confirmed_at = now() where scholar_id_number = $1 and school_year = $2 and term = $3", [num(1), YEAR, TERM]);
const rec1 = (await q("select id from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(1), YEAR, TERM]))[0].id;
await q("insert into csr_issued (csr_number, version, record_id, scholar_id_number, school_year, term, issued_at, storage_path) values ('CSR-2027-1S-00001', 1, $1, $2, $3, $4, now(), $5)", [rec1, num(1), YEAR, TERM, `${num(1)}/CSR-2027-1S-00001-v1.pdf`]);
const otherBefore = (await q("select count(*)::int n from renewal_records where not (school_year = $1 and term = $2)", [YEAR, TERM]))[0].n;
check("a window open to everyone cannot be cleared", await (async () => { const pub = (await rpc(EVAL, SAVE, [null, "2029-2030", TERM, day, closes, []]))[0].id; const r = await fails(EVAL, "select public.renewal_window_clear_test_data($1)", [pub], /open to everyone/); await rpc(EVAL, "select public.renewal_window_delete($1)", [pub]); return r; })());
const cleared = (await rpc(EVAL, "select public.renewal_window_clear_test_data($1) r", [wid]))[0].r;
check("clearing removes the listed scholars' renewals of that term and reports the files left", cleared.records === 1 && cleared.certificates === 1 && cleared.files_left.length === 1 && cleared.files_left[0] === `csr-issued/${num(1)}/CSR-2027-1S-00001-v1.pdf`, JSON.stringify(cleared));
check("nothing else was touched: other terms' renewals and other scholars are unchanged", (await q("select count(*)::int n from renewal_records where not (school_year = $1 and term = $2)", [YEAR, TERM]))[0].n === otherBefore
  && (await q("select count(*)::int n from renewal_records where school_year = $1 and term = $2", [YEAR, TERM]))[0].n === 0 && (await q("select count(*)::int n from scholars where status not in ('Removed', 'On leave')"))[0].n === everyoneBefore);
check("the window itself can now be deleted, or opened to everyone with clean numbers", await (async () => { await rpc(EVAL, "select public.renewal_window_delete($1)", [wid]); return !(await windowOf()); })());

console.log("\nSafety");
check("the migration can be run twice", await (async () => { try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p8b_test_windows.sql", import.meta.url), "utf8")); // one save of this file (8 arguments); the choose-schools update adds ONE separate form (9 arguments, it requires the schools) and never removes this one
  return (await q("select count(*)::int n from pg_proc where proname = 'renewal_window_save' and pronargs = 8"))[0].n === 1 && (await q("select count(*)::int n from pg_proc where proname = 'renewal_window_save'"))[0].n <= 2; } catch (e) { console.log("   ", e.message); return false; } })());
check("the internal helper and the guard cannot be called by signed-in users", await fails(EVAL, "select public._renewal_window_includes('2026-2027', '1st Semester', 'x')", [], /permission denied/));

console.log(`\n${failed === 0 ? "ALL PHASE 8b DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
