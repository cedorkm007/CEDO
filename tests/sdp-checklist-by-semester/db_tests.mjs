// tests/sdp-checklist-by-semester/db_tests.mjs — the SDP Checklist by semester (supabase_migration_sdp_checklist_by_semester.sql)
//   current semester = everyone BEFORE the renewal; the semester being renewed = only the renewed scholars, with their SDP after the renewal.
// Run:  node tests/sdp-checklist-by-semester/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_checklist_by_semester.sql", UNDO = "undo_sdp_checklist_by_semester.sql", AFTER = "supabase_migration_sdp_after_renewal.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain");
const CS = "community_service", CV = "community_volunteerism", FP = "formation_program";

const Y1 = "2031-2032";                       // made-up years, so nothing of the seed data is in the way
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const setPeriod = (y, s) => q("update grading_period_settings set current_school_year = $1, current_semester = $2 where id = true", [y, s]);
const acts = {};
for (const c of [CS, CV, FP]) acts[c] = (await q("insert into sdp_activities(category, credits, all_year_levels) values ($1, 1, true) returning id", [c]))[0].id;
const credit = (n, cat, sem, count) => count > 0 ? q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) select $1, $2, current_date, g, $3, $4 from generate_series(1, $5::int) g", [acts[cat], num(n), Y1, sem, count]) : null;
const win = async (y, t, tester = false) => (await q("insert into renewal_windows (school_year, term, opens_on, closes_on, late_allowed, created_by, testers) values ($1, $2, current_date - 3, current_date + 10, true, $3, $4) returning id", [y, t, seedId("staff:demo.evaluator"), tester ? [num(1)] : null]))[0].id;
const rec = (n, y, t, stage, windowId) => q("insert into renewal_records (scholar_id_number, school_year, term, stage, window_id) values ($1, $2, $3, $4, $5)", [num(n), y, t, stage, windowId]);
const mkReq = async (n, status) => (await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term, status, lacking) values ($1, $2, '2nd Semester', $2, '1st Semester', $3, '{}'::jsonb) returning id", [num(n), Y1, status]))[0].id;

// 41 = 3 / 1 / 3 with an approved reconsideration (Community Volunteerism: 2 lacking), renewed;  42 = 5 / 3 / 3, renewed;  43 = 3 / 3 / 3, NOT renewed;  44 = 3 / 3 / 3, application only submitted
await setPeriod(Y1, "1st Semester");
await credit(41, CS, "1st Semester", 3); await credit(41, CV, "1st Semester", 1); await credit(41, FP, "1st Semester", 3);
await credit(42, CS, "1st Semester", 5); await credit(42, CV, "1st Semester", 3); await credit(42, FP, "1st Semester", 3);
await credit(43, CS, "1st Semester", 3); await credit(43, CV, "1st Semester", 3); await credit(43, FP, "1st Semester", 3);
await credit(44, CS, "1st Semester", 3); await credit(44, CV, "1st Semester", 3); await credit(44, FP, "1st Semester", 3);
const rq = await mkReq(41, "approved");
await q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, $3, 2, $4, '2nd Semester')", [rq, num(41), CV, Y1]);
const W2 = await win(Y1, "2nd Semester");
await rec(41, Y1, "2nd Semester", "renewed", W2); await rec(42, Y1, "2nd Semester", "renewed", W2); await rec(44, Y1, "2nd Semester", "submitted", W2);

const page = (uid, sem, filter = "all", sort = "default", search = "") => rows(uid, "select * from public.scholars_sdp_checklist_page($1, $2, $3, $4, $5, 'asc', 1, 200)", [Y1, sem, search, filter, sort]);
const triple = r => `${r.community_service}/${r.community_volunteerism}/${r.formation_program}`;
const byId = list => Object.fromEntries(list.map(r => [r.scholar_id_number, r]));
const ids = list => list.map(r => r.scholar_id_number).filter(i => /^TEST-004[1-4]$/.test(i)).sort().join();

const counts = async () => (await q("select (select count(*) from sdp_attendance) a, (select count(*) from sdp_reconsideration_debts) d, (select count(*) from scholars) s"))[0];
const countsAfterSetup = JSON.stringify(await counts());
await db.exec(read(AFTER)); await db.exec(read(UNDO)).catch(() => {});      // start from the behaviour before this file (the Checklist swaps renewed scholars to the next semester)
console.log("Before the file");
const before = byId(await page(SEAD, "1st Semester"));
check("the current semester mixes the two: renewed scholar 41 is shown at the NEXT semester's numbers (0/0/0), not at 3/1/3", triple(before["TEST-0041"]) === "0/0/0" && triple(before["TEST-0043"]) === "3/3/3", JSON.stringify(before["TEST-0041"]));

await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nThe current semester: everyone, as it stands BEFORE the renewal");
const cur = await page(SEAD, "1st Semester");
const curBy = byId(cur);
check("renewed scholars are NOT swapped: 41 shows 3/1/3 and 42 shows 5/3/3 (their own 1st semester)", triple(curBy["TEST-0041"]) === "3/1/3" && triple(curBy["TEST-0042"]) === "5/3/3", `${triple(curBy["TEST-0041"])} ${triple(curBy["TEST-0042"])}`);
check("everyone is listed, renewed or not, as before: 41, 42, 43 and 44 are all there", ids(cur) === "TEST-0041,TEST-0042,TEST-0043,TEST-0044");
check("nobody is marked as showing the next semester", (await rows(SEAD, "select * from public.scholars_sdp_advanced($1, '1st Semester')", [Y1])).length === 0);
const sumCur = (await rows(SEAD, "select * from public.scholars_sdp_checklist_summary($1, '1st Semester')", [Y1]))[0];
check("the counts are for everyone: 44 active scholars; 41 (complied through the approved reconsideration), 42, 43 and 44 are the 4 complied", Number(sumCur.total) === 44 && Number(sumCur.complied) === 4 && Number(sumCur.not_complied) === 40
  && curBy["TEST-0041"].complied === true && curBy["TEST-0043"].complied === true, JSON.stringify(sumCur));
check("the filter and sort (which need everyone's result) agree: 'complied' lists exactly 41 to 44, 'not complied' lists none of them", ids(await page(SEAD, "1st Semester", "complied", "result")) === "TEST-0041,TEST-0042,TEST-0043,TEST-0044" && ids(await page(SEAD, "1st Semester", "not_complied", "result")) === "");

console.log("\nThe semester being renewed: only the renewed scholars, after the renewal");
const per = await rows(SEAD, "select * from public.sdp_checklist_renewal_period()");
check("the picker is told: the 2nd semester, 2 renewed so far, the renewal is open now", per.length === 1 && per[0].school_year === Y1 && per[0].semester === "2nd Semester" && Number(per[0].renewed) === 2 && per[0].ongoing === true, JSON.stringify(per));
const ren = await page(SEAD, "2nd Semester");
const renBy = byId(ren);
check("it lists ONLY the renewed scholars (41 and 42): not 43, not 44 (only submitted), not anyone else", ren.length === 2 && ids(ren) === "TEST-0041,TEST-0042", ids(ren));
check("their numbers are the 2nd semester's: the example 3/1/3 becomes 0/0/0 and 5/3/3 carries on as 2/0/0", triple(renBy["TEST-0041"]) === "0/0/0" && triple(renBy["TEST-0042"]) === "2/0/0", `${triple(renBy["TEST-0041"])} ${triple(renBy["TEST-0042"])}`);
check("the lacking credits are added to the requirement for the 2nd semester (Community Volunteerism needs 3 + 2)", await (async () => {
  const x = byId(await rows(SEAD, "select * from public.scholars_sdp_extra_required($1, '2nd Semester')", [Y1])); return x["TEST-0041"] && Number(x["TEST-0041"].community_volunteerism) === 2;
})());
const sumRen = (await rows(SEAD, "select * from public.scholars_sdp_checklist_summary($1, '2nd Semester')", [Y1]))[0];
check("its counts are for the renewed scholars only: total 2, none complied yet (they must earn new credits)", Number(sumRen.total) === 2 && Number(sumRen.complied) === 0 && Number(sumRen.not_complied) === 2, JSON.stringify(sumRen));
check("the filter, the sort and the search work there too", ids(await page(SEAD, "2nd Semester", "not_complied", "result")) === "TEST-0041,TEST-0042" && (await page(SEAD, "2nd Semester", "complied", "result")).length === 0
  && ids(await page(SEAD, "2nd Semester", "all", "name", "0042")) === "TEST-0042" && (await page(SEAD, "2nd Semester", "all", "default", "0043")).length === 0);
check("a new renewal confirmed later joins the list at once (43 renewed: now 3 scholars)", await (async () => {
  await rec(43, Y1, "2nd Semester", "renewed", W2);
  const l = await page(SEAD, "2nd Semester"); return l.length === 3 && triple(byId(l)["TEST-0043"]) === "0/0/0";
})());
check("when the only renewal window for it is a TEST window (with testers) it is not a renewal view: the picker offers nothing and the list is everyone", await (async () => {
  await q("update renewal_windows set testers = $1 where id = $2", [[num(1)], W2]);
  const none = (await rows(SEAD, "select * from public.sdp_checklist_renewal_period()")).length === 0, all = (await page(SEAD, "2nd Semester")).length >= 44;
  await q("update renewal_windows set testers = null where id = $1", [W2]);
  return none && all;
})());

console.log("\nOther semesters and who may ask");
check("only the semester right after the current one, with a real window, is a renewal view (a window for a far semester is not)", await (async () => {
  await win("2033-2034", "1st Semester");
  const r = (await q("select public._sdp_renewal_view('2033-2034', '1st Semester') far, public._sdp_renewal_view($1, '2nd Semester') next, public._sdp_renewal_view($1, '1st Semester') cur", [Y1]))[0];
  return r.far === false && r.next === true && r.cur === false;
})());
check("an earlier or later semester without a renewal is shown as before: everyone", (await page(SEAD, "1st Semester")).length === 44 && (await page(SEAD, "Summer")).length === 44);
check("staff without the SDP Monitoring tag cannot read the picker, the list or the counts", !(await attempt(PLAIN, "select * from public.sdp_checklist_renewal_period()")).ok
  && !(await attempt(PLAIN, "select * from public.scholars_sdp_checklist_page($1, '2nd Semester', '', 'all', 'default', 'asc', 1, 5)", [Y1])).ok && !(await attempt(PLAIN, "select * from public.scholars_sdp_checklist_summary($1, '2nd Semester')", [Y1])).ok);
check("a scholar cannot read them either", !(await attempt(seedId("scholar:41"), "select * from public.sdp_checklist_renewal_period()")).ok && !(await attempt(seedId("scholar:41"), "select * from public.scholars_sdp_checklist_page($1, '2nd Semester', '', 'all', 'default', 'asc', 1, 5)", [Y1])).ok);

console.log("\nThe scholar's own SDP tab is not changed");
const progress = async n => Object.fromEntries((await rows(seedId(`scholar:${n}`), "select * from public.fetch_scholar_sdp_progress()")).map(r => [r.category, Number(r.credits)]));
check("a renewed scholar still sees the next semester right away on their own tab: 41 sees 0/0/0, 43 (renewed in this test) too, 44 (only submitted) still 3/3/3", (await progress(41))[CS] === 0 && (await progress(41))[CV] === 0 && (await progress(44))[CS] === 3);

console.log("\nWhen CEDO makes that semester the current one");
await setPeriod(Y1, "2nd Semester");
const nowCur = await page(SEAD, "2nd Semester");
check("it becomes a normal view of everyone (all active scholars are listed, not only the renewed)", nowCur.length >= 44 && ids(nowCur) === "TEST-0041,TEST-0042,TEST-0043,TEST-0044");
check("the picker has nothing more to offer for it (the semester after is not being renewed)", (await rows(SEAD, "select * from public.sdp_checklist_renewal_period()")).length === 0);
await setPeriod(Y1, "1st Semester");

console.log("\nNothing is lost");
check("no table was changed by the file: the credits, the reconsideration debts and the scholars are exactly what the test put there", JSON.stringify(await counts()) === countsAfterSetup, JSON.stringify(await counts()) + " vs " + countsAfterSetup);
await db.exec(read(UNDO));
const undone = byId(await page(SEAD, "1st Semester"));
check("the undo brings the earlier behaviour back (41 swapped again) and the new functions are gone", triple(undone["TEST-0041"]) === "0/0/0" && (await q("select count(*)::int n from pg_proc where proname in ('sdp_checklist_renewal_period', '_sdp_renewed_ids', '_sdp_renewal_view')"))[0].n === 0);
await db.exec(read(UNDO));      // twice: safe
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
