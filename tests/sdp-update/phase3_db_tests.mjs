// tests/sdp-update/phase3_db_tests.mjs — SDP Monitoring update, Phase 3: sub-categories, against the real migration files in memory.
//   • the column and its two rules; who may change it; the history line; credits and Complied/Not complied are not affected
//   • the backfill (existing categorized activities -> CEDO Projects) is safe, saves a backup first, can be re-run and undone
//   • the undo files work
// Run:  node tests/sdp-update/phase3_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain"), MONITOR = staffUid("demo.monitor"), COUNSELOR = staffUid("demo.counselor");
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role) => as(uid, async tx => (await tx.query(sql, params)).rows, role);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fails = async (sql, params, pattern, uid = null) => { try { if (uid === null) await q(sql, params); else await rows(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const read = f => fs.readFileSync(f, "utf8");

const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
async function makeActivity(name, category, sub = null, credits = 1) {
  return (await q(`insert into sdp_activities (name, category, sub_category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
    values ($1, $2, $3, 'one_time', now(), $4, true, 'o', 'v', ${EMPTY}, '[]'::jsonb) returning id`, [name, category, sub, credits]))[0].id;
}
const hist = (id, extra = "") => q(`select * from sdp_credit_history where activity_id = $1 and event_type = 'category_changed' ${extra} order by occurred_at, id`, [id]);

console.log("\nThe column and its rules");
check("the column exists and starts empty for an activity made without one", (await q("select sub_category from sdp_activities where id = $1", [await makeActivity("TEST – p3 none", "community_service")]))[0].sub_category === null);
check("each of the three values is accepted", await (async () => { for (const v of ["school_based", "community_based", "cedo_projects"]) await makeActivity("TEST – p3 " + v, "formation_program", v); return true; })());
check("any other value is refused", await fails("insert into sdp_activities (name, category, sub_category, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, recurring_dates, target_year_levels, target_barangays, target_clusters) values ('x', 'formation_program', 'something_else', '[]','[]','[]','[]','[]','[]','[]','[]','[]','{}','{}','{}')", [], /sdp_activities_sub_category_values|check constraint/i));
check("a sub-category without a category is refused (new activity)", await fails("insert into sdp_activities (name, category, sub_category, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, recurring_dates, target_year_levels, target_barangays, target_clusters) values ('x', null, 'school_based', '[]','[]','[]','[]','[]','[]','[]','[]','[]','{}','{}','{}')", [], /sdp_activities_sub_category_needs_category|check constraint/i));
const a1 = await makeActivity("TEST – p3 main", "community_service", "school_based", 2);
check("a sub-category without a category is refused (editing: clearing the category while a sub-category is set)", await fails("update sdp_activities set category = null where id = $1", [a1], /sdp_activities_sub_category_needs_category|check constraint/i));
check("the category can be cleared together with the sub-category", (await q("update sdp_activities set category = null, sub_category = null where id = $1 returning id", [a1])).length === 1);
await q("update sdp_activities set category = 'community_service', sub_category = 'school_based' where id = $1", [a1]);

console.log("\nCredits and Complied / Not complied are not affected");
// (The demo's staff rule for SDP Monitoring staff on this table stands in for the live project's: see localdemo/seed.mjs. Monitors of an activity are covered by the real rule from the project files.)
const SY = "2025-2026", SEM = "2nd Semester";
for (const n of [1, 2, 3, 4]) await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, current_date, $3, $4, 1) on conflict do nothing", [a1, `TEST-${String(n).padStart(4, "0")}`, SY, SEM]);
const snapshot = async () => ({ credits: (await q("select count(*) n from sdp_attendance where activity_id = $1", [a1]))[0].n, compliance: JSON.stringify(await rows(SEAD, "select * from public.scholars_sdp_compliance($1, $2)", [SY, SEM])) });
const before = await snapshot();
await q("update sdp_activities set sub_category = 'community_based' where id = $1", [a1]);
const afterSub = await snapshot();
check("changing the sub-category leaves every credit and every Complied / Not complied result exactly as they were", before.credits === afterSub.credits && before.compliance === afterSub.compliance);
await q("update sdp_activities set sub_category = 'cedo_projects' where id = $1", [a1]);
await q("update sdp_activities set sub_category = 'school_based' where id = $1", [a1]);
check("…even after several changes (nothing lost, nothing duplicated)", before.credits === (await snapshot()).credits && before.compliance === (await snapshot()).compliance);
await q("update sdp_activities set category = 'formation_program' where id = $1", [a1]);
check("changing the CATEGORY keeps every credit (they belong to the activity; the 4 credit rows are all still there once)", Number((await snapshot()).credits) === Number(before.credits) && Number((await q("select count(distinct (scholar_id_number, occurrence_number)) n from sdp_attendance where activity_id = $1", [a1]))[0].n) === Number(before.credits));
await q("update sdp_activities set category = 'community_service' where id = $1", [a1]);

console.log("\nEvery change is in the history");
const h = await hist(a1);
const subLines = h.filter(x => x.details.field === "sub_category").slice(-3);   // the last three changes made above
check("each sub-category change wrote one line with the old and the new value", subLines.length === 3 && subLines[0].details.from === "school_based" && subLines[0].details.to === "community_based" && subLines[1].details.to === "cedo_projects" && subLines[2].details.to === "school_based");
check("each category change wrote its own line, marked as the category", h.filter(x => x.details.field === "category").length >= 3);
const countBefore = h.length;
await q("update sdp_activities set venue = 'elsewhere' where id = $1", [a1]);
check("an edit that is not about the category or sub-category writes nothing", (await hist(a1)).length === countBefore);
check("who made the change is recorded when a staff member does it through the website", await (async () => { await rows(SEAD, "update sdp_activities set sub_category = 'cedo_projects' where id = $1", [a1]); const last = (await hist(a1, "and details->>'field' = 'sub_category'")).pop(); return last.actor_name === "TEST SEAD Staff" && last.details.to === "cedo_projects"; })());

console.log("\nWho may change it");
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2) on conflict do nothing", [a1, MONITOR]);
const change = (uid, id, v) => rows(uid, "update sdp_activities set sub_category = $2 where id = $1 returning id", [id, v]);
check("SDP Monitoring staff can", (await change(SEAD, a1, "school_based")).length === 1);
check("the monitor of THAT activity can", (await change(MONITOR, a1, "community_based")).length === 1);
const other = await makeActivity("TEST – p3 other", "community_service", "school_based");
check("the same monitor cannot change another activity", (await change(MONITOR, other, "cedo_projects")).length === 0);
check("staff with no tools cannot", (await change(PLAIN, a1, "cedo_projects")).length === 0);
check("a scholar cannot", (await change(scholarUid(1), a1, "cedo_projects")).length === 0);
check("a visitor cannot", await (async () => { try { return (await rows(null, "update sdp_activities set sub_category = 'cedo_projects' where id = $1 returning id", [a1], "anon")).length === 0; } catch { return true; } })());
check("nothing was changed by the refused attempts", (await q("select sub_category from sdp_activities where id = $1", [a1]))[0].sub_category === "community_based");
check("a scholar can read the sub-category of an open activity (it is shown in the scholar portal)", (await rows(scholarUid(1), "select sub_category from sdp_activities where id = $1", [a1])).length === 1);

console.log("\nThe backfill: existing categorized activities go to CEDO Projects");
const oldA = await makeActivity("TEST – p3 old A", "community_service", null);
const oldB = await makeActivity("TEST – p3 old B", "formation_program", null);
const keepC = await makeActivity("TEST – p3 already set", "formation_program", "school_based");
const noCat = await makeActivity("TEST – p3 uncategorized", null, null);
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, 'TEST-0005', current_date, $2, $3, 1)", [oldA, SY, SEM]);
const creditsBefore = (await q("select count(*) n from sdp_attendance"))[0].n, complianceBefore = JSON.stringify(await rows(SEAD, "select * from public.scholars_sdp_compliance($1, $2)", [SY, SEM]));
const histBefore = Number((await q("select count(*) n from sdp_credit_history"))[0].n);
await db.exec(read("supabase_migration_sdp_update_p3b_backfill_cedo_projects.sql"));
const sub = id => q("select sub_category from sdp_activities where id = $1", [id]).then(r => r[0].sub_category);
check("categorized activities without a sub-category are now CEDO Projects", (await sub(oldA)) === "cedo_projects" && (await sub(oldB)) === "cedo_projects");
check("an activity that already had a sub-category keeps it", (await sub(keepC)) === "school_based");
check("an activity with no category is left alone", (await sub(noCat)) === null);
check("what each one had before was saved first (the backup holds exactly the activities that were changed, each with its old value)", await (async () => {
  const b = await q("select * from sdp_subcategory_backfill_backup");
  const changed = new Set((await q("select id from sdp_activities where sub_category = 'cedo_projects'")).map(r => r.id));
  return b.length > 0 && b.every(x => changed.has(x.activity_id) && x.previous_sub_category === null) && [oldA, oldB].every(id => b.some(x => x.activity_id === id)) && !b.some(x => [keepC, noCat].includes(x.activity_id));
})());
check("credits and every Complied / Not complied result are exactly as before", creditsBefore === (await q("select count(*) n from sdp_attendance"))[0].n && complianceBefore === JSON.stringify(await rows(SEAD, "select * from public.scholars_sdp_compliance($1, $2)", [SY, SEM])));
const backfillLines = (await hist(oldA)).filter(x => x.details.field === "sub_category" && x.details.to === "cedo_projects");
check("each changed activity got one line in the history, from nothing to CEDO Projects, done by the system", backfillLines.length === 1 && backfillLines[0].details.from === null && backfillLines[0].actor_name === null);
const backupCount = (await q("select count(*) n from sdp_subcategory_backfill_backup"))[0].n, histAfterFirst = Number((await q("select count(*) n from sdp_credit_history"))[0].n);
await db.exec(read("supabase_migration_sdp_update_p3b_backfill_cedo_projects.sql"));
check("running it a second time changes nothing more (no new backup rows, no new history lines)", backupCount === (await q("select count(*) n from sdp_subcategory_backfill_backup"))[0].n && histAfterFirst === Number((await q("select count(*) n from sdp_credit_history"))[0].n));
check("the backup table cannot be read or changed from the website", await fails("select * from public.sdp_subcategory_backfill_backup", [], /permission denied/, SEAD) && await fails("delete from public.sdp_subcategory_backfill_backup", [], /permission denied/, SEAD));
await q("update sdp_activities set sub_category = 'community_based' where id = $1", [oldB]);   // staff change one after the backfill
await db.exec(read("undo_sdp_update_p3b.sql"));
check("the undo puts the backfilled activities back to no sub-category", (await sub(oldA)) === null);
check("…but leaves alone one that staff changed since, and activities that were never backfilled", (await sub(oldB)) === "community_based" && (await sub(keepC)) === "school_based");
check("…and removes the backup table", (await q("select count(*) n from pg_tables where tablename = 'sdp_subcategory_backfill_backup'"))[0].n === 0);
check("credits are still exactly as before after the undo", creditsBefore === (await q("select count(*) n from sdp_attendance"))[0].n);

console.log("\nThe undo of the column itself");
await db.exec(read("undo_sdp_update_p3.sql"));
check("the column and its rules are gone", (await q("select count(*) n from information_schema.columns where table_name = 'sdp_activities' and column_name = 'sub_category'"))[0].n === 0 && (await q("select count(*) n from pg_constraint where conname like 'sdp_activities_sub_category%'"))[0].n === 0);
check("changing a category still works and is still written to the history (the Phase 1 function is back)", await (async () => { const c = (await hist(a1)).length; await q("update sdp_activities set category = 'formation_program' where id = $1", [a1]); return (await hist(a1)).length === c + 1; })());
await db.exec(read("supabase_migration_sdp_update_p3_subcategory.sql"));
await db.exec(read("supabase_migration_sdp_update_p3_subcategory.sql"));
check("the SQL can be put back (and run twice)", (await q("select count(*) n from information_schema.columns where table_name = 'sdp_activities' and column_name = 'sub_category'"))[0].n === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
