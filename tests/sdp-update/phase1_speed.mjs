// tests/sdp-update/phase1_speed.mjs — times the SDP Checklist calculation before / after (TEST data only, in a private copy of the database).
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const oldDef = fs.readFileSync("supabase_migration_sdp_show_total_credits_over_required.sql", "utf8");
const s0 = oldDef.indexOf("create or replace function public._sdp_period_totals(");
await db.query(oldDef.slice(s0, oldDef.indexOf("$$;", s0) + 3).replace("public._sdp_period_totals(", "public._sdp_period_totals_old("));
await db.query("set session_replication_role = replica");   // fake scholars are only IDs here; skip the link checks
await db.query("delete from sdp_attendance"); 
const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
const cats = ["community_service", "community_volunteerism", "formation_program"];
const acts = [];
for (let i = 0; i < 90; i++) acts.push((await q(`insert into sdp_activities (name, category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
  values ($1, $2, 'one_time', now(), 1, true, 'o', 'v', ${EMPTY}, '[]'::jsonb) returning id`, ["TEST – speed " + i, cats[i % 3]]))[0].id);
const periods = [["2024-2025", "1st Semester"], ["2024-2025", "2nd Semester"], ["2024-2025", "Summer"], ["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"]];
let loaded = 0;
async function loadTo(n) {
  for (let p = 0; p < periods.length; p++) {
    await db.query(`insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number)
      select ($1::uuid[])[1 + ((s * 7 + k * 13 + $4) % 90)], 'P-' || lpad(s::text, 5, '0'), current_date, $2, $3, 1000 + $4 * 10 + k
      from generate_series($5::int, $6::int) s cross join generate_series(0, 2) k on conflict do nothing`, [acts, periods[p][0], periods[p][1], p, loaded + 1, n]);
  }
  loaded = n;
}
const time = async sql => { const t = performance.now(); const r = await q(sql); return { ms: Math.round(performance.now() - t), n: r.length, r }; };
for (const n of [1544, 3000, 8000]) {
  await loadTo(n);
  const rows = Number((await q("select count(*) c from sdp_attendance"))[0].c);
  const newer = await time("select * from public._sdp_period_totals('2025-2026', '2nd Semester') order by 1, 2");
  let line = `${n} scholars, ${rows} credit rows: NEW ${newer.ms} ms (${newer.n} totals)`;
  if (n <= 3000) {
    const older = await time("select * from public._sdp_period_totals_old('2025-2026', '2nd Semester') order by 1, 2");
    line += ` | OLD ${older.ms} ms | identical: ${JSON.stringify(older.r) === JSON.stringify(newer.r)}`;
  } else line += " | OLD not run (would take many minutes)";
  console.log(line);
}
