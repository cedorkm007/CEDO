// tests/sdp-update/phase2_speed.mjs — times the paged Checklist at your size (TEST data only, in a private copy of the database).
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
const SCHOLARS = Number(process.argv[2] || 8000);
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
await db.query("set session_replication_role = replica");
await db.query("delete from sdp_attendance");
await db.query(`insert into scholars select (jsonb_populate_record(null::scholars, to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'scholar_id_number', 'P-' || lpad(n::text, 5, '0'), 'email', 'p' || n || '@x.local', 'first_name', 'Fn' || n, 'last_name', 'Ln' || (n % 500), 'qr_token', gen_random_uuid(), 'status', case when n % 97 = 0 then 'Removed' else 'Regular' end))).* from scholars t, generate_series(1, ${SCHOLARS}) n where t.scholar_id_number = 'TEST-0001'`);
const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
const cats = ["community_service", "community_volunteerism", "formation_program"];
const acts = [];
for (let i = 0; i < 90; i++) acts.push((await q(`insert into sdp_activities (name, category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
  values ($1, $2, 'one_time', now(), 1, true, 'o', 'v', ${EMPTY}, '[]'::jsonb) returning id`, ["TEST – speed " + i, cats[i % 3]]))[0].id);
const periods = [["2024-2025", "1st Semester"], ["2024-2025", "2nd Semester"], ["2024-2025", "Summer"], ["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"]];
for (let p = 0; p < periods.length; p++) await db.query(`insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number)
  select ($1::uuid[])[1 + ((s * 7 + k * 13 + $4) % 90)], 'P-' || lpad(s::text, 5, '0'), current_date, $2, $3, 1000 + $4 * 10 + k
  from generate_series(1, ${SCHOLARS}) s cross join generate_series(0, 2) k on conflict do nothing`, [acts, periods[p][0], periods[p][1], p]);
await db.query("analyze");
await db.query("set session_replication_role = origin");
const SEAD = seedId("staff:demo.sead");
const rows = async (sql, p = []) => db.transaction(async tx => {
  await tx.exec("set local role authenticated");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [SEAD, JSON.stringify({ sub: SEAD, role: "authenticated" })]);
  return (await tx.query(sql, p)).rows;
});
const time = async (label, sql, p = []) => { const s = performance.now(); const r = await rows(sql, p); const ms = Math.round(performance.now() - s); console.log(label.padEnd(58), String(ms).padStart(6), "ms", `(${r.length} rows)`); return ms; };
const n = Number((await q("select count(*) n from scholars where status <> 'Removed'"))[0].n), c = Number((await q("select count(*) n from sdp_attendance"))[0].n);
console.log(`${n} scholars, ${c} credit rows\n`);
const Y = "'2025-2026', '2nd Semester'";
await time("OLD way: every scholar's result (what the screen downloaded)", `select * from public.scholars_sdp_compliance(${Y})`);
await time("NEW: first page (nothing chosen)", `select * from public.scholars_sdp_checklist_page(${Y})`);
await time("NEW: page 40 of the list", `select * from public.scholars_sdp_checklist_page(${Y}, '', 'all', 'default', 'asc', 40, 50)`);
await time("NEW: search for a name", `select * from public.scholars_sdp_checklist_page(${Y}, 'ln12', 'all', 'default', 'asc', 1, 50)`);
await time("NEW: sorted by name, Z to A", `select * from public.scholars_sdp_checklist_page(${Y}, '', 'all', 'name', 'desc', 1, 50)`);
await time("NEW: the three counts (loads after the page appears)", `select * from public.scholars_sdp_checklist_summary(${Y})`);
await time("NEW: filter 'Not complied' (works out everyone)", `select * from public.scholars_sdp_checklist_page(${Y}, '', 'not_complied', 'default', 'asc', 1, 50)`);
await time("NEW: sorted by a credit column (works out everyone)", `select * from public.scholars_sdp_checklist_page(${Y}, '', 'all', 'formation_program', 'desc', 1, 50)`);
await time("NEW: first page, Summer", `select * from public.scholars_sdp_checklist_page('2024-2025', 'Summer')`);
