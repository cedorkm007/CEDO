// tests/sdp-year-level/db_tests.mjs — the SDP Checklist's Year column and year level filter (supabase_migration_sdp_checklist_year_level.sql), 5 checks, short on purpose
// Run:  node tests/sdp-year-level/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_checklist_year_level.sql", UNDO = "undo_sdp_checklist_year_level.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain");
const num = n => `TEST-${String(n).padStart(4, "0")}`;
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe

const Y = "2031-2032", SEM = "1st Semester";
await q("update grading_period_settings set current_school_year = $1, current_semester = $2 where id = true", [Y, SEM]);
const act = (await q("insert into sdp_activities(category, credits, all_year_levels) values ('community_service', 1, true) returning id"))[0].id;
// 41 (1st Year) and 44 (3rd Year) comply; 42 and 43 (both 2nd Year, written in two ways) do not
await q("update scholars set year_level = '1st Year' where scholar_id_number = $1", [num(41)]);
await q("update scholars set year_level = '2nd Year' where scholar_id_number = $1", [num(42)]);
await q("update scholars set year_level = ' 2nd year ' where scholar_id_number = $1", [num(43)]);
await q("update scholars set year_level = '3rd Year' where scholar_id_number = $1", [num(44)]);
await q("update scholars set year_level = '' where scholar_id_number = $1", [num(45)]);
for (const n of [41, 44]) for (const cat of ["community_service", "community_volunteerism", "formation_program"]) {
  const a = cat === "community_service" ? act : (await q("insert into sdp_activities(category, credits, all_year_levels) values ($1, 1, true) returning id", [cat]))[0].id;
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) select $1, $2, current_date, g, $3, $4 from generate_series(1, 3) g", [a, num(n), Y, SEM]);
}
// search "test-004" = the made-up scholars TEST-0040 to TEST-0049 only (small and predictable); no search = everyone (page of 200)
const page = (search = "test-004", sort = "default", dir = "asc", filter = "all", year = null) => attempt(SEAD, `select * from public.scholars_sdp_checklist_page($1, $2, $3, $4, $5, $6, 1, 200${year ? ", $7" : ""})`, year ? [Y, SEM, search, filter, sort, dir, year] : [Y, SEM, search, filter, sort, dir]);

// 1. each row has the scholar's year level; the Year column sorts by the number (1st, 2nd, 3rd; none last); only SDP Monitoring staff may ask
const all = await page();
const mine = (all.rows ?? []).filter(r => [41, 42, 43, 44, 45].map(num).includes(r.scholar_id_number));
const byYear = await page("test-004", "year", "asc"), byYearDesc = await page("test-004", "year", "desc");
const order = r => r.rows.filter(x => [41, 42, 43, 44, 45].map(num).includes(x.scholar_id_number)).map(x => x.scholar_id_number);
const plain = await attempt(PLAIN, "select * from public.scholars_sdp_checklist_page($1, $2)", [Y, SEM]);
check("1 each row carries the scholar's year level; sorting by Year goes 1st, 2nd, 3rd (no year level last) and back; only SDP Monitoring staff may ask",
  mine.length === 5 && mine.find(r => r.scholar_id_number === num(41)).year_level === "1st Year" && order(byYear)[0] === num(41) && order(byYear).slice(1, 3).sort().join() === [num(42), num(43)].join() && order(byYear)[3] === num(44) && order(byYear)[4] === num(45) && order(byYearDesc)[0] === num(45) && order(byYearDesc).slice(1, 4).includes(num(44)) && !plain.ok && /Not authorized/.test(plain.msg),
  `${order(byYear)} | ${plain.msg}`);

// 2. the year level filter (capitals and spaces do not matter) works on the whole list, and the total_count follows it
const second = await page("", "default", "asc", "all", "2nd Year");   // no search: everyone of that year level (up to 200 on the page)
const expected = Number((await q("select count(*)::int n from scholars where status <> 'Removed' and lower(btrim(year_level)) = '2nd year'"))[0].n);
check("2 the year level filter shows only that year level (however it is written), and total_count is the number of scholars of that year level",
  second.ok && second.rows.length === Math.min(expected, 200) && expected >= 2 && second.rows.every(r => r.year_level.trim().toLowerCase() === "2nd year") && Number(second.rows[0].total_count) === expected, `${second.rows?.length} vs ${expected} ${second.msg ?? ""}`);

// 3. the year level filter together with Complied / Not complied (the way that needs everyone's result)
const compl = await page("test-004", "default", "asc", "complied", "1st Year"), notc = await page("test-004", "default", "asc", "not_complied", "2nd Year");
check("3 the year level filter combines with Complied / Not complied: a complied 1st Year scholar is in the first, the two 2nd Year scholars with no credits are in the second",
  compl.ok && compl.rows.some(r => r.scholar_id_number === num(41)) && compl.rows.every(r => r.complied === true && r.year_level === "1st Year") && notc.ok && [42, 43].every(n => notc.rows.some(r => r.scholar_id_number === num(n))) && notc.rows.every(r => r.complied === false), `${compl.msg} ${notc.msg}`);

// 4. the counts above the list follow the year level; with no year level they are the same as before; the credits and results are exactly what they were
const sAll = (await attempt(SEAD, "select * from public.scholars_sdp_checklist_summary($1, $2)", [Y, SEM])).rows[0];
const s3 = (await attempt(SEAD, "select * from public.scholars_sdp_checklist_summary($1, $2, '3rd Year')", [Y, SEM])).rows[0];
const direct = (await q("select count(*)::int n, count(*) filter (where c.complied is true)::int ok from public._sdp_compliance_saved($1, $2) c", [Y, SEM]))[0];
const pageRow = all.rows.find(r => r.scholar_id_number === num(41)), savedRow = (await q("select * from public._sdp_compliance_saved($1, $2) c where c.scholar_id_number = $3", [Y, SEM, num(41)]))[0];
check("4 the three counts follow the year level (all, complied, not complied add up) and are unchanged with no year level; a scholar's credits and result are exactly the same as the Checklist's own calculation",
  Number(sAll.total) === direct.n && Number(sAll.complied) === direct.ok && Number(s3.total) >= 1 && Number(s3.complied) + Number(s3.not_complied) === Number(s3.total) && Number(s3.total) < Number(sAll.total)
  && pageRow.complied === savedRow.complied && pageRow.community_service === savedRow.community_service && pageRow.complied === true, JSON.stringify([sAll, s3, direct]));

// 5. the undo brings the earlier page back (no Year column, no year filter)
await db.exec(read(UNDO));
const old = await attempt(SEAD, "select * from public.scholars_sdp_checklist_page($1, $2, '', 'all', 'default', 'asc', 1, 5)", [Y, SEM]);
const gone = (await q("select to_regprocedure('public.scholars_sdp_checklist_page(text,text,text,text,text,text,integer,integer,text)') f"))[0].f;
check("5 after the undo the Checklist page is as before (no Year column, no year level question) and the results are the same", old.ok && !("year_level" in old.rows[0]) && gone === null && old.rows.length === 5);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
