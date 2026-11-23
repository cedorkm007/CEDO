// tests/sdp-eligible/db_tests.mjs — SDP Monitoring > Credited Scholars > Not credited > "Eligible, did not attend" (supabase_migration_sdp_eligible_did_not_attend.sql): who is eligible (year level, barangay, cluster), who is left out,
// pages with nothing cut off at 1,000, the activities with no eligible list, the undo (5 checks)
// Run:  node tests/sdp-eligible/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_eligible_did_not_attend.sql", UNDO = "undo_sdp_eligible_did_not_attend.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain");
const ACT = seedId("act:cs3"), OTHER = seedId("act:cv3"), OPEN = seedId("act:coastal");
const summary = (act, uid = SEAD) => attempt(uid, "select * from public.sdp_eligible_summary($1)", [act]);
const page = (act, a = {}, uid = SEAD) => attempt(uid, "select * from public.sdp_eligible_did_not_attend_page($1, $2, $3, $4)", [act, a.search ?? "", a.limit ?? 25, a.offset ?? 0]);

// the activity: for 2nd-year scholars of the barangay Bugo, or of any barangay of cluster A (Bugo, Puerto, Agusan, Balubal, Tablon)
await q("update sdp_activities set all_year_levels = false, target_year_levels = array['2nd Year'], target_barangays = array['Bugo'], target_clusters = array['A'], submitted_by_scholar_id = null where id = $1", [ACT]);
await q("delete from sdp_attendance where activity_id = $1", [ACT]); await q("delete from attendance_sessions where sdp_activity_id = $1", [ACT]);
await q("set session_replication_role = replica");
const mk = (prefix, from, to, year, barangay, status = "Regular") => q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
  select gen_random_uuid(), '${prefix}-' || lpad(g::text, 5, '0'), 'ELTEST', 'Eligible' || lpad(g::text, 5, '0'), 'T', '2005-05-05', '${prefix}' || g || '@demo.local', '09170000000', 'Test School', 'BS Test', $1, $2, $3, '1', 'S', 'C', 'P', 'Philippines', '0000', 'G', 'Parent', '09170000001' from generate_series(${from}, ${to}) g`, [status, barangay, year]);
await mk("EL", 1, 600, "2nd Year", "Bugo");           // eligible: the chosen barangay
await mk("EL", 601, 1200, "2nd Year", "Balubal");     // eligible: a barangay of the chosen cluster A
await mk("EX", 1, 50, "1st Year", "Bugo");            // not eligible: another year level
await mk("EY", 1, 50, "2nd Year", "Lumbia");          // not eligible: another cluster (B)
await mk("EZ", 1, 10, "2nd Year", null);              // not eligible: a limited activity, no barangay on file
await mk("EW", 1, 5, "2nd Year", "Bugo", "Removed");  // left out: removed
const SESSION = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, created_by) values ($1, 'voucher', 100, $2) returning id", [ACT, SEAD]))[0].id;
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) select $1, 'EL-' || lpad(g::text, 5, '0'), '2026-11-01', 1, '2026-2027', '1st Semester' from generate_series(1, 10) g", [ACT]);   // credited
await q("insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count) select $1, 'EL-' || lpad(g::text, 5, '0'), 1, case when g <= 20 then 'present' when g <= 25 then 'pending_survey' else 'incomplete' end, 1 from generate_series(11, 32) g", [SESSION]);   // 10 present, 5 waiting for the survey, 7 scanned once
await q("insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count) select $1, 'EX-' || lpad(g::text, 5, '0'), 1, 'present', 1 from generate_series(1, 3) g", [SESSION]);   // attended without being eligible: not in this list either (they are in the other list)
await q("set session_replication_role = origin");
await q("update sdp_activities set submitted_by_scholar_id = 'TEST-0001' where id = $1", [OTHER]);

// 1. only the people who may credit this activity; an activity a scholar submitted has no eligible list
const denied = await Promise.all([summary(ACT, PLAIN), page(ACT, {}, PLAIN)]);
const sub = await summary(OTHER), subPage = await page(OTHER);
check("1 only the staff who may credit the activity can see the eligible list; an activity a scholar submitted is not open to others, so the list is 'not applicable' (0, empty)",
  denied.every(r => !r.ok && /not allowed/i.test(r.msg)) && sub.ok && sub.rows[0].applicable === false && Number(sub.rows[0].eligible_count) === 0 && subPage.ok && subPage.rows.length === 0 && (await summary(ACT)).rows[0].applicable === true, JSON.stringify(denied.map(r => r.msg)));

// 2. the rule: year level AND (barangay OR cluster); credited, present, waiting-for-survey and removed scholars are left out; someone who scanned once and never finished is included and marked
const s = (await summary(ACT)).rows[0];
const all = (await page(ACT, { limit: 100 })).rows, one = new Set();
for (let off = 0; ; off += 100) { const r = await page(ACT, { limit: 100, offset: off }); if (!r.ok || r.rows.length === 0) break; r.rows.forEach(x => one.add(x.scholar_id_number)); if (r.rows.length < 100) break; }
const has = id => one.has(id), status = async id => (await page(ACT, { search: id })).rows[0]?.attendance_status;
check("2 the eligible scholars are those of the year level AND of a chosen barangay OR a barangay of a chosen cluster (1,200); those with a credit (10), marked present (10) or waiting for the survey (5), the other year level, the other cluster, no barangay on file and Removed scholars are left out; the 7 who scanned once and never finished are in, marked (1,175 in all)",
  s.applicable === true && Number(s.eligible_count) === 1175 && one.size === 1175 && has("EL-00040") && has("EL-00700") && has("EL-01200") && !has("EL-00001") && !has("EL-00015") && !has("EL-00023") && !has("EX-00001") && !has("EY-00001") && !has("EZ-00001") && !has("EW-00001")
  && has("EL-00030") && (await status("EL-00030")) === "incomplete" && (await status("EL-00040")) === null && all.length === 100, `${s.eligible_count} ${one.size}`);

// 3. nothing is cut off at 1,000: the pages together give all 1,175, each once, name order, the true total on every page, fields, search, clamp
const seen = new Set(), totals = new Set(); let pages = 0, last = "", ordered = true;
for (let off = 0; ; off += 100) {
  const r = await page(ACT, { limit: 100, offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.scholar_id_number); totals.add(String(x.total_count)); const k = (x.last_name + " " + x.first_name).toLowerCase(); if (k < last) ordered = false; last = k; });
  if (r.rows.length < 100) break;
}
const byId = await page(ACT, { search: "el-00700" }), byName = await page(ACT, { search: "eligible00701" }), reversed = await page(ACT, { search: "eligible00702 eltest" }), pct = await page(ACT, { search: "100%" }), big = await page(ACT, { limit: 5000 });
check("3 the eligible list comes in pages (1,175 in all, more than the 1,000 a single request can return), each scholar once, in name order, with the true total on every page; the search finds a scholar by Scholar ID or name (either order; '%' is just a letter); each row has year level, barangay and school; one request never gives more than 100",
  seen.size === 1175 && pages === 12 && totals.size === 1 && [...totals][0] === "1175" && ordered && byId.rows.length === 1 && byId.rows[0].year_level === "2nd Year" && byId.rows[0].barangay === "Balubal" && byId.rows[0].school === "Test School"
  && byName.rows.length === 1 && reversed.rows.length === 1 && pct.rows.length === 0 && big.rows.length === 100, `${seen.size} ${pages} ${[...totals]} ${ordered}`);

// 4. the other ways an activity can be limited: no limit at all (every scholar who is not removed, has no credit and did not attend), a cluster only, all year levels
await q("update sdp_activities set all_year_levels = true, target_year_levels = '{}', target_barangays = '{}', target_clusters = '{}' where id = $1", [OPEN]);
await q("update sdp_activities set submitted_by_scholar_id = null where id = $1", [OPEN]);
// an independent count: not removed, no credit for the activity, not marked present or waiting for the survey (the demo's own credits and attendance of this activity stay as they are)
const NOT_ATTENDED = "and not exists (select 1 from sdp_attendance c where c.activity_id = $1 and c.scholar_id_number = scholars.scholar_id_number) and not exists (select 1 from attendance_sessions ses join attendance_records r on r.session_id = ses.id where ses.sdp_activity_id = $1 and r.scholar_id_number = scholars.scholar_id_number and r.status in ('present', 'pending_survey'))";
const expOpen = Number((await q(`select count(*)::int n from scholars where status <> 'Removed' ${NOT_ATTENDED}`, [OPEN]))[0].n);
const openSum = (await summary(OPEN)).rows[0];
await q("update sdp_activities set all_year_levels = false, target_year_levels = array['2nd Year'], target_barangays = '{}', target_clusters = array['B'] where id = $1", [OPEN]);
const expB = Number((await q(`select count(*)::int n from scholars where status <> 'Removed' and year_level = '2nd Year' and public.cdo_cluster_of_barangay(barangay) = 'B' ${NOT_ATTENDED}`, [OPEN]))[0].n);
const clusterSum = (await summary(OPEN)).rows[0];
await q("update sdp_activities set all_year_levels = true, target_year_levels = '{}', target_barangays = '{}', target_clusters = array['A'] where id = $1", [OPEN]);
const expAllYearsA = Number((await q(`select count(*)::int n from scholars where status <> 'Removed' and public.cdo_cluster_of_barangay(barangay) = 'A' ${NOT_ATTENDED}`, [OPEN]))[0].n);
const allYearsSum = (await summary(OPEN)).rows[0];
check("4 an activity with no limit is open to every scholar who is not removed; a cluster-only limit means the 2nd-year scholars of that cluster; 'all year levels' with a cluster means that cluster's scholars of every year (each number equals an independent count of the scholars table)",
  Number(openSum.eligible_count) === expOpen && expOpen > 1000 && Number(clusterSum.eligible_count) === expB && expB === 50 && Number(allYearsSum.eligible_count) === expAllYearsA && expAllYearsA > 1200, `${openSum.eligible_count}/${expOpen} ${clusterSum.eligible_count}/${expB} ${allYearsSum.eligible_count}/${expAllYearsA}`);

// 5. the undo: the three functions go, the credit functions of the earlier update and every record stay
const credits = Number((await q("select count(*)::int n from sdp_attendance"))[0].n), scholars = Number((await q("select count(*)::int n from scholars"))[0].n);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.sdp_eligible_summary(uuid)') a, to_regprocedure('public.sdp_eligible_did_not_attend_page(uuid,text,integer,integer)') b, to_regprocedure('public._sdp_eligible_did_not_attend(uuid)') c, to_regprocedure('public.sdp_credited_summary(uuid)') d, to_regprocedure('public.sdp_not_credited_page(uuid,text,integer,integer)') e"))[0];
check("5 after the undo the three eligible-list functions are gone while the Credited Scholars functions of the earlier update, every credit and every scholar stay",
  gone.a === null && gone.b === null && gone.c === null && gone.d !== null && gone.e !== null && Number((await q("select count(*)::int n from sdp_attendance"))[0].n) === credits && Number((await q("select count(*)::int n from scholars"))[0].n) === scholars, JSON.stringify(gone));
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
