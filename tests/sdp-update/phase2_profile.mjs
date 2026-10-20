// Profiling helper (TEST data only): where does the time go in the Checklist calculation at ~8,000 scholars?
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
await db.query("set session_replication_role = replica");
await db.query("delete from sdp_attendance");
const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
const cats = ["community_service", "community_volunteerism", "formation_program"];
const acts = [];
for (let i = 0; i < 90; i++) acts.push((await q(`insert into sdp_activities (name, category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
  values ($1, $2, 'one_time', now(), 1, true, 'o', 'v', ${EMPTY}, '[]'::jsonb) returning id`, ["TEST – speed " + i, cats[i % 3]]))[0].id);
const periods = [["2024-2025", "1st Semester"], ["2024-2025", "2nd Semester"], ["2024-2025", "Summer"], ["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"]];
for (let p = 0; p < periods.length; p++) await db.query(`insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number)
  select ($1::uuid[])[1 + ((s * 7 + k * 13 + $4) % 90)], 'P-' || lpad(s::text, 5, '0'), current_date, $2, $3, 1000 + $4 * 10 + k
  from generate_series(1, 8000) s cross join generate_series(0, 2) k on conflict do nothing`, [acts, periods[p][0], periods[p][1], p]);
await db.query("analyze sdp_attendance"); await db.query("analyze sdp_activities");
const t = async (label, sql) => { const s = performance.now(); const r = await q(sql); console.log(label.padEnd(46), Math.round(performance.now() - s), "ms", r.length, "rows"); return r; };
await t("totals (current function)", "select * from public._sdp_period_totals('2025-2026','2nd Semester')");
await t("earned only (join+group)", `select x.scholar_id_number, x.category, x.school_year, x.semester, sum(x.amt) from (select a.scholar_id_number, act.category, a.school_year, a.semester, act.credits::int amt from sdp_attendance a join sdp_activities act on act.id=a.activity_id where a.school_year is not null and act.category is not null) x group by 1,2,3,4`);
await t("count(*) sdp_attendance", "select count(*) from sdp_attendance");
await t("scholars count", "select count(*) from scholars");
const plan = await q("explain (analyze, costs off, timing on) select * from public._sdp_period_totals('2025-2026','2nd Semester')");
console.log(plan.map(r => r["QUERY PLAN"]).join("\n").slice(0, 3000));
console.log("---- work_mem experiments");
for (const wm of ["4MB", "64MB", "256MB"]) { await db.query(`set work_mem = '${wm}'`); await t(`totals with work_mem ${wm}`, "select * from public._sdp_period_totals('2025-2026','2nd Semester')"); await t(`earned only, work_mem ${wm}`, `select a.scholar_id_number, act.category, a.school_year, a.semester, sum(act.credits::int) from sdp_attendance a join sdp_activities act on act.id=a.activity_id where a.school_year is not null and act.category is not null group by 1,2,3,4`); }
