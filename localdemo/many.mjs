// localdemo/many.mjs — adds a crowd of made-up TEST scholars with SDP credits over five semesters, so the SDP Checklist can be tried at a realistic size.
// Used by  npm run demo:many  (8,000 scholars) and by the speed test. They cannot sign in; they only fill the lists. Everything is TEST data.
export async function addManyScholars(db, count = 8000) {
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  await db.query("set session_replication_role = replica");   // the made-up scholars have no sign-in account: skip the link checks for these rows only
  await db.query(`insert into scholars select (jsonb_populate_record(null::scholars, to_jsonb(t) || jsonb_build_object(
      'id', gen_random_uuid(), 'scholar_id_number', 'TEST-C' || lpad(n::text, 5, '0'), 'email', 'crowd' || n || '@demo.local', 'first_name', 'TEST', 'last_name', 'Crowd ' || lpad(n::text, 5, '0'),
      'qr_token', gen_random_uuid(), 'status', case when n % 97 = 0 then 'Removed' else 'Regular' end))).*
    from scholars t, generate_series(1, ${Number(count)}) n where t.scholar_id_number = 'TEST-0001'`);
  const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
  const cats = ["community_service", "community_volunteerism", "formation_program"];
  const acts = [];
  for (let i = 0; i < 90; i++) {
    acts.push((await q(`insert into sdp_activities (name, category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
      values ($1, $2, 'one_time', now(), 1, true, 'o', 'v', ${EMPTY}, '[]'::jsonb) returning id`, [`TEST – Crowd activity ${i + 1}`, cats[i % 3]]))[0].id);
  }
  const periods = [["2024-2025", "1st Semester"], ["2024-2025", "2nd Semester"], ["2024-2025", "Summer"], ["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"]];
  for (let p = 0; p < periods.length; p++) {
    await db.query(`insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number)
      select ($1::uuid[])[1 + ((s * 7 + k * 13 + $4) % 90)], 'TEST-C' || lpad(s::text, 5, '0'), current_date, $2, $3, 1000 + $4 * 10 + k
      from generate_series(1, ${Number(count)}) s cross join generate_series(0, 2) k on conflict do nothing`, [acts, periods[p][0], periods[p][1], p]);
  }
  await db.query("analyze");
  await db.query("set session_replication_role = origin");
}
