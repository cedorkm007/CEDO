// tests/sdp-credited-scholars/speed.mjs — how long the Credited Scholars tab takes to open for an activity with many credits: the OLD way (every credit and every name) and the NEW way (the two numbers and the first page).
// The database work only (the private demo database, on this computer): the real project adds the network time, which is far larger for the old way because it sends every row.
// Run:  node tests/sdp-credited-scholars/speed.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { addManyScholars } from "../../localdemo/many.mjs";
import fs from "node:fs";

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await addManyScholars(db, 8000);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
await db.exec(fs.readFileSync("supabase_migration_sdp_credited_scholars_paging.sql", "utf8"));
const SEAD = seedId("staff:demo.sead");
const act = (await q("select a.id, count(*)::int n from sdp_attendance x join sdp_activities a on a.id = x.activity_id group by a.id order by n desc limit 1"))[0];
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const time = async (label, fn, runs = 5) => { const t = []; let out; for (let i = 0; i < runs; i++) { const a = performance.now(); out = await fn(); t.push(performance.now() - a); } t.sort((x, y) => x - y); console.log(`  ${label}: ${t[Math.floor(t.length / 2)].toFixed(1)} ms (median of ${runs})`); return out; };

console.log(`An activity with ${act.n} credits (the demo's biggest):`);
console.log("\nOLD: all the credits, then the name of everyone (what the tab asked when it opened); the website's request returns at most 1,000 rows, so the rest was silently missing");
const old = await time("old way", async () => {
  const rows = await as(SEAD, "select id, scholar_id_number, attended_date, activity_day, activity_sid, school_year, semester from sdp_attendance where activity_id = $1 order by attended_date desc", [act.id]);
  const ids = [...new Set(rows.map(r => r.scholar_id_number))];
  const names = await as(SEAD, "select scholar_id_number, first_name, last_name from scholars where scholar_id_number = any ($1::text[])", [ids]);
  return { rows: rows.length, shown: Math.min(rows.length, 1000), names: names.length };
});
console.log(`    rows read: ${old.rows} (the website shows only the first ${old.shown}); names read: ${old.names}`);
console.log("\nNEW: the two numbers + the first page of 25");
const nw = await time("new way (numbers + first page)", async () => {
  const s = await as(SEAD, "select * from public.sdp_credited_summary($1)", [act.id]);
  const p = await as(SEAD, "select * from public.sdp_credited_page($1, '', null, null, false, 'date', 'desc', 25, 0)", [act.id]);
  return { rows: p.length, total: Number(p[0]?.total_count), credited: Number(s[0].credited_count) };
});
console.log(`    rows read: ${nw.rows} of ${nw.total} (the true total, never cut off)`);
await time("new way: next page (page 20)", () => as(SEAD, "select * from public.sdp_credited_page($1, '', null, null, false, 'date', 'desc', 25, 475)", [act.id]));
await time("new way: search by name", () => as(SEAD, "select * from public.sdp_credited_page($1, 'crowd 0012', null, null, false, 'date', 'desc', 25, 0)", [act.id]));
await time("scholar search of the credit form (indexed, 10 matches)", () => as(SEAD, "select * from public.sdp_search_scholars('crowd 0123', $1, 10)", [act.id]));
await time("scholar search, the OLD way (three ilike on the columns)", () => as(SEAD, "select scholar_id_number, first_name, last_name, school from scholars where (scholar_id_number ilike '%crowd 0123%' or first_name ilike '%crowd 0123%' or last_name ilike '%crowd 0123%') and status <> 'Removed' limit 8"));
process.exit(0);
