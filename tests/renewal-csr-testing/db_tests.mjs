// tests/renewal-csr-testing/db_tests.mjs — a separate switch for the Certificate of Scholarship Renewal (CSR) while the renewal is in TESTING
//   (supabase_migration_renewal_csr_testing_a_column.sql + _b_functions.sql)
// Run:  node tests/renewal-csr-testing/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_renewal_csr_testing_a_column.sql", "supabase_migration_renewal_csr_testing_b_functions.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

for (const f of FILES) await db.exec(read(f));       // last, as on the real project
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), ITADMIN = seedId("staff:it.admin1");
const uidOf = n => seedId(`scholar:${n}`), idOf = n => `TEST-${String(n).padStart(4, "0")}`;
const recOf = async n => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = '2026-2027' and term = '1st Semester'", [idOf(n)]))[0];
const rec46 = (await recOf(46)).id;
const W1 = seedId("window:w1");
const SAVE = "select public.csr_settings_save($1, $2, $3, $4, $5, $6, $7, $8, $9)";
/** The existing save (the "on for everyone" switch) and, separately, the new testing switch. */
const save = async (uid, o = {}) => {
  if (o.enabled !== undefined) { const a = await attempt(uid, SAVE, [o.enabled, "Ms. Officer Test", "Officer Title", "Hon. Mayor Test", "City Mayor", "the City of Test, Philippines", null, null, null]); if (!a.ok) return a; }
  if (o.testing !== undefined) { const b = await attempt(uid, "select public.csr_testing_switch($1)", [o.testing]); if (!b.ok) return b; }
  return { ok: true };
};
const forRec = async (uid, rec) => (await rows(uid, "select public.csr_for_record($1) c", [rec]))[0].c;
const prepare = (uid, rec) => attempt(uid, "select public.csr_prepare($1, null) r", [rec]);
const settings = async () => (await q("select * from csr_settings"))[0];
const testersOnly = ids => q("update renewal_windows set testers = $2 where id = $1", [W1, ids]);

console.log("The two switches");
check("a new column exists, OFF by default, and the demo's 'on for everyone' is unchanged", (await settings()).testing_enabled === false && (await settings()).enabled === true);
check("the settings screen reads both switches", await (async () => { const s = (await rows(EVAL, "select public.csr_settings_get() s"))[0].s; return s.enabled === true && s.testing_enabled === false; })());
check("only the evaluator and the IT admin can change them (the IT admin too)", (await save(EVAL, { enabled: false, testing: false })).ok && (await save(ITADMIN, { testing: false })).ok && !(await save(COUNSELOR, { testing: true })).ok && !(await save(uidOf(1), { testing: true })).ok && /Only the evaluator and the IT admin/.test((await save(COUNSELOR, { testing: true })).msg));
check("everything is OFF now", (await settings()).enabled === false && (await settings()).testing_enabled === false);

console.log("\nBoth OFF: nobody gets a certificate");
const none = await forRec(uidOf(46), rec46);
check("the scholar is told certificates are not on", none.enabled === false && none.testing === false);
const p0 = await prepare(uidOf(46), rec46);
check("a certificate cannot be made", !p0.ok && /not switched on/.test(p0.msg), p0.msg);

console.log("\nON FOR TESTING only");
check("switching on for testing leaves the first switch as it was", (await save(EVAL, { testing: true })).ok && (await settings()).testing_enabled === true && (await settings()).enabled === false);
check("a scholar of a NORMAL window still gets nothing", (await forRec(uidOf(46), rec46)).enabled === false && !(await prepare(uidOf(46), rec46)).ok);
await testersOnly([idOf(46)]);
const t46 = await forRec(uidOf(46), rec46);
check("a scholar of a testers-only window can get a certificate, and the screen is told it is a TEST certificate", t46.enabled === true && t46.testing === true && t46.eligible === true, JSON.stringify(t46));
const pt = await prepare(uidOf(46), rec46);
check("…and the certificate is made", pt.ok && pt.rows[0].r.csr_number && pt.rows[0].r.version === 1, pt.msg);
const staffView = await forRec(EVAL, rec46);
check("the evaluator sees the same", staffView.enabled === true && staffView.testing === true);
check("a scholar's record in a window that is not a test is not affected by the testing switch", await (async () => {
  const w2 = (await q("select id from renewal_windows where id <> $1 limit 1", [W1]))[0];
  const rec = (await q("select r.id from renewal_records r where r.window_id = $1 limit 1", [w2?.id ?? W1]))[0];
  return !rec || (await q("select public._csr_on_for_record($1) v", [rec.id]))[0].v === (await settings()).enabled;
})());

console.log("\nON FOR EVERYONE");
await testersOnly(null);
check("with the testing switch OFF and 'for everyone' ON every renewed scholar can get one (as before), and it is not marked as a test", (await save(EVAL, { enabled: true, testing: false })).ok
  && (await forRec(uidOf(46), rec46)).enabled === true && (await forRec(uidOf(46), rec46)).testing === false && (await prepare(uidOf(46), rec46)).ok);
check("with both ON it is not marked as a test either (the real switch wins)", (await save(EVAL, { enabled: true, testing: true })).ok && (await forRec(uidOf(46), rec46)).testing === false);
check("the existing save is unchanged (nine values) and does not touch the testing switch; the testing switch does not touch the first one", (await save(EVAL, { enabled: false })).ok && (await settings()).enabled === false && (await settings()).testing_enabled === true
  && (await save(EVAL, { testing: false })).ok && (await settings()).enabled === false);
await save(EVAL, { testing: true });
check("only one csr_settings_save exists (no second form to confuse the screen)", (await q("select count(*)::int n from pg_proc where proname = 'csr_settings_save'"))[0].n === 1);

console.log("\nNotices to scholars");
await q("delete from scholar_notifications where kind = 'csr_ready'");
await save(EVAL, { enabled: false, testing: false });
await testersOnly([idOf(46)]);
await save(EVAL, { testing: true });
const testNotes = (await q("select scholar_id_number s from scholar_notifications where kind = 'csr_ready'")).map(r => r.s);
check("switching ON for testing tells only the test scholars whose renewal is already confirmed", testNotes.length >= 1 && testNotes.every(s => s === idOf(46)), JSON.stringify(testNotes));
await q("delete from scholar_notifications where kind = 'csr_ready'");
await testersOnly(null);
await save(EVAL, { enabled: true });
const liveNotes = (await q("select scholar_id_number s from scholar_notifications where kind = 'csr_ready'")).length;
check("switching ON for everyone tells every scholar whose renewal is already confirmed (as before)", liveNotes >= 1);
await save(EVAL, { enabled: false, testing: false });
await q("delete from scholar_notifications where kind = 'csr_ready'");
await testersOnly([idOf(45)]);
await save(EVAL, { testing: true });
await q("delete from scholar_notifications where kind = 'csr_ready'");
const rec45 = await recOf(45);
await q("update renewal_records set stage = 'renewed', confirmed_at = now() where id = $1", [rec45.id]).catch(() => null);
const justNow = (await q("select count(*)::int n from scholar_notifications where kind = 'csr_ready' and scholar_id_number = $1", [idOf(45)]))[0].n;
check("a test scholar whose renewal is confirmed while testing is on is told at once (a scholar of a normal window would not be)", justNow === 1, String(justNow));
await q("delete from scholar_notifications where kind = 'csr_ready'");
await testersOnly(null);
await q("update renewal_records set stage = 'removed' where id = $1", [rec45.id]).catch(() => null);
await q("update renewal_records set stage = 'renewed', confirmed_at = now() where id = $1", [rec45.id]).catch(() => null);
check("…and not told when only the testing switch is on and the window is a normal one", (await q("select count(*)::int n from scholar_notifications where kind = 'csr_ready' and scholar_id_number = $1", [idOf(45)]))[0].n === 0);

console.log("\nThe files");
check("file A adds one column with a lock limit and removes nothing; file B changes no table and deletes nothing", /lock_timeout = '5s'/.test(read(FILES[0])) && /add column if not exists testing_enabled/.test(read(FILES[0])) && !/\b(delete from|truncate|drop table)\b/i.test(read(FILES[0]) + read(FILES[1])) && !/alter table/i.test(read(FILES[1])));
await save(EVAL, { enabled: true, testing: true });
await db.exec(read("undo_renewal_csr_testing_b.sql"));
check("the undo of B puts back the single switch (the testing switch function and helper are gone; the save still works)", (await save(EVAL, { enabled: true })).ok
  && !(await q("select 1 from pg_proc where proname in ('_csr_on_for_record', 'csr_testing_switch')")).length && (await forRec(uidOf(46), rec46)).enabled === true);
await db.exec(read("undo_renewal_csr_testing_a.sql"));
check("the undo of A removes the column", !(await q("select 1 from information_schema.columns where table_name = 'csr_settings' and column_name = 'testing_enabled'")).length);
for (const f of FILES) { await db.exec(read(f)); await db.exec(read(f)); }
check("they can be put back after the undo, twice is safe", (await settings()).testing_enabled === false && (await q("select 1 from pg_proc where proname = '_csr_on_for_record'")).length === 1 && (await q("select 1 from pg_proc where proname = 'csr_testing_switch'")).length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
