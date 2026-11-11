// tests/renewal-traffic/db_tests.mjs — the staff live-update answer is worked out once and kept 5 seconds (2 checks, short on purpose)
// Run:  node tests/renewal-traffic/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_live_updates_faster.sql", UNDO = "undo_live_updates_faster.sql";
async function stamp(uid) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query("select public.staff_live_stamp() s")).rows[0].s;
  });
}
const attempt = async (uid) => { try { return { ok: true, s: await stamp(uid) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain");
await db.exec(read(UNDO)).catch(() => {});
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe

console.log("The staff live-update answer");
const s1 = await stamp(EVAL);
const row1 = (await q("select computed_at from live_stamp_cache where name = 'staff'"))[0];
await q("update scholars set updated_at = now() where scholar_id_number = (select scholar_id_number from scholars limit 1)");      // something changes
const s2 = await stamp(EVAL);
const row2 = (await q("select computed_at from live_stamp_cache where name = 'staff'"))[0];
await q("update live_stamp_cache set computed_at = now() - interval '10 seconds' where name = 'staff'");      // the kept answer is old enough
const s3 = await stamp(EVAL);
check("1 within 5 seconds every staff page gets the same kept answer (nothing is worked out again); after 5 seconds the change shows", s1 === s2 && String(row1.computed_at) === String(row2.computed_at) && s3 !== s1, `${s1 === s2} ${s3 !== s1}`);
const cons = await attempt(COUNSELOR), plain = await attempt(PLAIN);
await db.exec(read(UNDO));
const after = await attempt(EVAL);
check("2 the consultation staff may follow changes (for their Renewal Cases tab), plain staff may not; after the undo the old behaviour is back", cons.ok && !plain.ok && /Not authorized/.test(plain.msg) && after.ok
  && (await q("select to_regclass('public.live_stamp_cache') t"))[0].t === null, `${cons.ok} ${plain.msg} ${after.ok}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
