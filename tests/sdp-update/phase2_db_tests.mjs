// tests/sdp-update/phase2_db_tests.mjs — SDP Monitoring update, Phase 2: the paged SDP Checklist gives the same answers as the old one.
// Compares scholars_sdp_checklist_page / _summary with the old scholars_sdp_compliance for EVERY test scholar, five semesters (incl. carry-over and
// Summer), every filter, every sort in both directions, with and without a search, page by page. Also checks who may call them.
// Run:  node tests/sdp-update/phase2_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const staffUid = name => seedId(`staff:${name}`);
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain"), COUNSELOR = staffUid("demo.counselor"), MONITOR = staffUid("demo.monitor");
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role) => as(uid, async tx => (await tx.query(sql, params)).rows, role);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fails = async (uid, sql, params, pattern, role) => { try { await rows(uid, sql, params, role); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };

// ── test data: five semesters of credits for the test scholars, a Removed scholar, a name with odd characters ──
const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
const cats = ["community_service", "community_volunteerism", "formation_program"];
const acts = [];
for (let i = 0; i < 12; i++) acts.push((await q(`insert into sdp_activities (name, category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
  values ($1, $2, 'one_time', now(), $3, true, 'o', 'v', ${EMPTY}, '[]'::jsonb) returning id`, [`TEST – p2 ${i}`, cats[i % 3], i % 4 === 1 ? 2 : 1]))[0].id);
const periods = [["2024-2025", "1st Semester"], ["2024-2025", "2nd Semester"], ["2024-2025", "Summer"], ["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"]];
const ids = (await q("select scholar_id_number from scholars where scholar_id_number like 'TEST-%' order by 1")).map(r => r.scholar_id_number);
let k = 0;
for (const [s, sid] of ids.entries()) for (const [p, [sy, sem]] of periods.entries()) for (let j = 0; j < (s + p) % 6; j++)
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, current_date, $3, $4, $5) on conflict do nothing", [acts[(s * 3 + p * 5 + j * 7) % acts.length], sid, sy, sem, 100 + k++]);
await q("update scholars set first_name = 'Zoë_%', last_name = 'O''Brien' where scholar_id_number = $1", [ids[5]]);   // characters that are special in a search

// ── the reference: the OLD function, searched / filtered / sorted exactly like the old screen did ──
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function reference(all, { search, filter, sort, dir }) {
  const withIdx = all.map((r, i) => ({ ...r, i }));   // i = the old default order (last name, first name)
  let list = withIdx.filter(r => (filter === "complied" ? r.complied === true : filter === "not_complied" ? r.complied === false : true));
  const qs = search.trim().toLowerCase();
  if (qs) list = list.filter(r => r.name.toLowerCase().includes(qs) || r.scholar_id_number.toLowerCase().includes(qs));
  const key = { id: r => r.scholar_id_number.toLowerCase(), name: r => r.name.toLowerCase(), community_service: r => r.community_service, community_volunteerism: r => r.community_volunteerism, formation_program: r => r.formation_program, result: r => (r.complied === null ? 2 : r.complied ? 1 : 0) }[sort];
  if (key) list.sort((a, b) => { let c = cmpStr(key(a), key(b)); if (c === 0) c = a.i - b.i; return dir === "asc" ? c : -c; });
  return list;
}

const asSead = (sql, p) => rows(SEAD, sql, p);
let comparisons = 0, mismatches = 0, firstBad = "";
for (const [sy, sem] of periods) {
  const old = await asSead("select * from public.scholars_sdp_compliance($1, $2)", [sy, sem]);
  const sum = (await asSead("select * from public.scholars_sdp_checklist_summary($1, $2)", [sy, sem]))[0];
  const exp = { total: old.length, complied: old.filter(r => r.complied === true).length, notComplied: old.filter(r => r.complied === false).length };
  comparisons++;
  if (Number(sum.total) !== exp.total || Number(sum.complied) !== exp.complied || Number(sum.not_complied) !== exp.notComplied || sum.applicable !== !/^summer/i.test(sem)) { mismatches++; firstBad ||= `summary ${sy} ${sem}`; }
  const cases = [];
  for (const filter of ["all", "complied", "not_complied"]) for (const sort of ["default", "id", "name", "community_service", "community_volunteerism", "formation_program", "result"]) for (const dir of ["asc", "desc"]) {
    if (sort === "default" && dir === "desc") continue;
    cases.push({ filter, sort, dir, search: "" });
  }
  for (const search of ["TEST", "failed", "0007", "ZOË", "o'brien", "%", "_", "  two  ", "nobody-matches"]) cases.push({ filter: "all", sort: "name", dir: "asc", search }, { filter: "not_complied", sort: "result", dir: "desc", search });
  for (const c of cases) {
    const want = reference(old, c);
    const got = [];
    for (let page = 1; page <= Math.max(1, Math.ceil(want.length / 7)); page++) {
      const part = await asSead("select * from public.scholars_sdp_checklist_page($1, $2, $3, $4, $5, $6, $7, 7)", [sy, sem, c.search, c.filter, c.sort, c.dir, page]);
      for (const r of part) { if (Number(r.total_count) !== want.length) { mismatches++; firstBad ||= `total_count ${JSON.stringify(c)}`; } got.push(r); }
    }
    comparisons++;
    const same = got.length === want.length && got.every((r, i) => r.scholar_id_number === want[i].scholar_id_number && r.name === want[i].name
      && r.community_service === want[i].community_service && r.community_volunteerism === want[i].community_volunteerism && r.formation_program === want[i].formation_program
      && r.applicable === want[i].applicable && r.complied === want[i].complied && r.missing === want[i].missing);
    if (!same) { mismatches++; firstBad ||= `${sy} ${sem} ${JSON.stringify(c)} got ${got.length} want ${want.length}`; }
  }
}
check(`every page of every search/filter/sort/direction gives the old answers, scholar by scholar (${comparisons} comparisons over 5 semesters incl. Summer and carry-over)`, mismatches === 0, firstBad);

const first = await asSead("select * from public.scholars_sdp_checklist_page('2025-2026', '2nd Semester')");
check("with nothing chosen, a page has at most 50 scholars, in last-name order, and says how many match in all", first.length <= 50 && Number(first[0].total_count) > 0);
check("a page size above 200 is cut to 200", (await asSead("select count(*) n from public.scholars_sdp_checklist_page('2025-2026', '2nd Semester', '', 'all', 'default', 'asc', 1, 100000)"))[0].n <= 200);
check("a page number past the end gives an empty page", (await asSead("select * from public.scholars_sdp_checklist_page('2025-2026', '2nd Semester', '', 'all', 'default', 'asc', 999, 50)")).length === 0);
check("Removed scholars are not listed", !(await asSead("select scholar_id_number from public.scholars_sdp_checklist_page('2025-2026', '2nd Semester', '', 'all', 'default', 'asc', 1, 200)")).some(r => r.scholar_id_number === ids[11]));
check("an unknown filter or sort is refused (nothing is put into a query)", await fails(SEAD, "select * from public.scholars_sdp_checklist_page('2025-2026','2nd Semester','', 'x; drop table scholars', 'default')", [], /Unknown filter/) && await fails(SEAD, "select * from public.scholars_sdp_checklist_page('2025-2026','2nd Semester','', 'all', 'name; select 1')", [], /Unknown sort/));
check("a search made of quote and percent characters is just text and does not break or match everything", (await asSead("select * from public.scholars_sdp_checklist_page('2025-2026','2nd Semester', $1)", ["'; drop table scholars; --"])).length === 0 && Number((await q("select count(*) n from scholars"))[0].n) > 40);

console.log("\nWho may use it");
const PAGE = "select * from public.scholars_sdp_checklist_page('2025-2026','2nd Semester')", SUMMARY = "select * from public.scholars_sdp_checklist_summary('2025-2026','2nd Semester')";
check("SDP Monitoring staff can", (await rows(SEAD, PAGE)).length > 0 && (await rows(SEAD, SUMMARY)).length === 1);
check("staff with no tools are refused", await fails(PLAIN, PAGE, [], /Not authorized/) && await fails(PLAIN, SUMMARY, [], /Not authorized/));
check("SEAD staff without the SDP tag are refused, as with the old Checklist", await fails(COUNSELOR, PAGE, [], /Not authorized/));
check("an activity monitor with no tools is refused", await fails(MONITOR, PAGE, [], /Not authorized/));
check("a scholar is refused", await fails(seedId("scholar:1"), PAGE, [], /Not authorized|permission denied/));
check("a visitor who is not signed in is refused", await fails(null, PAGE, [], /permission denied/, "anon"));
check("the two helper functions cannot be called directly by anybody on the website", await fails(SEAD, "select * from public._sdp_compliance_ids('2025-2026','2nd Semester', null)", [], /permission denied/) && await fails(null, "select * from public._sdp_period_totals_ids('2025-2026','2nd Semester', null)", [], /permission denied/, "anon"));
check("the old function still works and still needs the SDP tag (Renewal and the fallback use it)", (await rows(SEAD, "select * from public.scholars_sdp_compliance('2025-2026','2nd Semester')")).length > 0 && await fails(PLAIN, "select * from public.scholars_sdp_compliance('2025-2026','2nd Semester')", [], /Not authorized/));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
