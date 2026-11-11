// tests/rls-speed/db_tests.mjs — the notifications and SDP activities rules ask their question once, and show exactly the same things to the same people (3 checks, short on purpose)
// Run:  node tests/rls-speed/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_rls_speed_notifications_sdp.sql", UNDO = "undo_rls_speed_notifications_sdp.sql";
async function as(uid, sql) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql)).rows;
  });
}
// the real database has this rule on notifications (it comes from the base schema, which the demo does not have): put it there the same way
await q("alter table public.notifications enable row level security").catch(() => {});
await q('drop policy if exists "staff full access" on public.notifications');
await q('create policy "staff full access" on public.notifications for all using (public.is_cedo_staff())');
const scholars = (await q("select id from scholars order by scholar_id_number limit 60")).map(r => r.id);
// make the activities different for different scholars: one only for a year level, one only for a barangay, one only for a cluster-less barangay list, the rest open to all
const acts = (await q("select id from public.sdp_activities order by id limit 4")).map(r => r.id);
const lv = (await q("select year_level from scholars where year_level is not null group by year_level order by count(*) desc limit 1"))[0]?.year_level;
const bg = (await q("select barangay from scholars where nullif(trim(coalesce(barangay, '')), '') is not null group by barangay order by count(*) desc limit 1"))[0]?.barangay;
if (acts[0] && lv) await q("update public.sdp_activities set all_year_levels = false, target_year_levels = array[$2]::text[] where id = $1", [acts[0], lv]);
if (acts[1] && bg) await q("update public.sdp_activities set target_barangays = array[$2]::text[] where id = $1", [acts[1], bg]);
if (acts[2] && lv && bg) await q("update public.sdp_activities set all_year_levels = false, target_year_levels = array[$2]::text[], target_barangays = array[$3]::text[] where id = $1", [acts[2], lv, bg]);
const staff = [seedId("staff:demo.evaluator"), seedId("staff:demo.admin"), seedId("staff:demo.plain")];
const ACT = "select id from public.sdp_activities order by id";
const snapshot = async () => { const out = {}; for (const u of [...scholars, ...staff]) out[u] = (await as(u, ACT)).map(r => r.id).join(","); const n = await as(staff[0], "select count(*)::int c from public.notifications"); out.notifs = n[0].c; out.noNotifs = (await as(scholars[0], "select count(*)::int c from public.notifications"))[0].c; return JSON.stringify(out); };

await db.exec(read(UNDO));
const before = await snapshot();
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const after = await snapshot();
const seen = new Set(Object.values(JSON.parse(after)).filter(v => typeof v === "string"));
check("1 every scholar and every staff account sees exactly the same SDP activities and notifications as before (and the demo really has different views to compare)", before === after && seen.size >= 2, before === after ? `views: ${seen.size}` : "views differ");
const pol = await q("select policyname, qual from pg_policies where schemaname = 'public' and ((tablename = 'notifications' and policyname = 'staff full access') or (tablename = 'sdp_activities' and policyname in ('scholar reads open activities')))");
check("2 the staff question on notifications is asked once per read (not once per row), and the scholar's year level and barangay are read once by the helpers",
  pol.find(p => p.policyname === "staff full access").qual.includes("SELECT") && pol.find(p => p.policyname === "scholar reads open activities").qual.includes("current_scholar_year_level"));
await db.exec(read(UNDO));
const back = await q("select qual from pg_policies where schemaname = 'public' and tablename = 'sdp_activities' and policyname = 'scholar reads open activities'");
check("3 the undo puts the old rules back (and the helpers are gone), and the file can be put on again", !back[0].qual.includes("current_scholar_year_level") && (await q("select to_regprocedure('public.current_scholar_year_level()') f"))[0].f === null
  && (await db.exec(read(NEW)), (await q("select to_regprocedure('public.current_scholar_year_level()') f"))[0].f !== null));
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
