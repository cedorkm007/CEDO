// tests/sdp-credited-filters/db_tests.mjs — SDP Monitoring > Credited Scholars: filters that combine (cross matching) with option counts, the list read in pages for the Export,
// the import (check, then save) and the undo (supabase_migration_sdp_credited_filters_import.sql)   (5 checks)
// Run:  node tests/sdp-credited-filters/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_credited_filters_import.sql", UNDO = "undo_sdp_credited_filters_import.sql";
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
const ACT = seedId("act:cs3"), REC = seedId("act:coastal");
const period = (await q("select current_school_year sy, current_semester sem from grading_period_settings where id = true"))[0];
const J = o => JSON.stringify(o);
const OTHER = period.sem === "2nd Semester" ? "1st Semester" : "2nd Semester";
const facets = (a = {}, uid = SEAD, act = ACT) => attempt(uid, "select public.sdp_credited_facets($1, $2, $3::jsonb, $4) f", [act, a.side ?? "credited", J(a.filters ?? {}), a.search ?? ""]);
const list = (a = {}, uid = SEAD) => attempt(uid, "select * from public.sdp_credited_list($1, $2::jsonb, $3, $4, $5, $6, $7)", [ACT, J(a.filters ?? {}), a.search ?? "", a.sort ?? "date", a.dir ?? "desc", a.limit ?? 25, a.offset ?? 0]);
const summary = (a = {}) => attempt(SEAD, "select * from public.sdp_credited_summary_f($1, $2::jsonb, $3)", [ACT, J(a.filters ?? {}), a.search ?? ""]);
const notList = (a = {}) => attempt(SEAD, "select * from public.sdp_not_credited_list($1, $2, $3::jsonb, $4, $5, $6)", [ACT, a.kind ?? "attended", J(a.filters ?? {}), a.search ?? "", a.limit ?? 25, a.offset ?? 0]);
const facet = (f, dim) => Object.fromEntries((f[dim] ?? []).map(o => [o.v, Number(o.n)]));

// fixture: an open one-time activity; 1,500 scholars: year level 1st/2nd/3rd in turn, school Alpha/Beta, barangay Bugo / Lumbia; 1,200 credited (800 scan, 300 by hand, 100 in the next semester)
await q("update sdp_activities set all_year_levels = true, target_year_levels = '{}', target_barangays = '{}', target_clusters = '{}', submitted_by_scholar_id = null, credits = 1 where id = $1", [ACT]);
await q("delete from sdp_attendance where activity_id = $1", [ACT]); await q("delete from attendance_sessions where sdp_activity_id = $1", [ACT]);
await q("set session_replication_role = replica");
await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, contact_no, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
  select gen_random_uuid(), 'FT-' || lpad(g::text, 5, '0'), 'FTEST', 'Filter' || lpad(g::text, 5, '0'), 'T', '2005-05-05', 'ft' || g || '@demo.local', '09170000000', case when g % 2 = 0 then 'Alpha University' else 'Beta College' end,
         case when g % 3 = 0 then 'BS Nursing' else 'BS Biology' end, 'Regular', case when g % 5 = 0 then 'Lumbia' else 'Bugo' end, case g % 3 when 0 then '1st Year' when 1 then '2nd Year' else '3rd Year' end,
         '1', 'S', 'C', 'P', 'Philippines', '0000', 'G', 'Parent', '09170000001' from generate_series(1, 1500) g`);
await q(`insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester, created_by)
  select $1, 'FT-' || lpad(g::text, 5, '0'), date '2026-10-01' + (g % 40), 1, $2, case when g <= 1100 then $3 else '${OTHER}' end, case when g % 4 = 0 then $4::uuid else null end from generate_series(1, 1200) g`, [ACT, period.sy, period.sem, SEAD]);
await q("set session_replication_role = origin");
const SESSION = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, created_by) values ($1, 'voucher', 100, $2) returning id", [ACT, SEAD]))[0].id;
await q("set session_replication_role = replica");
await q("insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count) select $1, 'FT-' || lpad(g::text, 5, '0'), 1, case when g <= 1210 then 'present' else 'pending_survey' end, 1 from generate_series(1201, 1230) g", [SESSION]);   // 10 present, 20 waiting for the survey
await q("set session_replication_role = origin");

// 1. only staff who may credit; filters inside one group mean "any of", different groups "all of"; the options' numbers follow the OTHER filters; search works together
const denied = await Promise.all([facets({}, PLAIN), list({}, PLAIN)]);
const exp = async (where) => Number((await q(`select count(*)::int n from sdp_attendance x join scholars s on s.scholar_id_number = x.scholar_id_number where x.activity_id = $1 ${where}`, [ACT]))[0].n);
const f12 = (await list({ filters: { year: ["1st Year", "2nd Year"] }, limit: 5 })).rows[0], both = await list({ filters: { year: ["1st Year", "2nd Year"], school: ["Alpha University"], how: ["manual"] }, limit: 500 });
const expBoth = await exp("and s.year_level in ('1st Year','2nd Year') and s.school = 'Alpha University' and x.created_by is not null");
const fc = (await facets({ filters: { year: ["1st Year"], school: ["Alpha University"] } })).rows[0].f;
const yearOpts = facet(fc, "year"), schoolOpts = facet(fc, "school");
const expYearOpt2 = await exp("and s.year_level = '2nd Year' and s.school = 'Alpha University'");     // the year options follow the school filter, not the year filter itself
const expSchoolBeta = await exp("and s.year_level = '1st Year' and s.school = 'Beta College'");        // the school options follow the year filter
const searched = await list({ filters: { year: ["1st Year"] }, search: "filter00003" });
check("1 only the staff who may credit can use it; 'any of' inside a filter, 'all of' between filters (year 1st or 2nd + Alpha + by hand = the independent count); each option's number follows the OTHER filters (not its own); the search works together; the summary follows the filters",
  denied.every(r => !r.ok && /not allowed/i.test(r.msg)) && Number(f12.total_count) === await exp("and s.year_level in ('1st Year','2nd Year')") && both.rows.length === expBoth && expBoth > 0 && Number(both.rows[0].total_count) === expBoth
  && yearOpts["2nd Year"] === expYearOpt2 && schoolOpts["Beta College"] === expSchoolBeta && schoolOpts["Beta College"] > 0 && searched.rows.length === 1 && searched.rows[0].scholar_id_number === "FT-00003"
  && Number((await summary({ filters: { year: ["1st Year"] } })).rows[0].credited_count) === await exp("and s.year_level = '1st Year'"), `${f12?.total_count} ${both.rows.length}/${expBoth} ${J(yearOpts)} ${J(schoolOpts)}`);

// 2. more than 1,000: pages of 500 give every matching credit once (the Export), the true total on each page, semester / date / how-credited filters, the not-credited reasons
const seen = new Set(); let ordered = true, last = "", totals = new Set(), pages = 0;
for (let off = 0; ; off += 500) {
  const r = await list({ limit: 500, offset: off, sort: "name", dir: "asc" });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.id); totals.add(String(x.total_count)); const k = (x.last_name + " " + x.first_name).toLowerCase(); if (k < last) ordered = false; last = k; });
  if (r.rows.length < 500) break;
}
const secondSem = await list({ filters: { semester: [`${period.sy}|${OTHER}`] }, limit: 500 }), dated = await list({ filters: { from: "2026-10-10", to: "2026-10-12" }, limit: 500 });
const expDated = await exp("and x.attended_date between '2026-10-10' and '2026-10-12'");
const how = facet((await facets({})).rows[0].f, "how");
const nc = (await facets({ side: "not_credited" })).rows[0].f, ncReasons = facet(nc, "reason");
const ncSurvey = await notList({ filters: { reason: ["survey"] }, limit: 100 }), ncDay = await notList({ filters: { reason: ["missing"] }, limit: 100 });
check("2 more than 1,000 credits come in pages of 500 (1,200 in all), each once, name order, the true total on every page; the semester, date-range and how-credited filters match the independent counts (scan 900 / by hand 300); the not-credited side has its own reasons (10 'no credit recorded', 20 'waiting for the survey') that filter the list",
  seen.size === 1200 && pages === 3 && totals.size === 1 && [...totals][0] === "1200" && ordered && secondSem.rows.length === 100 && dated.rows.length === expDated && expDated > 0
  && how.scan === 900 && how.manual === 300 && ncReasons.survey === 20 && ncReasons.missing === 10 && ncSurvey.rows.length === 20 && ncDay.rows.length === 10 && Number(ncSurvey.rows[0].total_count) === 20, `${seen.size} ${pages} ${[...totals]} ${secondSem.rows.length} ${dated.rows.length}/${expDated} ${J(how)} ${J(ncReasons)}`);

// 3. IMPORT, step 1 (check): nothing is saved; valid / warning / error with the reason; matched by Scholar ID only; no double credit
const before = Number((await q("select count(*)::int n from sdp_attendance where activity_id = $1", [ACT]))[0].n);
const rows = [
  { i: 1, scholar_id: "FT-01300", date: "2026-11-02", date_text: "2026-11-02" },                                                  // valid
  { i: 2, scholar_id: "FT-01301", date: "2026-11-02", date_text: "2026-11-02", school_year: period.sy, semester: OTHER },     // warning: other semester
  { i: 3, scholar_id: "FT-99999", date: "2026-11-02", date_text: "2026-11-02" },                                                  // error: not found
  { i: 4, scholar_id: "FT-01302", date: null, date_text: "" },                                                                    // error: date missing
  { i: 5, scholar_id: "FT-01303", date: null, date_text: "31/31/2026" },                                                          // error: invalid
  { i: 6, scholar_id: "FT-01304", date: "2026-11-02", date_text: "x", school_year: "1999-2000", semester: "1st Semester" },        // error: semester not found
  { i: 7, scholar_id: "FT-00010", date: "2026-11-02", date_text: "x" },                                                           // warning: already credited, skipped
  { i: 8, scholar_id: "FT-01300", date: "2026-11-03", date_text: "x" },                                                           // warning: duplicate in the file
  { i: 9, scholar_id: "FILTER01305", date: "2026-11-02", date_text: "x" },                                                        // error: a name is not an ID
];
const chk = await attempt(SEAD, "select public.sdp_import_check($1, $2::jsonb, null, null) r", [ACT, J(rows)]), deniedImp = await attempt(PLAIN, "select public.sdp_import_check($1, $2::jsonb, null, null) r", [ACT, J(rows)]);
const byI = chk.ok ? Object.fromEntries(chk.rows[0].r.rows.map(r => [r.i, r])) : {}, say = i => (byI[i]?.messages ?? []).join(" | ");
check("3 the check saves nothing; each row is valid / warning / error with its reason: ID not found, date missing, invalid date, semester not found, a name instead of an ID, a different semester (warning), already credited (skipped, warning), a duplicate in the file (skipped, warning); only the staff who may credit can check; more than 2,000 rows are refused",
  chk.ok && !deniedImp.ok && byI[1]?.state === "valid" && byI[2]?.state === "warning" && /different/i.test(say(2)) && byI[3]?.state === "error" && /ID not found/i.test(say(3)) && /missing/i.test(say(4)) && /not a valid/i.test(say(5)) && /Semester not found/i.test(say(6))
  && byI[7]?.state === "warning" && byI[7].skip === true && /already has/i.test(say(7)) && byI[8].skip === true && /Duplicate/i.test(say(8)) && byI[9]?.state === "error"
  && chk.rows[0].r.valid === 1 && chk.rows[0].r.error === 5 && chk.rows[0].r.will_credit === 2 && before === Number((await q("select count(*)::int n from sdp_attendance where activity_id = $1", [ACT]))[0].n)
  && !(await attempt(SEAD, "select public.sdp_import_check($1, $2::jsonb, null, null)", [ACT, J(Array.from({ length: 2001 }, (_, k) => ({ i: k + 1, scholar_id: "FT-00001", date: "2026-11-02" })))])).ok, `${J(chk.msg ?? Object.values(byI).map(r => r.i + r.state))}`);

// 4. IMPORT, step 2 (save): only what passes is credited, never twice (run again = nothing new), the history says "import" (who and when), How credited = import in the list and filter; a recurring activity goes through the day rules
const save = await attempt(SEAD, "select public.sdp_import_save($1, $2::jsonb, null, null) r", [ACT, J(rows)]), again = await attempt(SEAD, "select public.sdp_import_save($1, $2::jsonb, null, null) r", [ACT, J(rows)]);
const hist = await q("select source, actor_name, school_year, semester from sdp_credit_history where activity_id = $1 and scholar_id_number in ('FT-01300','FT-01301') order by scholar_id_number", [ACT]);
const imp = await list({ filters: { how: ["import"] }, limit: 50 }), impFacet = facet((await facets({})).rows[0].f, "how");
const days = await q("select day::text d, sid, sub_name from public._sdp_schedule_days($1) order by ord", [REC]);
const rrows = [{ i: 1, scholar_id: "FT-00001", date: days[0].d, date_text: "x" }, { i: 2, scholar_id: "FT-00002", date: "2020-01-01", date_text: "x" }, { i: 3, scholar_id: "FT-00003", date: days[1].d, date_text: "x", day_sub: "no such day" }];
const rsave = await attempt(SEAD, "select public.sdp_import_save($1, $2::jsonb, null, null) r", [REC, J(rrows)]);
const rhist = await q("select source, occurrence_number from sdp_credit_history where activity_id = $1 and scholar_id_number = 'FT-00001'", [REC]), rcredit = await q("select activity_day::text d from sdp_attendance where activity_id = $1 and scholar_id_number = 'FT-00001'", [REC]);
check("4 the save credits the valid rows (2 of the 9), skips the 2 that already exist or repeat and refuses the 5 errors; saving the same file again credits nobody; the history says 'import' with the staff member and the semester; the list shows How credited = import and the filter finds them; a recurring activity is credited on its session day through the same rules (a date that is not a session day, or an unknown session name, are refused)",
  save.ok && save.rows[0].r.credited === 2 && save.rows[0].r.skipped === 2 && save.rows[0].r.errors === 5 && again.ok && again.rows[0].r.credited === 0 && hist.length === 2 && hist.every(h => h.source === "import" && h.actor_name)
  && hist.find(h => h.semester === OTHER) && imp.rows.length === 2 && imp.rows.every(r => r.how === "import") && impFacet.import === 2
  && rsave.ok && rsave.rows[0].r.credited === 1 && rsave.rows[0].r.errors === 2 && rhist.length === 1 && rhist[0].source === "import" && rcredit.length === 1 && rcredit[0].d === days[0].d, `${J(save.rows?.[0]?.r ?? save.msg)} ${J(again.rows?.[0]?.r ?? again.msg)} ${J(hist)} ${imp.rows?.length} ${J(rsave.rows?.[0]?.r ?? rsave.msg)}`);

// 5. the undo: the new functions go, the earlier functions, every credit, scholar and history line stay
const counts = async () => [Number((await q("select count(*)::int n from sdp_attendance"))[0].n), Number((await q("select count(*)::int n from scholars"))[0].n), Number((await q("select count(*)::int n from sdp_credit_history"))[0].n)];
const c1 = await counts();
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.sdp_credited_facets(uuid,text,jsonb,text)') a, to_regprocedure('public.sdp_import_save(uuid,jsonb,text,text)') b, to_regprocedure('public.sdp_credited_list(uuid,jsonb,text,text,text,integer,integer)') c, to_regprocedure('public._sdp_ok(sdp_list_row,text,jsonb,text,text)') d, to_regprocedure('public.sdp_credited_page(uuid,text,text,text,integer,integer,text,text)') e, to_regprocedure('public.sdp_eligible_summary(uuid)') f, to_regtype('public.sdp_list_row') g"))[0];
const c2 = await counts();
check("5 after the undo the filter, list, option-count and import functions and the helper type are gone (twice is fine) while the functions of the earlier updates, every credit, scholar and history line stay",
  gone.a === null && gone.b === null && gone.c === null && gone.d === null && gone.g === null && gone.f !== null && c1.join() === c2.join(), `${J(gone)} ${c1} ${c2}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
