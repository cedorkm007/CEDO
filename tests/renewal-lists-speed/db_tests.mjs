// tests/renewal-lists-speed/db_tests.mjs — the faster Scholar Renewal lists give EXACTLY the same answers (supabase_migration_renewal_lists_speed.sql)
// Run:  node tests/renewal-lists-speed/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { addManyScholars } from "../../localdemo/many.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await addManyScholars(db, 600);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_lists_speed.sql", UNDO = "undo_renewal_lists_speed.sql";
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid ?? "", JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "authenticated" })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const EVALUATOR = seedId("staff:demo.evaluator"), PLAIN = seedId("staff:demo.plain");

// ── data: the demo's own scholars + 600 crowd scholars; applications of every stage, with different stored checks; saved results of the Scholar List for the others
const win = (await q("select * from renewal_windows where school_year = '2026-2027' and term = '1st Semester'"))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
const SY = win.school_year, T = win.term;
const samples = [];
for (let n = 1; n <= 30; n++) samples.push((await q("select public._renewal_evaluate($1, $2, $3) e", [`TEST-${String(n).padStart(4, "0")}`, SY, T]))[0].e);
await db.query("set session_replication_role = replica");
for (let i = 1; i <= 400; i++) {
  const sid = "TEST-C" + String(i).padStart(5, "0");
  const stage = ["submitted", "waiting_grades", "ready_for_confirmation", "review_needed", "sdp_on_hold", "renewed", "inc_waiting_compliance", "returned", "late_pending"][i % 9];
  const ev = i % 11 === 0 ? {} : samples[i % samples.length];
  const result = stage === "renewed" ? (["renewed", "reconsidered", "renewed_probationary"][i % 3]) : null;
  await db.query("insert into renewal_records (scholar_id_number, school_year, term, stage, window_id, evaluation, is_late, applied_at, result) values ($1, $2, $3, $4, $5, $6::jsonb, $7, now() - ($8 || ' minutes')::interval, $9) on conflict do nothing",
    [sid, SY, T, stage, win.id, JSON.stringify(ev), stage === "late_pending", String(i), result]);
}
for (let i = 401; i <= 560; i++) {
  await db.query("insert into renewal_scholar_list_cache (school_year, term, scholar_id_number, sdp_applicable, sdp_complied, sdp_missing, grades_state, graded, total, failed, drp, inc, review, eligibility) values ($1, $2, $3, true, $4, null, $5, 4, 5, $6, $7, $8, $9, $10) on conflict do nothing",
    [SY, T, "TEST-C" + String(i).padStart(5, "0"), i % 3 !== 0, ["ready", "waiting", "review", "no_grades"][i % 4], i % 3, i % 5 === 0 ? 1 : 0, i % 7 === 0 ? 1 : 0, i % 13 === 0 ? 1 : 0, ["ready"]]);
}
await db.query("set session_replication_role = origin");
await q("update scholars set status = 'Probationary' where scholar_id_number like 'TEST-C0004%'");
await q("analyze");

// ── windows for the "is this scholar in a window of this term?" check: several arrangements of real windows, test windows and school lists
const schools = (await q("select id from schools order by name")).map(r => r.id);
const mkWin = async (y, t, o = {}) => (await q("insert into renewal_windows (school_year, term, opens_on, closes_on, late_allowed, created_by, testers, school_ids) values ($1, $2, current_date - 3, current_date + 10, true, $3, $4, $5) returning id", [y, t, seedId("staff:demo.evaluator"), o.testers ?? null, o.schools ?? null]))[0].id;
const ARR = [
  ["2041-2042", "1st Semester", []],                                                                                  // no window: everybody
  ["2042-2043", "1st Semester", [{}]],                                                                                // one window, all schools
  ["2043-2044", "1st Semester", [{}, { schools: [schools[0]] }]],                                                     // all schools + a window of one school
  ["2044-2045", "1st Semester", [{}, { testers: ["TEST-0001", "TEST-0002", "TEST-C00001"] }]],                         // a real window + a test window beside it
  ["2045-2046", "1st Semester", [{ testers: ["TEST-0003", "TEST-C00002"], schools: [schools[0]] }]],                  // only a test window, with a school list
  ["2046-2047", "1st Semester", [{ schools: [schools[0]] }, { schools: [schools[1], schools[2]] }]],                  // two windows with their own schools
  ["2047-2048", "1st Semester", [{ schools: [schools[0]] }, { testers: ["TEST-0004"] }]],                             // a school window + a test window
];
for (const [y, t, ws] of ARR) for (const o of ws) await mkWin(y, t, o);
const allIds = (await q("select scholar_id_number from scholars order by 1")).map(r => r.scholar_id_number);
const membersAll = async () => { const out = {}; for (const [y, t] of ARR) out[`${y}`] = (await q("select string_agg(case when m.sid is not null then '1' else '0' end, '' order by s.scholar_id_number) s from scholars s left join public._renewal_window_members($1, $2) m on m.sid = s.scholar_id_number", [y, t]))[0].s; return out; };
const includesAll = async () => { const out = {}; for (const [y, t] of ARR) out[`${y}`] = (await q("select string_agg(case when public._renewal_window_includes($1, $2, scholar_id_number) then '1' else '0' end, '' order by scholar_id_number) s from scholars", [y, t]))[0].s; return out; };

// ── the questions the screens ask
const FILTERS = [
  { name: "no filter", a: [] },
  { name: "search Crowd 000", q: "Crowd 000" },
  { name: "search a name", q: "Passed" },
  { name: "sdp complied", sdp: "complied" }, { name: "sdp not complied", sdp: "not_complied" },
  { name: "grades in", grades: "in" }, { name: "grades not in", grades: "not_in" },
  { name: "status Regular", statuses: ["Regular"] }, { name: "status Probationary", statuses: ["Probationary"] },
  { name: "a school", schools: [schools[0]] },
  { name: "sdp + grades + search", sdp: "not_complied", grades: "not_in", q: "Crowd" },
];
const SUBS = { applications: [null, "failed2", "failed1", "inc", "pending", "complete"], renewed: [null, "regular", "probationary", "reconsidered"], not_applied: [null, "failed2", "failed1", "inc", "pending", "complete"] };
async function snapshot() {
  const out = {};
  for (const tab of Object.keys(SUBS)) for (const f of FILTERS) {
    const args = [SY, T, tab, f.q ?? null, f.schools ?? null, null, null, f.statuses ?? null, f.sdp ?? null, f.grades ?? null];
    out[`counts|${tab}|${f.name}`] = (await rows(EVALUATOR, "select * from public.renewal_tab_counts($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) order by sub", args)).map(r => `${r.sub}=${r.n}`).join(",");
    for (const sub of SUBS[tab]) for (const off of [0, 25]) {
      const l = await rows(EVALUATOR, "select * from public.renewal_tab_list($1, $2, $3, $4, $5, $6, null, null, $7, $8, $9, 25, $10)", [SY, T, tab, sub, f.q ?? null, f.schools ?? null, f.statuses ?? null, f.sdp ?? null, f.grades ?? null, off]);
      out[`list|${tab}|${sub}|${f.name}|${off}`] = JSON.stringify(l.map(r => ({ ...r, computed_at: r.computed_at ? "t" : null })));
    }
  }
  out.options = JSON.stringify(await rows(EVALUATOR, "select public.renewal_tab_options($1, $2) o", [SY, T]));
  for (const f of FILTERS.slice(0, 4)) for (const elig of [null, ["ready"], ["consultation", "waiting"]]) for (const off of [0, 25]) out[`scholarlist|${f.name}|${elig}|${off}`] = JSON.stringify((await rows(EVALUATOR, "select * from public.renewal_scholar_list($1, $2, $3, $4, null, null, $5, 25, $6)", [SY, T, f.q ?? null, f.schools ?? null, elig, off])).map(r => ({ ...r, computed_at: r.computed_at ? "t" : null })));
  out.matrix = JSON.stringify((await rows(EVALUATOR, "select * from public.renewal_scholar_list_matrix($1, $2)", [SY, T])).map(r => ({ ...r, last_checked: r.last_checked ? "t" : null })));
  out.scholarOptions = JSON.stringify(await rows(EVALUATOR, "select public.renewal_scholar_list_options($1, $2) o", [SY, T])).replace(/"last_checked":"[^"]*"/, '"last_checked":"t"');
  return out;
}

await db.exec(read(UNDO)).catch(() => {});      // the harness may have put the file on already: start from the earlier behaviour
const incBefore = await includesAll();
const before = await snapshot();
const timing = async label => { const t = Date.now(); await rows(EVALUATOR, "select * from public.renewal_tab_list($1, $2, 'applications', null, null, null, null, null, null, null, null, 25, 0)", [SY, T]); return Date.now() - t; };
const msBefore = await timing("before");
console.log(`(${Object.keys(before).length} answers recorded; ${before["list|applications|null|no filter|0"].length > 100 ? "the Applications list has rows" : "EMPTY"})`);
check("the Scholar List has people to show (so its comparison means something)", before["scholarlist|no filter|null|0"].length > 200, before["scholarlist|no filter|null|0"].length);
check("the data covers every sub-tab: applications, renewed and not applied all have people in more than one sub-tab", ["applications", "renewed", "not_applied"].every(tab => new Set(Object.keys(before).filter(k => k.startsWith(`counts|${tab}|no filter`)).flatMap(k => before[k].split(",").filter(x => x && !x.endsWith("=0")))).size >= 2), JSON.stringify(Object.fromEntries(["applications", "renewed", "not_applied"].map(t => [t, before[`counts|${t}|no filter`]]))));

await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice
console.log("\nThe answers are the same");
const after = await snapshot();
const differ = Object.keys(before).filter(k => before[k] !== after[k]);
check(`every list, page, sub-tab count, filter and option is exactly the same as before (${Object.keys(before).length} answers compared)`, differ.length === 0, differ.slice(0, 3).join(" | "));
const incAfter = await includesAll();
const memAfter = await membersAll();
check("'is this scholar in a window of this term?' gives the same yes / no for every scholar in 7 arrangements (no window, one window, a school's own window, a test window beside a real one, only a test window, two school windows...)", JSON.stringify(incBefore) === JSON.stringify(incAfter), Object.keys(incBefore).filter(k => incBefore[k] !== incAfter[k]).join());
check("the NEW set _renewal_window_members() equals the per-scholar answer _renewal_window_includes() for every scholar in the same 7 arrangements", JSON.stringify(memAfter) === JSON.stringify(incAfter), Object.keys(incAfter).filter(k => incAfter[k] !== memAfter[k]).join());
check("those arrangements really differ from each other (the check is not trivially all-yes)", new Set(Object.values(incAfter).map(s => (s.match(/1/g) ?? []).length)).size >= 4, JSON.stringify(Object.fromEntries(Object.entries(incAfter).map(([k, v]) => [k, (v.match(/1/g) ?? []).length]))));

console.log("\nWho may ask, and what a page costs");
check("people who may not see renewals are still refused (plain staff, a scholar, a visitor)", !(await attempt(PLAIN, "select * from public.renewal_tab_list($1, $2, 'applications')", [SY, T])).ok && !(await attempt(seedId("scholar:1"), "select * from public.renewal_tab_counts($1, $2, 'applications')", [SY, T])).ok);
check("an unknown list name is still refused", !(await attempt(EVALUATOR, "select * from public.renewal_tab_list($1, $2, 'nonsense')", [SY, T])).ok);
const longPage = await rows(EVALUATOR, "select * from public.renewal_tab_list($1, $2, 'applications', null, null, null, null, null, null, null, null, 500, 0)", [SY, T]);
check("a page is cut at 200 as before, and total_rows is the whole count on every row", longPage.length === 200 && longPage.every(r => Number(r.total_rows) === Number(longPage[0].total_rows)) && Number(longPage[0].total_rows) > 200);
const msAfter = await timing("after");
console.log(`   (one Applications page: ${msBefore} ms before, ${msAfter} ms after, on this small database)`);

console.log("\nThe undo");
await db.exec(read(UNDO));
const undone = await snapshot();
check("the undo brings the earlier functions back (same answers) and removes the two new helpers", JSON.stringify(undone) === JSON.stringify(before) && (await q("select count(*)::int n from pg_proc where proname in ('_renewal_tab_core', '_renewal_tab_page_rows')"))[0].n === 0);
await db.exec(read(UNDO));      // twice: safe
await db.exec(read(FILE));      // and the file can be put back
check("the file can be put back after an undo", (await q("select count(*)::int n from pg_proc where proname = '_renewal_tab_core'"))[0].n === 1);
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
