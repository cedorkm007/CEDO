// tests/school-update/scholar_list_db_tests.mjs — Scholar Renewal > Scholar List (supabase_migration_renewal_scholar_list.sql)
// Run:  node tests/school-update/scholar_list_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_scholar_list.sql", UNDO = "undo_renewal_scholar_list.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

// The SDP reconsideration file D (a later file) adds a column to the list function, and a function cannot change its columns by being created again: take that file back first,
// as on a real project, where this file is run before it.
if (fs.existsSync("undo_sdp_reconsideration_d.sql")) await db.exec(read("undo_sdp_reconsideration_d.sql"));
await db.exec(read(FILE));
const EVALUATOR = seedId("staff:demo.evaluator"), SEAD = seedId("staff:demo.sead"), COUNSELOR = seedId("staff:demo.counselor"), DIVHEAD = seedId("staff:demo.divhead"), PLAIN = seedId("staff:demo.plain");
const win = (await q(`select w.school_year, w.term from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
const Y = win.school_year, T = win.term;
const elig = async ev => (await q("select public._renewal_list_eligibility($1::jsonb) e", [JSON.stringify(ev)]))[0].e;
const ev = (applicable, complied, state, failed, inc, review = 0, drp = 0) => ({ sdp: { applicable, complied }, grades: { state, counts: { failed, inc, review, drp } } });

console.log("\nThe eligibility labels");
check("complete SDP and all subjects passed = Ready for renewal, alone", (await elig(ev(true, true, "ready", 0, 0))).join() === "ready");
check("a failed subject = For consultation", (await elig(ev(true, true, "ready", 1, 0))).join() === "consultation");
check("a DRP (counted among the failed) = For consultation", (await elig(ev(true, true, "ready", 1, 0, 0, 1))).join() === "consultation");
check("an incomplete (INC) subject = For consultation", (await elig(ev(true, true, "waiting", 0, 1))).includes("consultation"));
check("lacking SDP credits = For SDP reconsideration", (await elig(ev(true, false, "ready", 0, 0))).join() === "sdp_reconsideration");
check("a failed subject AND lacking SDP credits = both labels, never Ready", (await elig(ev(true, false, "ready", 2, 0))).sort().join() === "consultation,sdp_reconsideration");
check("Summer (no SDP requirement) with all passed = Ready", (await elig(ev(false, null, "ready", 0, 0))).join() === "ready");
check("grades not in yet = Waiting for grades, not Ready", (await elig(ev(true, true, "waiting", 0, 0))).join() === "waiting" && (await elig(ev(true, true, "no_grades", 0, 0))).join() === "waiting");
check("an unreadable mark = Needs review", (await elig(ev(true, true, "review", 0, 0, 1))).join() === "review");
check("a check that failed (error) = Needs review", (await elig({ error: "x" })).join() === "review");

console.log("\nThe saved results");
const since = (await q("select clock_timestamp() t"))[0].t;
check("nothing is saved before the first refresh, and the list is empty", (await rows(EVALUATOR, "select * from public.renewal_scholar_list($1, $2)", [Y, T])).length === 0);
const r1 = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 5)", [Y, T, since]))[0];
check("one step does at most the asked number of scholars, and says how many remain and how many there are in all", Number(r1.done) === 5 && Number(r1.remaining) === Number(r1.total) - 5 && Number(r1.total) > 10, JSON.stringify(r1));
let last = r1, guard = 0;
while (Number(last.remaining) > 0 && guard++ < 200) last = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 100)", [Y, T, since]))[0];
check("repeating the step finishes the whole list", Number(last.remaining) === 0, JSON.stringify(last));
const all = await rows(EVALUATOR, "select * from public.renewal_scholar_list($1, $2, null, null, null, null, null, 200, 0)", [Y, T]);
check("the list now has every active scholar of the window (not Removed, not On leave)", all.length === Number(r1.total)
  && all.length === (await q("select count(*)::int n from scholars where status not in ('Removed','On leave')"))[0].n);
check("every row's numbers are exactly what the renewal check gives for that scholar (it cannot disagree with an application)", await (async () => {
  for (const r of all) {
    const e = (await q("select public._renewal_evaluate($1, $2, $3) e", [r.scholar_id_number, Y, T]))[0].e;
    const c = e.grades.counts;
    if ((e.sdp.complied ?? null) !== r.sdp_complied || e.grades.state !== r.grades_state || Number(c.total) !== r.total || Number(c.total) - Number(c.ungraded) !== r.graded
      || Number(c.failed) - Number(c.drp) !== r.failed || Number(c.drp) !== r.drp || Number(c.inc) !== r.inc || r.eligibility.slice().sort().join() !== (await elig(e)).slice().sort().join()) return false;
  }
  return true;
})());
check("the demo has scholars in several eligibility groups", ["ready", "consultation", "sdp_reconsideration"].every(l => all.some(r => r.eligibility.includes(l))), JSON.stringify(Object.fromEntries(["ready", "consultation", "sdp_reconsideration", "waiting", "review"].map(l => [l, all.filter(r => r.eligibility.includes(l)).length]))));
check("each row carries the school, year level and program of the scholar", all.every(r => "school" in r && "year_level" in r && "program" in r) && all.some(r => r.school));
check("'Ready for renewal' is never combined with another label, and every scholar has a label", all.every(r => r.eligibility.length > 0 && (!r.eligibility.includes("ready") || r.eligibility.length === 1)));
const r0 = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, null, 7)", [Y, T]))[0];
check("a first step with no start time begins a new round on the database's own clock and hands the start time back", Number(r0.done) === 7 && !!r0.since && Number(r0.remaining) === Number(r1.total) - 7, JSON.stringify(r0));
let g0 = 0, l0 = r0;
while (Number(l0.remaining) > 0 && g0++ < 200) l0 = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 300)", [Y, T, l0.since]))[0];
check("handing that time back step after step finishes the round", Number(l0.remaining) === 0 && Number(l0.since.getTime?.() ?? 0) === Number(r0.since.getTime?.() ?? 0));
check("running a step again when everything is fresh does nothing", Number((await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 100)", [Y, T, since]))[0].done) === 0);
const target = all[0].scholar_id_number;
await q("update renewal_scholar_list_cache set computed_at = computed_at - interval '1 day' where scholar_id_number = $1", [target]);
const since2 = (await q("select clock_timestamp() t"))[0].t;
const r2 = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 100)", [Y, T, since2]))[0];
check("a refresh with a later 'since' checks everybody again", Number(r2.done) === 100 || Number(r2.done) === all.length);
while (Number((await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 300)", [Y, T, since2]))[0].remaining) > 0);

console.log("\nFilters, search, pages");
const call = (uid, o = {}, limit = 200, offset = 0) => rows(uid, "select * from public.renewal_scholar_list($1, $2, $3, $4::uuid[], $5::text[], $6::text[], $7::text[], $8, $9)",
  [Y, T, o.query ?? null, o.schools ?? null, o.levels ?? null, o.programs ?? null, o.eligibility ?? null, limit, offset]);
const schools = [...new Set(all.map(r => r.school_id).filter(Boolean))], levels = [...new Set(all.map(r => r.year_level).filter(Boolean))], programs = [...new Set(all.map(r => r.program).filter(Boolean))];
const bySchool = await call(EVALUATOR, { schools: [schools[0]] });
check("the school filter keeps only that school", bySchool.length > 0 && bySchool.length < all.length && bySchool.every(r => r.school_id === schools[0]));
check("ticking two schools gives the scholars of either", (await call(EVALUATOR, { schools: schools.slice(0, 2) })).length === all.filter(r => schools.slice(0, 2).includes(r.school_id)).length);
check("the year level filter works", (await call(EVALUATOR, { levels: [levels[0]] })).every(r => r.year_level === levels[0]) && (await call(EVALUATOR, { levels: [levels[0]] })).length === all.filter(r => r.year_level === levels[0]).length);
check("the program filter works", (await call(EVALUATOR, { programs: [programs[0]] })).length === all.filter(r => r.program === programs[0]).length);
check("the eligibility filter works (a scholar with either ticked label shows)", (await call(EVALUATOR, { eligibility: ["consultation", "sdp_reconsideration"] })).length === all.filter(r => r.eligibility.includes("consultation") || r.eligibility.includes("sdp_reconsideration")).length);
const combined = await call(EVALUATOR, { schools: [schools[0]], levels: [levels[0]], eligibility: ["ready"] });
check("filters of different kinds apply TOGETHER (school AND year level AND eligibility)", combined.length === all.filter(r => r.school_id === schools[0] && r.year_level === levels[0] && r.eligibility.includes("ready")).length
  && combined.every(r => r.school_id === schools[0] && r.year_level === levels[0] && r.eligibility.includes("ready")));
check("empty lists mean no filter", (await call(EVALUATOR, { schools: [], levels: [], programs: [], eligibility: [] })).length === all.length);
const p1 = await call(EVALUATOR, {}, 5, 0), p2 = await call(EVALUATOR, {}, 5, 5);
check("pages keep the order, do not repeat, and say how many there are in all", p1.length === 5 && p2.length === 5 && p1[4].scholar_id_number !== p2[0].scholar_id_number && p1.every(r => Number(r.total_rows) === all.length)
  && [...p1, ...p2].map(r => r.scholar_id_number).join() === all.slice(0, 10).map(r => r.scholar_id_number).join());
check("a page past the end is empty; a page larger than 200 gives at most 200", (await call(EVALUATOR, {}, 5, 100000)).length === 0 && (await call(EVALUATOR, {}, 5000)).length <= 200);
check("the search finds a scholar by ID number and by last name", (await call(EVALUATOR, { query: target })).some(r => r.scholar_id_number === target)
  && (await call(EVALUATOR, { query: all[0].name.split(",")[0] })).some(r => r.scholar_id_number === target) && (await call(EVALUATOR, { query: "zzzz-nobody" })).length === 0);
check("the evaluator, a consultation staff member and the division head may look; a staff member with no renewal tools, a scholar and a visitor may not", (await attempt(COUNSELOR, "select * from public.renewal_scholar_list($1, $2)", [Y, T])).ok && (await attempt(DIVHEAD, "select * from public.renewal_scholar_list($1, $2)", [Y, T])).ok
  && !(await attempt(PLAIN, "select * from public.renewal_scholar_list($1, $2)", [Y, T])).ok && !(await attempt(seedId("scholar:1"), "select * from public.renewal_scholar_list($1, $2)", [Y, T])).ok
  && !(await attempt(null, "select * from public.renewal_scholar_list($1, $2)", [Y, T], "anon")).ok);
check("only the renewal evaluator may refresh", !(await attempt(SEAD, "select * from public.renewal_scholar_list_refresh($1, $2, now(), 5)", [Y, T])).ok && !(await attempt(PLAIN, "select * from public.renewal_scholar_list_refresh($1, $2, now(), 5)", [Y, T])).ok);
check("nobody can read or write the saved results table directly", !(await attempt(EVALUATOR, "select count(*) from public.renewal_scholar_list_cache")).ok && !(await attempt(null, "select count(*) from public.renewal_scholar_list_cache", [], "anon")).ok);

console.log("\nThe cross-match table");
const mx = await rows(EVALUATOR, "select * from public.renewal_scholar_list_matrix($1, $2)", [Y, T]);
check("one row per school, and the totals add up to the whole list", mx.reduce((n, r) => n + Number(r.total), 0) === all.length && mx.length >= 3);
check("each count is the number of scholars the list shows when that school and eligibility are ticked", await (async () => {
  for (const m of mx) for (const l of ["ready", "consultation", "sdp_reconsideration", "waiting", "review"]) {
    const n = (await call(EVALUATOR, m.school_id ? { schools: [m.school_id], eligibility: [l] } : { eligibility: [l] }, 200)).filter(r => (m.school_id ? true : r.school_id === null)).length;
    if (Number(m[l]) !== n) return false;
  }
  return true;
})());
const mxf = await rows(EVALUATOR, "select * from public.renewal_scholar_list_matrix($1, $2, null, null, $3::text[])", [Y, T, [levels[0]]]);
check("the table follows the year level filter (it is the crossing of the other filters)", mxf.reduce((n, r) => n + Number(r.total), 0) === all.filter(r => r.year_level === levels[0]).length);
check("the table says when it was last checked", mx.every(r => r.last_checked));

console.log("\nThe filter choices and the SDP credits");
const opt = (await rows(EVALUATOR, "select public.renewal_scholar_list_options($1, $2) o", [Y, T]))[0].o;
check("the choices list the schools, year levels and programs of the scholars, and how many scholars there are", opt.schools.length >= 3 && opt.year_levels.length >= 1 && opt.programs.length >= 1 && Number(opt.scholars) === all.length && Number(opt.checked) === all.length && !!opt.last_checked);
const notComplied = all.find(r => r.sdp_applicable && r.sdp_complied === false);
check("the demo has a scholar who has not complied with the SDP", !!notComplied);
const cr = (await rows(EVALUATOR, "select public.renewal_scholar_sdp_credits($1, $2, $3) c", [notComplied.scholar_id_number, Y, T]))[0].c;
check("the credits view gives the credits needed, what the scholar has in each category, and the credits earned that semester", cr.required === 3 && cr.sdp.complied === false && "community_service" in cr.sdp && Array.isArray(cr.credits) && Array.isArray(cr.reserved));
check("an unknown scholar is refused", !(await attempt(EVALUATOR, "select public.renewal_scholar_sdp_credits('NOPE', $1, $2)", [Y, T])).ok);

console.log("\nWho is in the window");
const goneId = all.find(r => r.school_id === schools[0]).scholar_id_number;
const goneStatus = (await q("select status from scholars where scholar_id_number = $1", [goneId]))[0].status;
await q("update scholars set status = 'On leave' where scholar_id_number = $1", [goneId]);
check("a scholar who goes On leave leaves the list at once (no new refresh needed)", !(await call(EVALUATOR, { query: goneId })).some(r => r.scholar_id_number === goneId));
await q("update scholars set status = $2 where scholar_id_number = $1", [goneId, goneStatus]);
await q("update renewal_windows set school_ids = $3 where school_year = $1 and term = $2", [Y, T, [schools[0]]]);
check("a window limited to a school lists only that school's scholars", (await call(EVALUATOR)).every(r => r.school_id === schools[0]) && (await call(EVALUATOR)).length > 0);
await q("update renewal_windows set school_ids = null where school_year = $1 and term = $2", [Y, T]);

console.log("\nRunning again, the undo and putting it back");
await db.exec(read(FILE));
check("running the file again keeps the saved results", (await call(EVALUATOR)).length === all.length);
await db.exec(read(UNDO));
check("after the undo the functions and the table are gone", (await q("select count(*)::int n from pg_proc where proname in ('renewal_scholar_list', 'renewal_scholar_list_refresh', 'renewal_scholar_list_matrix', 'renewal_scholar_list_options', 'renewal_scholar_sdp_credits', '_renewal_list_eligibility')"))[0].n === 0
  && (await q("select to_regclass('public.renewal_scholar_list_cache') t"))[0].t === null);
await db.exec(read(FILE));
check("it can be put back after the undo", (await attempt(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, now(), 5)", [Y, T])).ok);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file creates one table and changes no existing table; nothing is deleted", !/alter table public.(?!renewal_scholar_list_cache)/i.test(text) && (text.match(/create table/gi) ?? []).length === 1 && !/\b(delete from|truncate|drop table)\b/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
