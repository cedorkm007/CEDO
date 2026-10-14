// tests/renewal/db/run_p4_tests.mjs — Phase 4 database checks: the scholar's own appointments list for the Consultation tile.
// (The Renewal tracker and the "what to do next" wording need nothing new in the database; they are tested in tests/renewal/run.mjs.)
// Same setup as the earlier database suites: every real migration file, in memory, plus the demo's TEST data.
// Run:  node tests/renewal/db/run_p4_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const COUNSELOR = seedId("staff:demo.counselor"), EVAL = seedId("staff:demo.evaluator");
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

console.log("\nThe scholar's own appointments (Consultation tile)");
{
  // seeded: TEST-0034 (booked, started 40 min ago), 0035, 0036, 0037 (in ~30 h), 0038 (in ~8 h)
  const a37 = await rpc(scholarUid(37), "select * from public.consultation_my_appointments()");
  check("a scholar sees their own booked appointment with the staff name and the term", a37.length === 1 && a37[0].state === "booked" && a37[0].staff_name && /1st Semester 2026-2027/.test(a37[0].term_label));
  check("30 hours ahead: it can still be changed", a37[0].can_change === true);
  const a38 = await rpc(scholarUid(38), "select * from public.consultation_my_appointments()");
  check("8 hours ahead: it can no longer be changed online", a38.length === 1 && a38[0].can_change === false);
  check("a scholar never sees another scholar's appointments", a37.every(a => a.slot_id !== a38[0].slot_id) && (await rpc(scholarUid(1), "select * from public.consultation_my_appointments()")).length === 0);
  check("a staff member (not a scholar) cannot use it", await (async () => { try { await rpc(COUNSELOR, "select * from public.consultation_my_appointments()"); return false; } catch (e) { return /Not signed in as a scholar/.test(e.message); } })());
  check("anonymous visitors cannot call it", await (async () => { try { await db.transaction(async tx => { await tx.exec("set local role anon"); await tx.query("select * from public.consultation_my_appointments()"); }); return false; } catch { return true; } })());

  // history: attended and missed ones appear after the upcoming one; upcoming comes first
  const slot34 = (await q("select id from counseling_slots where scholar_id_number = $1", [num(34)]))[0].id;
  await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'attended')", [slot34]);
  const slot35 = (await q("select id from counseling_slots where scholar_id_number = $1", [num(35)]))[0].id;
  await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'no_show')", [slot35]);
  const a34 = await rpc(scholarUid(34), "select * from public.consultation_my_appointments()");
  const a35 = await rpc(scholarUid(35), "select * from public.consultation_my_appointments()");
  check("an attended appointment stays in the list as 'attended'", a34.length === 1 && a34[0].state === "attended" && a34[0].can_change === false);
  check("a missed appointment shows as 'no_show'", a35.length === 1 && a35[0].state === "no_show");
  // a scholar with a past attended AND a new upcoming booking: upcoming first
  const rec35 = (await q("select id from renewal_records where scholar_id_number = $1", [num(35)]))[0].id;
  const free = await q("select id from counseling_slots where state = 'open' and starts_at > now() + interval '20 hours' order by starts_at limit 1");
  await rpc(scholarUid(35), "select public.renewal_book_slot($1,$2)", [rec35, free[0].id]);
  const mixed = await rpc(scholarUid(35), "select * from public.consultation_my_appointments()");
  check("upcoming appointments come first, then the earlier ones", mixed.length === 2 && mixed[0].state === "booked" && mixed[1].state === "no_show");
  check("open slots are never listed as anyone's appointment", (await rpc(scholarUid(35), "select * from public.consultation_my_appointments()")).every(a => a.state !== "open"));
}

console.log("\nSafety: running the Phase 4 migration twice changes nothing");
{
  let ok = true;
  try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p4_tracker.sql", import.meta.url), "utf8")); } catch (e) { ok = false; console.log("   ", e.message); }
  check("the migration can be run twice", ok);
}

console.log(`\n${failed === 0 ? "ALL PHASE 4 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
