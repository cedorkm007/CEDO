// tests/sdp-reconsideration-auto-close/db_tests.mjs — a waiting SDP reconsideration request closes by itself when the SDP credits become complete (5 checks, short on purpose)
// Run:  node tests/sdp-reconsideration-auto-close/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_sdp_reconsideration_live_lacking.sql", "supabase_migration_sdp_reconsideration_auto_close.sql"];
for (const f of FILES) await db.exec(read(f));
await db.exec(read(FILES[1]));      // twice: safe
const rec = (await q(`select r.id, r.scholar_id_number s, r.school_year y, r.term t, r.basis_school_year by, r.basis_term bt from renewal_records r
  where (select complied from public._sdp_compliance(r.basis_school_year, r.basis_term, r.scholar_id_number) limit 1) is true limit 1`))[0];
if (!rec) throw new Error("the demo has no scholar with complete SDP credits and an application");
const pend = () => q(`delete from sdp_reconsideration_requests where scholar_id_number = $1`, [rec.s]).then(() => q(`insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, status, lacking)
  values ($1, $2, $3, $4, $5, $6, 'pending', '{"community_service":2,"community_volunteerism":0,"formation_program":1}'::jsonb)`, [rec.s, rec.y, rec.t, rec.id, rec.by, rec.bt]));
const status = async () => (await q("select status, decided_by_label, decision_note from sdp_reconsideration_requests where scholar_id_number = $1", [rec.s]))[0];

console.log("A waiting request closes by itself");
await pend();
await db.exec(read(FILES[1]));      // the file closes requests that are ALREADY waiting while the credits are complete
check("1 a request already waiting while the credits are complete is closed when the file is run", (await status()).status === "not_needed");

await pend();
const credit = (await q("select to_jsonb(a) j from sdp_attendance a where scholar_id_number = $1 and school_year = $2 and semester = $3 limit 1", [rec.s, rec.by, rec.bt]))[0].j;
await q("delete from sdp_attendance where id = $1", [credit.id]);
check("2 while a credit is missing the request keeps waiting (nothing is closed that is still needed)", (await status()).status === "pending");
await q("insert into sdp_attendance select * from jsonb_populate_record(null::sdp_attendance, $1::jsonb)", [JSON.stringify(credit)]);
const st = await status();
check("3 when the credit is recorded the request is closed automatically (no button pressed), by 'System', with a note", st.status === "not_needed" && st.decided_by_label === "System" && /closed automatically/.test(st.decision_note), JSON.stringify(st));
check("4 the scholar is told, and the renewal history has a line", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'sdp_reconsideration_closed' and created_at > now() - interval '1 minute'", [rec.s]))[0].n >= 1
  && (await q("select count(*)::int n from renewal_history where record_id = $1 and note like 'SDP reconsideration closed automatically%'", [rec.id]))[0].n >= 1);

console.log("\nThe undo");
await db.exec(read("undo_sdp_reconsideration_auto_close.sql"));
await pend();
await q("delete from sdp_attendance where id = $1", [credit.id]);
await q("insert into sdp_attendance select * from jsonb_populate_record(null::sdp_attendance, $1::jsonb)", [JSON.stringify(credit)]);
check("5 after the undo a request is no longer closed by itself", (await status()).status === "pending");

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
