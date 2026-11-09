// tests/sdp-reconsideration-live/db_tests.mjs — SDP Reconsideration list: a waiting request shows what is lacking NOW, not the day of the request (5 checks, short on purpose)
// Run:  node tests/sdp-reconsideration-live/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_sdp_reconsideration_live_lacking.sql", UNDO = "undo_sdp_reconsideration_live_lacking.sql";
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const EVAL = seedId("staff:demo.evaluator");
const list = async () => (await as(EVAL, async tx => (await tx.query("select * from public.sdp_reconsideration_list('all', null, 100, 0)")).rows));
// a scholar whose SDP is complete for the semester the renewal looks at, with an application
const rec = (await q(`select r.id, r.scholar_id_number s, r.school_year y, r.term t, r.basis_school_year by, r.basis_term bt from renewal_records r
  where (select complied from public._sdp_compliance(r.basis_school_year, r.basis_term, r.scholar_id_number) limit 1) is true limit 1`))[0];
if (!rec) throw new Error("the demo has no scholar with complete SDP credits and an application");
await q("delete from sdp_reconsideration_requests where scholar_id_number = $1", [rec.s]);
await q(`insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, status, lacking)
  values ($1, $2, $3, $4, $5, $6, 'pending', '{"community_service":2,"community_volunteerism":0,"formation_program":1}'::jsonb)`, [rec.s, rec.y, rec.t, rec.id, rec.by, rec.bt]);
const mine = async () => (await list()).find(r => r.scholar_id_number === rec.s);
const total = l => Object.values(l ?? {}).reduce((n, v) => n + Number(v), 0);

console.log("A waiting request shows what is lacking now");
check("1 credits were added after the request: the list says nothing is lacking (the saved copy said 3 credits)", total((await mine()).lacking) === 0 && total((await q("select lacking from sdp_reconsideration_requests where scholar_id_number = $1", [rec.s]))[0].lacking) === 3);
const saved = await q("select id, activity_id, occurrence_number from sdp_attendance where scholar_id_number = $1 and school_year = $2 and semester = $3 limit 1", [rec.s, rec.by, rec.bt]);
await q("delete from sdp_attendance where id = $1", [saved[0].id]);
check("2 when a credit is missing again it shows how many are lacking, matching the Approve/Deny calculation", total((await mine()).lacking) >= 1 && JSON.stringify((await mine()).lacking) === JSON.stringify((await q("select public._sdp_live_lacking($1, $2, $3) l", [rec.s, rec.by, rec.bt]))[0].l));
await q("update sdp_reconsideration_requests set status = 'denied', decided_at = now() where scholar_id_number = $1", [rec.s]);
check("3 a decided request keeps the numbers recorded when it was decided", total((await mine()).lacking) === 3);

console.log("\nThe screen and the undo");
const tab = read("src/sead/renewal/RenewalSdpReconsiderationTab.tsx").split("\r\n").join("\n");
check("4 the tab says plainly that nothing is lacking any more and that deciding just closes the request", tab.includes("Nothing now: the SDP credits are complete") && tab.includes("the request is simply closed"));
await db.exec(read(UNDO));
check("5 the undo puts back the saved copy (a waiting request shows the old numbers again)", await (async () => { await q("update sdp_reconsideration_requests set status = 'pending', decided_at = null where scholar_id_number = $1", [rec.s]); return total((await mine()).lacking) === 3; })());

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
