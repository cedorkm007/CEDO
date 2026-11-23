// tests/sdp-credited-scholars/db_tests.mjs — SDP Monitoring > an activity > Credited Scholars (supabase_migration_sdp_credited_scholars_paging.sql): the credits and the not-credited scholars in PAGES (nothing cut off at 1,000),
// the numbers, crediting only the ticked scholars with the SAME rules as "Credit these scholars", moving credits together, the fast scholar search, the undo (5 checks)
// Run:  node tests/sdp-credited-scholars/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_credited_scholars_paging.sql", UNDO = "undo_sdp_credited_scholars_paging.sql";
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
const ACT = seedId("act:cs3");      // a one-time Community Service activity of the demo
const summary = (uid = SEAD) => attempt(uid, "select * from public.sdp_credited_summary($1)", [ACT]);
const page = (a = {}, uid = SEAD) => attempt(uid, "select * from public.sdp_credited_page($1, $2, $3, $4, $5, $6, $7, $8, $9)", [ACT, a.search ?? "", a.sy ?? null, a.sem ?? null, a.none ?? false, a.sort ?? "date", a.dir ?? "desc", a.limit ?? 25, a.offset ?? 0]);
const notCredited = (a = {}, uid = SEAD) => attempt(uid, "select * from public.sdp_not_credited_page($1, $2, $3, $4)", [ACT, a.search ?? "", a.limit ?? 25, a.offset ?? 0]);

// the data: 1,150 credits (two semesters + some without a semester), and 60 present + 8 waiting-for-the-survey scholars with no credit (two of the present ones have a saved credit), one of them removed
const periods = await q("select school_year, term from academic_periods order by school_year desc, term limit 2");
const [P1, P2] = periods;
const cur = (await q("select current_school_year sy, current_semester sem from grading_period_settings where id = true"))[0];
await q("delete from sdp_attendance where activity_id = $1", [ACT]);
await q("delete from attendance_sessions where sdp_activity_id = $1", [ACT]);
await q("set session_replication_role = replica");
await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
         select gen_random_uuid(), 'CR-' || lpad(g::text, 5, '0'), case when g = 7 then 'JUAN' else 'CRTEST' end, case when g = 7 then 'IBAñEZ' else 'Credit' || lpad(g::text, 5, '0') end, 'T', '2005-05-05', 'cr' || g || '@demo.local', '09170000000', 'Test School', 'BS Test', case when g = 1220 then 'Removed' else 'Regular' end, 'B', '2nd Year', '1', 'S', 'C', 'P', 'Philippines', '0000', 'G', 'Parent', '09170000001'
         from generate_series(1, 1220) g`);
await q(`insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester, created_by)
         select $1, 'CR-' || lpad(g::text, 5, '0'), date '2026-11-01' - (g % 60), 1, case when g % 10 = 0 then null else case when g % 3 = 0 then $4 else $2 end end, case when g % 10 = 0 then null else case when g % 3 = 0 then $5 else $3 end end, $6
         from generate_series(1, 1150) g`, [ACT, P1.school_year, P1.term, P2.school_year, P2.term, SEAD]);
const SESSION = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, created_by) values ($1, 'voucher', 100, $2) returning id", [ACT, SEAD]))[0].id;
await q(`insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count, updated_at)
         select $1, 'CR-' || lpad(g::text, 5, '0'), 1, case when g between 1211 and 1218 then 'pending_survey' else 'present' end, 1, '2026-11-02T10:00:00+08:00' from generate_series(1151, 1220) g`, [SESSION]);
await q(`insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count) select $1, 'CR-' || lpad(g::text, 5, '0'), 1, 'present', 1 from generate_series(1, 5) g`, [SESSION]);      // present AND credited: not in "Not credited"
await q("insert into sdp_reserved_credits (scholar_id_number, category, amount) values ('CR-01151', 'community_service', 1), ('CR-01152', 'community_service', 1)");
await q("set session_replication_role = origin");
const category = (await q("select category from sdp_activities where id = $1", [ACT]))[0].category;

// 1. only the people who may credit this activity
const denied = await Promise.all([summary(PLAIN), page({}, PLAIN), notCredited({}, PLAIN), attempt(PLAIN, "select public.sdp_credit_selected($1, array['CR-01153'])", [ACT]), attempt(PLAIN, "select public.sdp_move_credits_semester(array[(select id from sdp_attendance where activity_id = $1 limit 1)], $2, $3)", [ACT, P1.school_year, P1.term]), attempt(PLAIN, "select * from public.sdp_search_scholars('cred', $1, 10)", [ACT])]);
const ok = await summary();
check("1 only the staff who may credit this activity can see its credits, the scholars who are not credited, credit or move credits, or use the scholar search; SEAD staff can",
  denied.every(r => !r.ok && /not allowed/i.test(r.msg)) && ok.ok, JSON.stringify(denied.map(r => r.msg)));

// 2. the numbers and the pages: all 1,150 credits (more than the 1,000 a single request can return), each once, true total, semesters, search, sort
const s = ok.rows[0];
const seen = new Set(), totals = new Set(); let pages = 0, ordered = true, prev = null;
for (let off = 0; ; off += 50) {
  const r = await page({ limit: 50, offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.id); totals.add(String(x.total_count)); const d = new Date(x.attended_date).getTime(); if (prev !== null && d > prev) ordered = false; prev = d; });
  if (r.rows.length < 50) break;
}
const semOnly = await page({ sy: P1.school_year, sem: P1.term, limit: 1 }), none = await page({ none: true, limit: 1 });
const expP1 = Number((await q("select count(*)::int n from sdp_attendance where activity_id = $1 and school_year = $2 and semester = $3", [ACT, P1.school_year, P1.term]))[0].n), expNone = Number((await q("select count(*)::int n from sdp_attendance where activity_id = $1 and school_year is null", [ACT]))[0].n);
const byId = await page({ search: "cr-00500" }), byName = await page({ search: "credit00123" }), reversed = await page({ search: "credit00123 crtest" }), pct = await page({ search: "100%" });
const nameAsc = (await page({ sort: "name", dir: "asc", limit: 30 })).rows, expNames = (await q("select x.id from sdp_attendance x join scholars sc on sc.scholar_id_number = x.scholar_id_number where x.activity_id = $1 order by lower(sc.last_name), lower(sc.first_name), x.attended_date desc, x.id limit 30", [ACT])).map(r => r.id);
check("2 the credits come in pages (1,150 in all, more than the 1,000 a single request can return), each once, newest first, with the true total on every page; the numbers for the buttons and the semesters are right; the search finds a scholar by Scholar ID or name (either order; '%' is just a letter); the semester filter, 'no semester' and the sort by name work in the database",
  Number(s.credited_count) === 1150 && Number(s.scholar_count) === 1150 && seen.size === 1150 && pages === 23 && totals.size === 1 && [...totals][0] === "1150" && ordered
  && Number(semOnly.rows[0].total_count) === expP1 && Number(none.rows[0].total_count) === expNone && expNone > 0 && s.semesters.reduce((n, x) => n + x.n, 0) === 1150 && s.semesters.length === 3
  && byId.rows.length === 1 && byName.rows.length === 1 && reversed.rows.length === 1 && pct.rows.length === 0 && JSON.stringify(nameAsc.map(r => r.id)) === JSON.stringify(expNames),
  `${s.credited_count} ${seen.size} ${pages} ${[...totals]} ${ordered} p1 ${semOnly.rows[0]?.total_count}/${expP1} none ${none.rows[0]?.total_count}/${expNone} ${JSON.stringify(s.semesters)}`);

// 3. the scholars who attended but have no credit: the count, the reasons, who can be credited, the pages and the search
const nc = (await notCredited({ limit: 100 })).rows, ncSearch = await notCredited({ search: "CR-01215" }), p1 = (await notCredited({ limit: 25 })).rows, p2 = (await notCredited({ limit: 25, offset: 25 })).rows;
const reason = id => nc.find(r => r.scholar_id_number === id)?.reason_code;
check("3 'Not credited' lists the 70 scholars who attended without a credit (the 5 who are credited are not in it), 25 a page with the true total, with the reason (waiting for the survey, credit saved for later, no credit recorded), and says who can be credited (present, not removed, the activity has a category); the search works",
  category && Number(s.not_credited_count) === 70 && Number(s.creditable_count) === 61 && nc.length === 70 && Number(nc[0].total_count) === 70 && p1.length === 25 && p2.length === 25 && new Set([...p1, ...p2].map(r => r.scholar_id_number)).size === 50
  && reason("CR-01215") === "survey" && reason("CR-01151") === "banked" && reason("CR-01153") === "missing" && nc.find(r => r.scholar_id_number === "CR-01215").can_credit === false && nc.find(r => r.scholar_id_number === "CR-01153").can_credit === true
  && nc.find(r => r.scholar_id_number === "CR-01220").can_credit === false && ncSearch.rows.length === 1 && ncSearch.rows[0].attendance_status === "pending_survey", `${s.not_credited_count} ${s.creditable_count} ${nc.length} ${reason("CR-01215")} ${reason("CR-01151")} ${reason("CR-01153")}`);

// 4. crediting only the ticked scholars follows the same rules as "Credit these scholars"; moving several credits together
const before = Number((await q("select count(*)::int n from sdp_attendance where activity_id = $1", [ACT]))[0].n);
const some = await attempt(SEAD, "select public.sdp_credit_selected($1, array['CR-01153', 'CR-01154', 'CR-01215', 'CR-01220', 'CR-00001', 'NOT-A-SCHOLAR'])", [ACT]);      // 2 can be credited; waiting-for-survey, removed, already credited, unknown are left alone
const again = await attempt(SEAD, "select public.sdp_credit_selected($1, array['CR-01153', 'CR-01154'])", [ACT]);
const all = await attempt(SEAD, "select public.credit_attended_scholars($1)", [ACT]);      // the existing button, for the rest
const c1 = (await q("select school_year, semester, created_by, activity_day, occurrence_number, attended_date from sdp_attendance where activity_id = $1 and scholar_id_number = 'CR-01153'", [ACT]))[0];
const c2 = (await q("select school_year, semester, created_by, activity_day, occurrence_number, attended_date from sdp_attendance where activity_id = $1 and scholar_id_number = 'CR-01160'", [ACT]))[0];
const hist = Number((await q("select count(*)::int n from sdp_credit_history where activity_id = $1 and source = 'credit_attended' and scholar_id_number in ('CR-01153', 'CR-01154', 'CR-01160')", [ACT]))[0].n);
const ids = (await q("select id from sdp_attendance where activity_id = $1 and scholar_id_number in ('CR-00001', 'CR-00002', 'CR-00004') order by scholar_id_number", [ACT])).map(r => r.id);
const moved = await attempt(SEAD, "select public.sdp_move_credits_semester($1::uuid[], $2, $3) n", [ids, P2.school_year, P2.term]), movedAgain = await attempt(SEAD, "select public.sdp_move_credits_semester($1::uuid[], $2, $3) n", [ids, P2.school_year, P2.term]);
const badPeriod = await attempt(SEAD, "select public.sdp_move_credits_semester($1::uuid[], '1999-2000', '1st Semester')", [ids]);
const moveHist = Number((await q("select count(*)::int n from sdp_credit_history where activity_id = $1 and source = 'semester_move' and event_type = 'credit_changed' and scholar_id_number in ('CR-00001', 'CR-00002', 'CR-00004')", [ACT]))[0].n);
const after = (await summary()).rows[0];
check("4 'Credit selected' credits only the ticked scholars who can be credited (2 of 6: a scholar waiting for the survey, a removed one, one who is already credited and an unknown ID are left alone), never twice, and gives the credit EXACTLY like 'Credit these scholars' (same semester, staff member, day and history line); several credits move to another semester together with one history line each (a second time moves nothing, an unknown semester is refused)",
  some.ok && Number(some.rows[0].sdp_credit_selected) === 2 && Number(again.rows[0].sdp_credit_selected) === 0 && all.ok && Number(all.rows[0].credit_attended_scholars) === 59 && c1.school_year === c2.school_year && c1.semester === c2.semester && c1.created_by === c2.created_by === true
  && c1.created_by === SEAD && c1.occurrence_number === c2.occurrence_number && String(c1.attended_date) === String(c2.attended_date) && String(c1.activity_day) === String(c2.activity_day) && hist === 3
  && Number((await q("select count(*)::int n from sdp_attendance where activity_id = $1", [ACT]))[0].n) === before + 61 && moved.ok && Number(moved.rows[0].n) === 3 && Number(movedAgain.rows[0].n) === 0 && !badPeriod.ok && /not on record/i.test(badPeriod.msg) && moveHist === 3
  && Number(after.not_credited_count) === 9 && Number(after.creditable_count) === 0, `${JSON.stringify(some.rows ?? some.msg)} ${JSON.stringify(all.rows ?? all.msg)} c1 ${JSON.stringify(c1)} c2 ${JSON.stringify(c2)} hist ${hist} moveHist ${moveHist} after ${after.not_credited_count}/${after.creditable_count}`);

// 5. the scholar search, the indexes, and the undo (the existing credit functions, every credit and every history line stay)
const sr1 = await attempt(SEAD, "select * from public.sdp_search_scholars('crtest credit0012', $1, 10)", [ACT]), sr2 = await attempt(SEAD, "select * from public.sdp_search_scholars('credit00120 crtest', $1, 10)", [ACT]), sr3 = await attempt(SEAD, "select * from public.sdp_search_scholars('cr-0010', $1, 10)", [ACT]);
const none2 = await attempt(SEAD, "select * from public.sdp_search_scholars('   ', $1, 10)", [ACT]), big = await attempt(SEAD, "select * from public.sdp_search_scholars('cr', $1, 500)", [ACT]);
const idx = Number((await q("select count(*)::int n from pg_indexes where indexname in ('sdp_attendance_activity_date_idx', 'sdp_attendance_activity_period_idx', 'scholars_full_name_trgm_idx', 'scholars_full_name_rev_trgm_idx')"))[0].n);
const creditsBefore = Number((await q("select count(*)::int n from sdp_attendance"))[0].n), histBefore = Number((await q("select count(*)::int n from sdp_credit_history"))[0].n);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.sdp_credited_summary(uuid)') a, to_regprocedure('public.sdp_credited_page(uuid,text,text,text,boolean,text,text,integer,integer)') b, to_regprocedure('public.sdp_not_credited_page(uuid,text,integer,integer)') c, to_regprocedure('public.sdp_credit_selected(uuid,text[],text,text)') d, to_regprocedure('public.sdp_search_scholars(text,uuid,integer)') e, to_regprocedure('public.credit_attended_scholars(uuid,text,text)') old1, to_regprocedure('public.move_sdp_credit_semester(uuid,text,text)') old2"))[0];
const idxAfter = Number((await q("select count(*)::int n from pg_indexes where indexname in ('sdp_attendance_activity_date_idx', 'sdp_attendance_activity_period_idx', 'scholars_full_name_trgm_idx', 'scholars_full_name_rev_trgm_idx')"))[0].n);
check("5 the scholar search matches the Scholar ID and the name written either way and gives at most 10 (25 at the very most), nothing for an empty search; the four indexes exist; after the undo the new functions and indexes are gone while the existing credit functions, every credit and every history line stay",
  sr1.ok && sr1.rows.length > 0 && sr2.rows.length === 1 && sr3.rows.length > 0 && sr3.rows.length <= 10 && none2.rows.length === 0 && big.rows.length === 25 && idx === 4
  && gone.a === null && gone.b === null && gone.c === null && gone.d === null && gone.e === null && gone.old1 !== null && gone.old2 !== null && idxAfter === 0
  && Number((await q("select count(*)::int n from sdp_attendance"))[0].n) === creditsBefore && Number((await q("select count(*)::int n from sdp_credit_history"))[0].n) === histBefore, `${sr1.rows?.length} ${sr2.rows?.length} ${sr3.rows?.length} ${big.rows?.length} idx ${idx} ${JSON.stringify(gone)}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
