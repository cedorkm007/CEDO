// tests/sdp-after-renewal/db_tests.mjs — a renewed scholar's SDP shows the NEXT semester right away (supabase_migration_sdp_after_renewal.sql)
//   3 credits used per category, only what is above the requirement carries on, what the reconsideration found lacking is added to the requirement.
// Run:  node tests/sdp-after-renewal/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_after_renewal.sql", UNDO = "undo_sdp_after_renewal.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const uidOf = n => seedId(`scholar:${n}`);
const SEAD = seedId("staff:demo.sead"), EVALUATOR = seedId("staff:demo.evaluator");
const CS = "community_service", CV = "community_volunteerism", FP = "formation_program";

const Y1 = "2031-2032";                       // made-up years, so nothing of the seed data is in the way
const setPeriod = (y, s) => q("update grading_period_settings set current_school_year = $1, current_semester = $2 where id = true", [y, s]);
const acts = {};
for (const c of [CS, CV, FP]) acts[c] = (await q("insert into sdp_activities(category, credits, all_year_levels) values ($1, 1, true) returning id", [c]))[0].id;
const credit = (n, cat, sem, count) => count > 0 ? q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) select $1, $2, current_date, g, $3, $4 from generate_series(1, $5::int) g", [acts[cat], `TEST-${String(n).padStart(4, "0")}`, Y1, sem, count]) : null;
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const renewedFor = async (n, y, t, stage = "renewed") => (await q("insert into renewal_records (scholar_id_number, school_year, term, stage) values ($1, $2, $3, $4) returning id", [num(n), y, t, stage]))[0].id;
const mkReq = async (n, status) => (await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term, status, lacking) values ($1, $2, '2nd Semester', $2, '1st Semester', $3, '{}'::jsonb) returning id", [num(n), Y1, status]))[0].id;

// 41 = the example (3 / 1 / 3, reconsideration approved, renewed); 42 = 5 / 3 / 3 renewed with no reconsideration; 43 = 3 / 3 / 3 NOT renewed; 44 = 3 / 3 / 3, application only submitted
await setPeriod(Y1, "1st Semester");
await credit(41, CS, "1st Semester", 3); await credit(41, CV, "1st Semester", 1); await credit(41, FP, "1st Semester", 3);
await credit(42, CS, "1st Semester", 5); await credit(42, CV, "1st Semester", 3); await credit(42, FP, "1st Semester", 3);
await credit(43, CS, "1st Semester", 3); await credit(43, CV, "1st Semester", 3); await credit(43, FP, "1st Semester", 3);
await credit(44, CS, "1st Semester", 3); await credit(44, CV, "1st Semester", 3); await credit(44, FP, "1st Semester", 3);
const rq = await mkReq(41, "approved");
await q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, $3, 2, $4, '2nd Semester')", [rq, num(41), CV, Y1]);
const rec41 = await renewedFor(41, Y1, "2nd Semester"), rec42 = await renewedFor(42, Y1, "2nd Semester");
await renewedFor(44, Y1, "2nd Semester", "submitted");

const progress = async n => Object.fromEntries((await rows(uidOf(n), "select * from public.fetch_scholar_sdp_progress()")).map(r => [r.category, Number(r.credits)]));
const required = async n => Object.fromEntries((await rows(uidOf(n), "select * from public.fetch_scholar_sdp_requirements()")).map(r => [r.category, Number(r.required)]));
const triple = o => `${o[CS]}/${o[CV]}/${o[FP]}`;

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on: start from today's behaviour
console.log("Before the file (today's behaviour)");
check("the renewed scholar still sees the old numbers: 3/1/3 against 3/3/3", triple(await progress(41)) === "3/1/3" && triple(await required(41)) === "3/3/3", `${triple(await progress(41))} ${triple(await required(41))}`);
const evalBefore = JSON.stringify((await q("select community_service a, community_volunteerism b, formation_program c, applicable ap, complied co, missing m from public._sdp_compliance($1, '1st Semester', $2)", [Y1, num(41)]))[0]);
const savedBefore = JSON.stringify(await q("select scholar_id_number s, community_service a, community_volunteerism b, formation_program c, complied co from (select * from public._sdp_compliance_ids($1, '1st Semester', array['TEST-0041','TEST-0042','TEST-0043','TEST-0044'])) x order by 1", [Y1]));

await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nThe scholar's own SDP tab");
check("the example: 3/1/3 with the lacking credits added becomes 0/0/0 against 3/5/3 (Community Volunteerism needs 3 + the 2 that were lacking)", triple(await progress(41)) === "0/0/0" && triple(await required(41)) === "3/5/3", `${triple(await progress(41))} ${triple(await required(41))}`);
check("credits above the requirement carry on: 5/3/3 becomes 2/0/0 against 3/3/3", triple(await progress(42)) === "2/0/0" && triple(await required(42)) === "3/3/3", `${triple(await progress(42))} ${triple(await required(42))}`);
check("a scholar who is not renewed sees the semester as before: 3/3/3", triple(await progress(43)) === "3/3/3" && triple(await required(43)) === "3/3/3");
check("an application that is only submitted changes nothing: 3/3/3", triple(await progress(44)) === "3/3/3");
const view41 = (await rows(uidOf(41), "select * from public.fetch_scholar_sdp_view()"))[0], view43 = (await rows(uidOf(43), "select * from public.fetch_scholar_sdp_view()"))[0];
check("the tab is told which semester it shows: the next one for the renewed scholar, the current one for the others", view41.shifted === true && view41.school_year === Y1 && view41.semester === "2nd Semester" && view43.shifted === false && view43.semester === "1st Semester", JSON.stringify([view41, view43]));
const owed41 = await rows(uidOf(41), "select * from public.fetch_scholar_sdp_owed()");
check("the credits added to the requirement now count as THIS semester's (is_current) for the renewed scholar", owed41.length === 1 && owed41[0].category === CV && Number(owed41[0].amount) === 2 && owed41[0].is_current === true, JSON.stringify(owed41));
const sixMonths = await attempt(uidOf(41), "select public.fetch_scholar_sdp_view()");
check("only a signed-in scholar can ask", (await attempt(SEAD, "select * from public.fetch_scholar_sdp_view()")).ok === false && sixMonths.ok);

console.log("\nThe renewal itself is not touched");
check("the SDP check of the semester that was being renewed gives the same answer as before (complied through the approved reconsideration)", JSON.stringify((await q("select community_service a, community_volunteerism b, formation_program c, applicable ap, complied co, missing m from public._sdp_compliance($1, '1st Semester', $2)", [Y1, num(41)]))[0]) === evalBefore);
check("the totals the renewal counts for that semester are unchanged: 3 / 1 / 3", JSON.stringify((await q("select category c, total t from public._sdp_period_totals($1, '1st Semester', $2) order by 1", [Y1, num(41)]))) === JSON.stringify([{ c: CS, t: 3 }, { c: CV, t: 1 }, { c: FP, t: 3 }]));

console.log("\nThe staff SDP Checklist");
const page = async (filter = "all", sort = "default") => (await rows(SEAD, "select * from public.scholars_sdp_checklist_page($1, '1st Semester', '', $2, $3, 'asc', 1, 200)", [Y1, filter, sort]));
const row = (list, n) => list.find(r => r.scholar_id_number === num(n));
const all = await page();
check("renewed scholars are listed with the next semester's numbers (41: 0/0/0, not complied; 42: 2/0/0), the others with the current ones (43: 3/3/3, complied)", [row(all, 41).community_service, row(all, 41).community_volunteerism, row(all, 41).formation_program].join() === "0,0,0" && row(all, 41).complied === false
  && [row(all, 42).community_service, row(all, 42).community_volunteerism, row(all, 42).formation_program].join() === "2,0,0" && [row(all, 43).community_service, row(all, 43).community_volunteerism, row(all, 43).formation_program].join() === "3,3,3" && row(all, 43).complied === true, JSON.stringify([row(all, 41), row(all, 43)]));
const sorted = await page("all", "result");
check("sorting by Result (which uses the saved totals) gives the same rows and numbers", JSON.stringify(row(sorted, 41)) === JSON.stringify(row(all, 41)) && JSON.stringify(row(sorted, 43)) === JSON.stringify(row(all, 43)));
const notComplied = await page("not_complied"), complied = await page("complied");
check("the Complied / Not complied buttons follow the same numbers", !!row(notComplied, 41) && !row(complied, 41) && !!row(complied, 43) && !row(notComplied, 43));
const sum = (await rows(SEAD, "select * from public.scholars_sdp_checklist_summary($1, '1st Semester')", [Y1]))[0];
const countNow = (await rows(SEAD, "select count(*) filter (where complied is true)::int c, count(*) filter (where complied is false)::int n, count(*)::int t from public._sdp_compliance_saved($1, '1st Semester')", [Y1]).catch(() => [{}]))[0];
check("the counts at the top add up to the same list (renewed scholars counted at the next semester)", Number(sum.total) === Number(sum.complied) + Number(sum.not_complied), JSON.stringify(sum));
const extra = await rows(SEAD, "select * from public.scholars_sdp_extra_required($1, '1st Semester')", [Y1]);
check("what is added to the requirement shows for the renewed scholar: Community Volunteerism needs 2 more", extra.length === 1 && extra[0].scholar_id_number === num(41) && Number(extra[0].community_volunteerism) === 2 && Number(extra[0].community_service) === 0, JSON.stringify(extra));
const adv = await rows(SEAD, "select * from public.scholars_sdp_advanced($1, '1st Semester')", [Y1]);
check("the Checklist can tell which rows show the next semester (41 and 42), and which semester that is", adv.map(r => r.scholar_id_number).sort().join() === `${num(41)},${num(42)}` && adv.every(r => r.next_school_year === Y1 && r.next_semester === "2nd Semester"), JSON.stringify(adv));
check("another semester picked on the Checklist is shown as it is (nobody is moved)", (await rows(SEAD, "select * from public.scholars_sdp_advanced($1, '2nd Semester')", [Y1])).length === 0
  && Number((await rows(SEAD, "select community_service c from public.scholars_sdp_checklist_page($1, '1st Semester', 'TEST-0043', 'all', 'default', 'asc', 1, 5)", [Y1]))[0].c) === 3);
check("plain staff without the SDP tag cannot ask for these", !(await attempt(seedId("staff:demo.plain"), "select * from public.scholars_sdp_advanced($1, '1st Semester')", [Y1])).ok);

console.log("\nThe renewal detail page");
const after41 = (await rows(EVALUATOR, "select public.renewal_sdp_after($1) r", [rec41]))[0].r;
check("a renewed application shows the SDP after it: next semester, 0 / 0 / 0 against 3 / 5 / 3", after41.applies === true && after41.school_year === Y1 && after41.semester === "2nd Semester"
  && [after41.community_service, after41.community_volunteerism, after41.formation_program].join() === "0,0,0" && [after41.required_community_service, after41.required_community_volunteerism, after41.required_formation_program].join() === "3,5,3", JSON.stringify(after41));
const after42 = (await rows(EVALUATOR, "select public.renewal_sdp_after($1) r", [rec42]))[0].r;
check("a scholar renewed with no reconsideration: 2 / 0 / 0 against 3 / 3 / 3", [after42.community_service, after42.community_volunteerism, after42.formation_program].join() === "2,0,0" && [after42.required_community_service, after42.required_community_volunteerism, after42.required_formation_program].join() === "3,3,3");
const notRenewedRec = (await q("select id from renewal_records where scholar_id_number = $1", [num(44)]))[0].id;
check("an application that is not renewed has no 'after' box", (await rows(EVALUATOR, "select public.renewal_sdp_after($1) r", [notRenewedRec]))[0].r.applies === false);
check("only staff who can see renewals can ask", !(await attempt(seedId("staff:demo.plain"), "select public.renewal_sdp_after($1)", [rec41])).ok);

console.log("\nWhen CEDO changes the grading period");
await setPeriod(Y1, "2nd Semester");
check("once the current period is the next semester the scholar sees it as usual (no second deduction): still 0/0/0 against 3/5/3, and nobody is shifted any more", triple(await progress(41)) === "0/0/0" && triple(await required(41)) === "3/5/3"
  && (await rows(uidOf(41), "select * from public.fetch_scholar_sdp_view()"))[0].shifted === false && (await rows(SEAD, "select * from public.scholars_sdp_advanced($1, '2nd Semester')", [Y1])).length === 0);
check("the scholar who was not renewed gets the same carry-over as before: 3/3/3 becomes 0/0/0", triple(await progress(43)) === "0/0/0");
await setPeriod(Y1, "1st Semester");

console.log("\nThe undo and the file");
await db.exec(read(UNDO));
check("after the undo the renewed scholar sees the current semester again: 3/1/3 against 3/3/3", triple(await progress(41)) === "3/1/3" && triple(await required(41)) === "3/3/3");
check("after the undo the Checklist rows are as before, and the new functions are gone", JSON.stringify(row(await page(), 41)) && row(await page(), 41).community_service === 3
  && (await q("select to_regprocedure('public._sdp_view_period(text)') is null a, to_regprocedure('public.renewal_sdp_after(uuid)') is null b, to_regprocedure('public._sdp_compliance_saved_plain(text,text)') is null c"))[0].a);
await db.exec(read(FILE));
check("the file can be put back after an undo", triple(await progress(41)) === "0/0/0");
const text = read(FILE).replace(/--.*$/gm, "");
check("functions only: no table is changed or emptied", !/(alter table|drop table|delete from|truncate|create table|insert into)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
await db.close?.();
