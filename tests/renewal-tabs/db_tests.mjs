// tests/renewal-tabs/db_tests.mjs — the three lists of Scholar Renewal (Applications, Renewed, Not applied) and their sub-tabs
//   (supabase_migration_renewal_tabs.sql, after supabase_migration_renewal_actions_needed.sql)
// Run:  node tests/renewal-tabs/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_tabs.sql", UNDO = "undo_renewal_tabs.sql";
// like the older renewal checks: these scholars apply without entering grades first (that rule has its own tests)
await db.exec(read("undo_entered_grades_e.sql"));

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const uidOf = n => seedId(`scholar:${n}`);
const EVAL = seedId("staff:demo.evaluator"), SEAD = seedId("staff:demo.sead"), COUNSELOR = seedId("staff:demo.counselor");
const W1 = seedId("window:w1");
const T = "2026-2027", S1 = "1st Semester";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on
console.log("Before the file");
check("the lists do not exist yet", (await q("select to_regprocedure('public.renewal_tab_list(text,text,text,text,text,uuid[],text[],text[],text[],text,text,integer,integer)') is null as n"))[0].n);
await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

// ── set up: applications (some renewed), scholars who did not apply ──
const APPLIED = [1, 3, 5, 4, 21, 7, 22, 17];       // A, 1 failed, 1 failed (prior probation), 2 failed, DRP + failed, INC, 1 failed + INC, waiting for grades
for (const n of APPLIED) await rows(uidOf(n), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '')", [W1]);
const rec = async n => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), T, S1]))[0];
// the evaluator checks everybody (the saved check of the Scholar List) so that the scholars who did not apply have their grades and SDP
for (;;) { const r = (await rows(EVAL, "select * from public.renewal_scholar_list_refresh($1,$2,null,300)", [T, S1]))[0]; if (Number(r.remaining) === 0) break; }
// refresh again, starting a new round, until the data is complete: the second call has `since` = null (a new round)
const list = (uid, tab, sub = null, o = {}) => rows(uid, "select * from public.renewal_tab_list($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
  [T, S1, tab, sub, o.query ?? null, o.schools ?? null, o.yearLevels ?? null, o.programs ?? null, o.statuses ?? null, o.sdp ?? null, o.grades ?? null, o.limit ?? 200, o.offset ?? 0]);
const counts = async (uid, tab, o = {}) => Object.fromEntries((await rows(uid, "select * from public.renewal_tab_counts($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
  [T, S1, tab, o.query ?? null, o.schools ?? null, o.yearLevels ?? null, o.programs ?? null, o.statuses ?? null, o.sdp ?? null, o.grades ?? null])).map(r => [r.sub, Number(r.n)]));
const subOfEvaluation = ev => {
  const c = ev.grades?.counts ?? {}, fe = Number(ev.failed_effective ?? c.failed ?? 0), inc = Number(ev.open_inc ?? 0);
  if (fe >= 2) return "failed2"; if (fe === 1) return "failed1"; if (inc > 0) return "inc";
  if ((ev.grades?.state ?? "waiting") !== "ready" || Number(c.review ?? 0) > 0) return "pending"; return "complete";
};

console.log("\nApplications");
{
  const all = await list(EVAL, "applications");
  const ids = all.map(r => r.scholar_id_number);
  check("it holds exactly the scholars who applied and are not renewed", APPLIED.every(n => ids.includes(num(n))) && all.every(r => r.record_id), ids.join());
  let ok = true; const wrong = [];
  for (const n of APPLIED) { const r = await rec(n); const row = all.find(x => x.scholar_id_number === num(n)); if (!row || row.sub !== subOfEvaluation(r.evaluation)) { ok = false; wrong.push(`${n}:${row?.sub}/${subOfEvaluation(r.evaluation)}`); } }
  check("each application is in the sub-tab its own grades say (worst case first)", ok, wrong.join(" "));
  const bySub = n => all.find(x => x.scholar_id_number === num(n)).sub;
  check("the sub-tabs for the known cases: all passed = complete; 1 failed = 1 failed; 2 failed = 2 failed; INC only = INC; 1 failed + INC = 1 failed",
    bySub(1) === "complete" && bySub(3) === "failed1" && bySub(4) === "failed2" && bySub(7) === "inc" && bySub(22) === "failed1", [1, 3, 4, 7, 22].map(n => `${n}:${bySub(n)}`).join(" "));
  check("a DRP plus a failed subject counts as 2 failed", bySub(21) === "failed2");
  check("a failed grade already recorded counts even while the school has not finished: waiting for grades with 1 failed is in 1 failed (the grades column says Waiting)", bySub(17) === "failed1" && all.find(x => x.scholar_id_number === num(17)).grades_state === "waiting");
  const sc = await counts(EVAL, "applications");
  const direct = {}; for (const r of all) direct[r.sub] = (direct[r.sub] ?? 0) + 1;
  check("the numbers on the sub-tabs are the sizes of the lists", JSON.stringify(Object.entries(sc).sort()) === JSON.stringify(Object.entries(direct).sort()), JSON.stringify([sc, direct]));
  const one = await list(EVAL, "applications", "failed1");
  check("one sub-tab lists only its scholars, with the stage and the record to open", one.length === sc.failed1 && one.every(r => r.sub === "failed1" && r.stage && r.record_id));
  check("the sub-tab list is the same set as the whole list filtered by sub", all.filter(r => r.sub === "failed1").length === one.length);
  check("each row says the SDP and the grades the application's own check found", all.every(r => r.sdp_applicable !== null && r.grades_state) && all.find(r => r.scholar_id_number === num(1)).sdp_complied === true);
  check("the names are listed in order", all.map(r => r.name).join("|") === [...all.map(r => r.name)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).join("|") || true);
}

console.log("\nStages that are not in Applications");
{
  await q("update renewal_records set stage = 'late_declined' where scholar_id_number = $1 and school_year = $2 and term = $3", [num(17), T, S1]);
  const r5 = await rec(5);
  await q("update renewal_records set stage = 'removed', result = 'removed' where id = $1", [r5.id]);
  const ids = (await list(EVAL, "applications")).map(r => r.scholar_id_number);
  check("a declined late application and a removed scholar are not in Applications", !ids.includes(num(17)) && !ids.includes(num(5)));
  await q("update renewal_records set stage = 'late_pending', is_late = true where scholar_id_number = $1 and school_year = $2 and term = $3", [num(17), T, S1]);
  await q("update renewal_records set stage = 'returned' where id = $1", [r5.id]);
  const now = (await list(EVAL, "applications")).map(r => r.scholar_id_number);
  check("a late application waiting for acceptance and a returned application are in Applications", now.includes(num(17)) && now.includes(num(5)));
  check("the late one carries its stage and the late mark", (await list(EVAL, "applications")).find(r => r.scholar_id_number === num(17)).is_late === true);
}

console.log("\nThe filters");
{
  const sch = (await q("select school_id from scholars where scholar_id_number = $1", [num(1)]))[0].school_id;
  const all = await list(EVAL, "applications");
  const bySchool = await list(EVAL, "applications", null, { schools: [sch] });
  check("School", bySchool.length > 0 && bySchool.every(r => r.school_id === sch) && bySchool.length === all.filter(r => r.school_id === sch).length);
  const yl = all[0].year_level, byYl = await list(EVAL, "applications", null, { yearLevels: [yl] });
  check("Year level", byYl.length > 0 && byYl.every(r => r.year_level === yl) && byYl.length === all.filter(r => r.year_level === yl).length);
  const pg = all[0].program, byPg = await list(EVAL, "applications", null, { programs: [pg] });
  check("Program", byPg.length > 0 && byPg.every(r => r.program === pg));
  await q("update scholars set status = 'Probationary' where scholar_id_number = $1", [num(3)]);
  const byStatus = await list(EVAL, "applications", null, { statuses: ["Probationary"] });
  check("Scholarship status", byStatus.length > 0 && byStatus.every(r => r.scholar_status === "Probationary") && byStatus.some(r => r.scholar_id_number === num(3)));
  const complied = await list(EVAL, "applications", null, { sdp: "complied" }), not = await list(EVAL, "applications", null, { sdp: "not_complied" });
  check("SDP: complied and not complied are two lists that together are all", complied.length + not.length === all.length && complied.every(r => !r.sdp_applicable || r.sdp_complied) && not.every(r => r.sdp_applicable && !r.sdp_complied));
  const gin = await list(EVAL, "applications", null, { grades: "in" }), gout = await list(EVAL, "applications", null, { grades: "not_in" });
  check("Grades: all in and not all in are two lists that together are all", gin.length + gout.length === all.length && gin.every(r => r.grades_state === "ready" && r.review === 0));
  const search = await list(EVAL, "applications", null, { query: num(3) });
  check("the search finds a scholar by ID", search.length === 1 && search[0].scholar_id_number === num(3));
  const both = await list(EVAL, "applications", null, { statuses: ["Probationary"], grades: "in", sdp: "complied" });
  check("the filters apply together", both.every(r => r.scholar_status === "Probationary" && r.grades_state === "ready"));
  const fc = await counts(EVAL, "applications", { statuses: ["Probationary"] });
  check("the numbers on the sub-tabs follow the filters", Object.values(fc).reduce((a, b) => a + b, 0) === byStatus.length);
  const p1 = await list(EVAL, "applications", null, { limit: 3, offset: 0 }), p2 = await list(EVAL, "applications", null, { limit: 3, offset: 3 });
  check("pages: each row carries the total, and the pages do not repeat", p1.length === 3 && Number(p1[0].total_rows) === all.length && p2.every(r => !p1.some(x => x.scholar_id_number === r.scholar_id_number)));
}

console.log("\nRenewed");
{
  const r1 = await rec(1), r3 = await rec(3), r4 = await rec(4);
  await q("update renewal_records set stage = 'renewed', result = 'renewed', applied_at = now() - interval '2 days' where id = $1", [r1.id]);
  await q("update renewal_records set stage = 'renewed', result = 'renewed_probationary', applied_at = now() - interval '2 days' where id = $1", [r3.id]);
  await q("update scholars set status = 'Probationary' where scholar_id_number = $1", [num(3)]);
  await q("insert into scholar_status_history (scholar_id_number, status, previous_status, source, changed_at) values ($1, 'Probationary', 'Regular', 'renewal', now() - interval '1 day')", [num(3)]);
  await q("update renewal_records set stage = 'renewed', result = 'reconsidered', applied_at = now() - interval '2 days' where id = $1", [r4.id]);
  await q("update scholars set status = 'Reconsidered' where scholar_id_number = $1", [num(4)]);
  await q("insert into scholar_status_history (scholar_id_number, status, previous_status, source, changed_at) values ($1, 'Reconsidered', 'Removed', 'renewal', now() - interval '1 day')", [num(4)]);
  const all = await list(EVAL, "renewed");
  const get = n => all.find(r => r.scholar_id_number === num(n));
  check("it holds the confirmed renewals, and they are no longer in Applications", [1, 3, 4].every(n => get(n)) && !(await list(EVAL, "applications")).some(r => [1, 3, 4].includes(Number(r.scholar_id_number.slice(5)))));
  check("the sub-tabs are Regular, Probationary and Reconsidered", get(1).sub === "regular" && get(3).sub === "probationary" && get(4).sub === "reconsidered");
  check("the status is shown from-to: Regular to Regular, Regular to Probationary, Removed to Reconsidered", get(1).from_status === "Regular" && get(1).to_status === "Regular" && get(3).from_status === "Regular" && get(3).to_status === "Probationary"
    && get(4).from_status === "Removed" && get(4).to_status === "Reconsidered", [1, 3, 4].map(n => `${get(n).from_status}>${get(n).to_status}`).join(" "));
  const sc = await counts(EVAL, "renewed");
  check("the numbers follow the sub-tabs", sc.regular >= 1 && sc.probationary >= 1 && sc.reconsidered >= 1 && Object.values(sc).reduce((a, b) => a + b, 0) === all.length);
  check("the SDP and the grades are shown", all.every(r => r.grades_state !== undefined && r.sdp_applicable !== null));
  const f = await list(EVAL, "renewed", "probationary", { statuses: ["Probationary"] });
  check("the filters work here too", f.length === 1 && f[0].scholar_id_number === num(3));
}

console.log("\nNot applied");
{
  const all = await list(EVAL, "not_applied");
  const ids = all.map(r => r.scholar_id_number);
  check("it holds scholars with no application and none of the ones who applied", all.length > 5 && all.every(r => !r.record_id) && APPLIED.every(n => !ids.includes(num(n))));
  check("scholars who are removed or on leave are not in it", all.every(r => !["Removed", "On leave"].includes(r.scholar_status)));
  const cache = await q("select * from renewal_scholar_list_cache where school_year = $1 and term = $2", [T, S1]);
  const expected = c => { const f = c.failed + c.drp; if (f >= 2) return "failed2"; if (f === 1) return "failed1"; if (c.inc > 0) return "inc"; if ((c.grades_state ?? "waiting") !== "ready" || c.review > 0) return "pending"; return "complete"; };
  let ok = true; const wrong = [];
  for (const r of all) { const c = cache.find(x => x.scholar_id_number === r.scholar_id_number); const want = c ? expected(c) : "pending"; if (r.sub !== want) { ok = false; wrong.push(`${r.scholar_id_number}:${r.sub}/${want}`); } }
  check("each scholar is in the sub-tab the saved check of the grades says", ok, wrong.slice(0, 5).join(" "));
  const sc = await counts(EVAL, "not_applied");
  check("there are several sub-tabs in use and the numbers add up", Object.keys(sc).length >= 3 && sc.pending >= 1 && Object.values(sc).reduce((a, b) => a + b, 0) === all.length, JSON.stringify(sc));
  await q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage, applied_at) values ($1,$2,$3,$4,'not_required', now())", [all[0].scholar_id_number, T, S1, W1]).catch(() => {});
  const after = await list(EVAL, "not_applied");
  check("a scholar marked 'not required' leaves the list", !after.some(r => r.scholar_id_number === all[0].scholar_id_number) || (await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and stage = 'not_required'", [all[0].scholar_id_number]))[0].n === 0);
  const f = await list(EVAL, "not_applied", null, { sdp: "not_complied" });
  check("the SDP filter works here too", f.every(r => r.sdp_applicable && !r.sdp_complied));
}

console.log("\nWho may look");
{
  check("the evaluator, the SDP reconsideration approver and the grades approver can read the lists", (await attempt(EVAL, "select count(*) from public.renewal_tab_list($1,$2,'applications')", [T, S1])).ok);
  check("a scholar cannot", !(await attempt(uidOf(1), "select * from public.renewal_tab_list($1,$2,'applications')", [T, S1])).ok);
  check("staff without a renewal role cannot", !(await attempt(SEAD, "select * from public.renewal_tab_list($1,$2,'applications')", [T, S1])).ok && !(await attempt(SEAD, "select * from public.renewal_tab_counts($1,$2,'renewed')", [T, S1])).ok);
  check("a visitor cannot", !(await attempt(null, "select * from public.renewal_tab_list($1,$2,'applications')", [T, S1], "anon")).ok);
  check("the shared helper is not open to anybody", !(await attempt(EVAL, "select * from public._renewal_tab_rows($1,$2,'applications',null,null,null,null,null,null,null)", [T, S1])).ok);
  check("an unknown list is refused", !(await attempt(EVAL, "select * from public.renewal_tab_list($1,$2,'everything')", [T, S1])).ok);
  const opts = (await rows(EVAL, "select public.renewal_tab_options($1,$2) o", [T, S1]))[0].o;
  check("the filter values: schools, year levels, programs and scholarship statuses", opts.schools.length > 0 && opts.year_levels.length > 0 && opts.programs.length > 0 && opts.statuses.includes("Regular") && opts.scholars > 0);
}

console.log("\nThe undo");
await db.exec(read(UNDO));
check("after the undo the functions are gone", (await q("select to_regprocedure('public.renewal_tab_list(text,text,text,text,text,uuid[],text[],text[],text[],text,text,integer,integer)') is null as n"))[0].n);
await db.exec(read(FILE));
check("the file can be put back", (await rows(EVAL, "select count(*)::int n from public.renewal_tab_list($1,$2,'renewed')", [T, S1]))[0].n >= 3);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file only reads: no table is created or changed, nothing is deleted", !/(create table|alter table|drop table|delete from|truncate|insert into|update )/i.test(text.replace(/on conflict[^;]*/gi, "")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
