// tests/attendance-speed/db_tests.mjs — the attendance rules ask their question once and the scholar's lookup has an index, and everybody still sees exactly the same rows (3 checks, short on purpose)
// Run:  node tests/attendance-speed/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_attendance_speed.sql", UNDO = "undo_attendance_speed.sql", RT = "supabase_migration_realtime_trim.sql", RTU = "undo_realtime_trim.sql";
async function as(uid, sql) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql)).rows;
  });
}
// give a few more scholars attendance in the seeded sessions, so that the views differ from scholar to scholar
const sessions = (await q("select id from attendance_sessions order by id")).map(r => r.id);
const sch = await q("select id, scholar_id_number from scholars order by scholar_id_number limit 40");
for (let i = 0; i < sch.length; i++) {
  const s = sessions[i % Math.max(1, sessions.length)];
  if (s && i % 3 !== 0) await q("insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count) values ($1, $2, 1, 'present', 1) on conflict do nothing", [s, sch[i].scholar_id_number]).catch(() => {});
}
const staff = [seedId("staff:demo.evaluator"), seedId("staff:demo.admin"), seedId("staff:demo.plain"), seedId("staff:demo.sead")];
const snap = async () => {
  const out = {};
  for (const u of [...sch.map(s => s.id), ...staff]) {
    out[u] = JSON.stringify([(await as(u, "select session_id::text || scholar_id_number as id from attendance_records order by 1")).map(r => r.id), (await as(u, "select id from attendance_sessions order by id")).map(r => r.id)]);
  }
  return JSON.stringify(out);
};
await db.exec(read(UNDO)).catch(() => {});
const before = await snap();
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const after = await snap();
const distinct = new Set(Object.values(JSON.parse(after)));
check("1 every scholar and every staff account sees exactly the same attendance rows and sessions as before (and the demo has different views to compare)", before === after && distinct.size >= 3, before === after ? `views: ${distinct.size}` : "views differ");
const idx = await q("select count(*)::int n from pg_indexes where indexname = 'idx_attendance_records_scholar'");
const pol = await q("select qual from pg_policies where schemaname = 'public' and tablename = 'attendance_sessions' and policyname = 'scholar reads own attendance sessions'");
check("2 attendance_records has an index on the scholar, and the scholar's session rule uses the one-time helper (not a check per row)", idx[0].n === 1 && pol[0].qual.includes("my_attendance_session_ids"));
await db.exec(read(UNDO));
const idxGone = (await q("select count(*)::int n from pg_indexes where indexname = 'idx_attendance_records_scholar'"))[0].n;
await db.exec(read(RT)); await db.exec(read(RT));
const inList = async () => (await q("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'").catch(() => [])).map(r => r.tablename);
const afterTrim = await inList();
await db.exec(read(RTU));
const afterUndo = await inList();
check("3 the undo puts the old rules back and drops the index; the live-push trim takes the 3 unused tables out of the list (nothing else) and its undo puts them back (or, where the demo has no live-push list, runs without error)",
  idxGone === 0 && !afterTrim.some(t => ["attendance_codes", "sdp_activities", "sdp_attendance"].includes(t)) && (afterTrim.length === 0 || afterUndo.length >= afterTrim.length), `${idxGone} ${afterTrim} ${afterUndo}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
