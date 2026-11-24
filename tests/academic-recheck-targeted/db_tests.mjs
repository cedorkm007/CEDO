// tests/academic-recheck-targeted/db_tests.mjs — Grades and Academic Management, PHASE 2: the open renewals are checked again only when they need it, with a progress count (5 checks, short on purpose)
// Run:  node tests/academic-recheck-targeted/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_recheck_targeted.sql", UNDO = "undo_academic_recheck_targeted.sql";
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
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
await q("delete from academic_recheck_queue");
const all = (await q("select scholar_id_number s from scholars where school_id = $1 and status <> 'Removed' order by 1", [LOWER])).map(r => r.s);
const withOpen = (await q("select distinct r.scholar_id_number s from renewal_records r join scholars s on s.scholar_id_number = r.scholar_id_number where s.school_id = $1 and public._renewal_is_active_stage(r.stage) order by 1", [LOWER])).map(r => r.s);
const openCount = ids => q("select count(*)::int n from renewal_records r where r.scholar_id_number = any($1) and public._renewal_is_active_stage(r.stage)", [ids]).then(r => r[0].n);
const qrows = async () => Number((await q("select count(*)::int n from academic_recheck_queue"))[0].n);
const pending = async () => Number((await q("select count(*)::int n from academic_recheck_queue where done_at is null"))[0].n);
const version = async () => Number((await q("select version from academic_gwa_settings where id"))[0].version);
const apply = (ids, st) => attempt(MANAGER, "select public.academic_status_apply($1, '{}'::jsonb, $2, $3) r", [LOWER, ids, st]);
const some = withOpen.slice(0, 3);

// 1. a change that does NOT change the passing GWA checks nothing (Not set counts as Academic already); one that does checks only those scholars' open renewals, at once when it is small; the global number is not raised
const v0 = await version();
const imp0 = await attempt(MANAGER, "select public.academic_status_impact($1, '{}'::jsonb, $2, 'academic') r", [LOWER, some]);
const same = await apply(some, "academic");
const q1 = await pending();
const imp1 = await attempt(MANAGER, "select public.academic_status_impact($1, '{}'::jsonb, $2, 'non_academic') r", [LOWER, some]);
const diff = await apply(some, "non_academic");
const expected = await openCount(some);
check("1 Not set -> Academic keeps the same passing GWA, so NO renewal is checked again (impact says 0, nothing queued); Academic -> Non-academic changes it, so exactly the open renewals of those scholars are checked, at once (small change), and nothing is left waiting; the school-wide number is not raised",
  withOpen.length >= 3 && imp0.rows[0].r.recheck_renewals === 0 && same.rows[0].r.rechecks === 0 && q1 === 0 && imp1.rows[0].r.recheck_renewals === expected && diff.rows[0].r.rechecks === expected && diff.rows[0].r.rechecked_now === expected && (await pending()) === 0 && (await version()) === v0 && expected > 0,
  JSON.stringify({ w: withOpen.length, i0: imp0.rows?.[0]?.r, s: same.rows?.[0]?.r, i1: imp1.rows?.[0]?.r, d: diff.rows?.[0]?.r, expected, v0, v: await version() }));

// 2. a big change (more than 10 renewals) is queued, not done in one go: the screen asks for the next 25 and sees how many are left; nothing is lost; each renewal is checked once
await apply(all, "academic");                            // everyone Academic first (the same number as Not set: nothing to check)
await q("delete from academic_recheck_queue");
const big = await apply(all, "non_academic");
const openAll = await openCount(all);
const p0 = await pending();
const s1 = await attempt(MANAGER, "select public.academic_recheck_step(5) r"), s1r = s1.rows[0].r;
let last = s1r, guard = 0; while (last.remaining > 0 && guard++ < 20) last = (await attempt(MANAGER, "select public.academic_recheck_step(25) r")).rows[0].r;
const done = Number((await q("select count(*)::int n from academic_recheck_queue where done_at is not null and error is null"))[0].n);
check("2 a change that needs more than 10 renewals checked is queued (not all at once); the screen's step checks the next ones and tells how many are left (5 done, the rest after); in the end every queued renewal is checked once and none is left",
  big.rows[0].r.rechecks === openAll && openAll > 10 && big.rows[0].r.rechecked_now === 0 && p0 === openAll && s1r.processed === 5 && s1r.remaining === openAll - 5 && last.remaining === 0 && done >= openAll, `${JSON.stringify(big.rows?.[0]?.r)} ${openAll} ${p0} ${JSON.stringify(s1r)} ${JSON.stringify(last)} ${done}`);

// 3. a school's passing GWA: changing only the Non-academic number checks only the Non-academic scholars (all are Non-academic now = all open renewals); changing nothing checks nothing; Academic scholars are not touched by a Non-academic change
await q("delete from academic_recheck_queue");
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);      // same numbers
const none = await qrows();
await apply(some, "academic");                                  // 3 scholars back to Academic (2.00 -> 2.00? they were Non-academic: 3.00 -> 2.00, checked at once)
await q("delete from academic_recheck_queue");
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.50)", [LOWER]);      // only the Non-academic number changes
const nonAcOpen = await openCount(all.filter(x => !some.includes(x)));
const afterNon = await qrows();
await q("delete from academic_recheck_queue");
await attempt(MANAGER, "select public.academic_settings_save($1, 2.25, 3.50)", [LOWER]);      // only the Academic number changes: the 3 Academic scholars
const afterAc = await qrows();
check("3 saving the same passing GWAs checks nothing; changing only the Non-academic number queues only the open renewals of Non-academic scholars; changing only the Academic number queues only those of the Academic scholars",
  none === 0 && afterNon === nonAcOpen && afterNon > 0 && afterAc === (await openCount(some)) && afterAc > 0, `${none} ${afterNon}/${nonAcOpen} ${afterAc}/${await openCount(some)}`);

// 4. the 5-minute background job finishes what is left (a closed tab loses nothing); only the Scholar Management staff can ask for a step or read the count
await q("delete from academic_recheck_queue"); await apply(all, "academic");
const pre = await pending();
const job = (await q("select public._academic_recheck_batch(60) n"))[0].n;
const denied = await Promise.all([attempt(PLAIN, "select public.academic_recheck_step(5)"), attempt(PLAIN, "select public.academic_recheck_status()")]);
const stat = await attempt(MANAGER, "select public.academic_recheck_status() r");
check("4 the 5-minute job checks what is waiting (it drains the list); only the Scholar Management staff can run a step or read the count ('pending', 'failed', 'done today')",
  pre > 0 && job >= pre && (await pending()) === 0 && denied.every(r => !r.ok && /Scholar Management/i.test(r.msg)) && stat.rows[0].r.pending === 0 && stat.rows[0].r.done_today > 0 && stat.rows[0].r.failed === 0, `${pre} ${job} ${JSON.stringify(stat.rows?.[0]?.r)}`);

// 5. the undo: the earlier behaviour is back (a change raises the school-wide number again), nothing is deleted; the migration can be run again
const rows = Number((await q("select count(*)::int n from academic_recheck_queue"))[0].n);
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const vA = await version();
await apply(some.slice(0, 1), "non_academic");
const vB = await version();
const gone = (await q("select to_regprocedure('public.academic_recheck_step(integer)') a"))[0].a === null;
await db.exec(read(NEW));
check("5 after the undo a change raises the school-wide number again (the old way), the new functions are gone and no queue row is deleted; the migration can be run again",
  gone && vB === vA + 1 && Number((await q("select count(*)::int n from academic_recheck_queue"))[0].n) === rows && (await q("select to_regprocedure('public.academic_recheck_step(integer)') a"))[0].a !== null, `${gone} ${vA} ${vB}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
