// tests/academic-not-set-exclude-tests/db_tests.mjs — the test scholars are left out of the "no academic status" counts and lists (3 checks, short on purpose)
// Run:  node tests/academic-not-set-exclude-tests/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_not_set_exclude_tests.sql", UNDO = "undo_academic_not_set_exclude_tests.sql";
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
const T = async (f, l, s) => (await q("select public._academic_is_test($1, $2, $3) t", [f, l, s]))[0].t;

// 1. who is a test scholar: the school named "test", or a first AND last name of "test", "test1", "test2"…; a real name that only contains test is NOT
const truth = [await T("Ana", "Cruz", "test"), await T("Ana", "Cruz", " TEST "), await T("test3", "test3", "Lourdes College"), await T("Test", "TEST10", "X"), await T("Testa", "Test", "X"), await T("Juan", "test", "X"), await T("Ana", "Cruz", "Test School"), await T(null, null, null)];
check("1 a test scholar is one in the school named 'test' (any case, spaces ignored) or whose first and last name are both test / test1 / test10; a real name that only contains 'test' (Testa, a first name Juan with last name test, 'Test School') and empty values are not",
  JSON.stringify(truth) === JSON.stringify([true, true, true, true, false, false, false, false]), JSON.stringify(truth));

// 2. the warning counts and the lists leave them out; nothing else is touched
const before = await attempt(MANAGER, "select * from public.academic_not_set_summary() where school_id = $1", [LOWER]);
const [a, b] = (await q("select scholar_id_number s from scholars where school_id = $1 and status <> 'Removed' order by 1 limit 2", [LOWER])).map(r => r.s);
await q("update scholars set first_name = 'test1', last_name = 'test1' where scholar_id_number = $1", [a]); await q("update scholars set first_name = 'test2', last_name = 'test2' where scholar_id_number = $1", [b]);
const after = await attempt(MANAGER, "select * from public.academic_not_set_summary() where school_id = $1", [LOWER]);
const list = await attempt(MANAGER, "select scholar_id_number from public.academic_not_set_list($1, 1000, 0)", [LOWER]);
const still = Number((await q("select count(*)::int n from scholars where scholar_id_number = any($1)", [[a, b]]))[0].n);
const denied = await attempt(PLAIN, "select * from public.academic_not_set_summary()");
check("2 two test scholars (test1 test1, test2 test2) are no longer counted (the school's 'no status' and 'scholars' counts each drop by 2) and are not in the downloaded list; they still exist; only the Scholar Management staff can read it",
  before.ok && after.ok && Number(after.rows[0].not_set) === Number(before.rows[0].not_set) - 2 && Number(after.rows[0].scholars) === Number(before.rows[0].scholars) - 2 && list.ok && !list.rows.some(r => [a, b].includes(r.scholar_id_number)) && still === 2 && !denied.ok && /Scholar Management/i.test(denied.msg), `${before.msg} ${JSON.stringify(before.rows?.[0])} ${JSON.stringify(after.rows?.[0])}`);

// 3. the undo counts them again (nothing deleted) and the update runs again
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const undone = await attempt(MANAGER, "select * from public.academic_not_set_summary() where school_id = $1", [LOWER]);
const gone = (await q("select to_regprocedure('public._academic_is_test(text,text,text)') f"))[0].f === null;
await db.exec(read(NEW));
check("3 after the undo the test scholars are counted again and the helper is gone; the update can be run again", undone.ok && Number(undone.rows[0].not_set) === Number(before.rows[0].not_set) && gone && (await q("select to_regprocedure('public._academic_is_test(text,text,text)') f"))[0].f !== null, JSON.stringify(undone.rows?.[0]));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
