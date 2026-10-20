// tests/sdp-update/phase5_db_tests.mjs — SDP Monitoring update, Phase 5: the semester a credit counts in.
//   • "Credit these scholars" with a chosen semester (default: the current grading period; never twice; only known semesters; who may)
//   • moving one credit to another semester (history line, nothing added or removed, who may)
//   • the "TestQR" situation: present but not credited, and a credit stamped with the wrong semester
// Run:  node tests/sdp-update/phase5_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain"), MONITOR = staffUid("demo.monitor");
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
const read = f => fs.readFileSync(f, "utf8");

const cur = (await q("select current_school_year sy, current_semester sem from grading_period_settings where id = true"))[0];
const known = await q("select school_year sy, term from academic_periods order by school_year, term");
const other = known.find(p => !(p.sy === cur.sy && p.term === cur.sem)) ?? { sy: "2024-2025", term: "1st Semester" };
const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
async function makeActivity(name, category = "community_service") {
  return (await q(`insert into sdp_activities (name, category, activity_type, date_time, end_time, recurring_dates, credits, all_year_levels, created_by, organization, venue,
      nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters)
    values ($1, $2, 'one_time', now(), now() + interval '2 hours', '[]'::jsonb, 1, true, $3, 'org', 'venue', ${EMPTY}) returning id`, [name, category, SEAD]))[0].id;
}
// the TestQR situation: scholars are present in the attendance records but have no credit
async function presentButNotCredited(activity, scholars) {
  const s = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 5, 1, $2) returning id", [activity, SEAD]))[0].id;
  for (const n of scholars) await q("insert into attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count) values ($1, $2, 1, 'present', 1)", [s, num(n)]);
  return s;
}
const credit = (activity, n) => q("select id, school_year, semester from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [activity, num(n)]);
const crediting = (uid, activity, sy, sem) => rows(uid, "select public.credit_attended_scholars($1::uuid, $2::text, $3::text) n", [activity, sy, sem]);

console.log("\n“Credit these scholars” with a chosen semester");
check("the semester choice only accepts semesters the system knows", (await q("select public._sdp_period_is_known($1, $2) k, public._sdp_period_is_known('1999-2000', '1st Semester') u", [cur.sy, cur.sem]))[0].k === true && (await q("select public._sdp_period_is_known('1999-2000', '1st Semester') u"))[0].u === false);
const a1 = await makeActivity("TEST – Phase 5 chosen semester");
await presentButNotCredited(a1, [2, 3]);
const r1 = await crediting(SEAD, a1, other.sy, other.term);
const c2 = await credit(a1, 2), c3 = await credit(a1, 3);
check("both scholars are credited, stamped with the CHOSEN semester (not the current one)", Number(r1[0].n) === 2 && c2.length === 1 && c3.length === 1 && c2[0].school_year === other.sy && c2[0].semester === other.term && c3[0].semester === other.term);
const r1b = await crediting(SEAD, a1, cur.sy, cur.sem);
check("pressing it again credits nobody twice (a scholar who already has a credit for the activity is skipped)", Number(r1b[0].n) === 0 && (await credit(a1, 2)).length === 1 && (await credit(a1, 2))[0].semester === other.term);
const a2 = await makeActivity("TEST – Phase 5 default semester");
await presentButNotCredited(a2, [5]);
const r2 = await rows(SEAD, "select public.credit_attended_scholars($1::uuid) n", [a2]);
check("the old one-argument form still credits in the current grading period", Number(r2[0].n) === 1 && (await credit(a2, 5))[0].school_year === cur.sy && (await credit(a2, 5))[0].semester === cur.sem);
const a3 = await makeActivity("TEST – Phase 5 empty semester");
await presentButNotCredited(a3, [6]);
const r3 = await crediting(SEAD, a3, null, null);
check("giving no semester also means the current grading period", Number(r3[0].n) === 1 && (await credit(a3, 6))[0].semester === cur.sem);
const a4 = await makeActivity("TEST – Phase 5 unknown semester");
await presentButNotCredited(a4, [7]);
check("a semester that is not on record is refused and nobody is credited", await fails(SEAD, "select public.credit_attended_scholars($1::uuid, '1999-2000', '1st Semester')", [a4], /not on record/i) && (await credit(a4, 7)).length === 0);
check("staff with no tools, a scholar and a visitor cannot use it", await fails(PLAIN, "select public.credit_attended_scholars($1::uuid, $2, $3)", [a4, cur.sy, cur.sem], /not allowed/i) && await fails(scholarUid(1), "select public.credit_attended_scholars($1::uuid, $2, $3)", [a4, cur.sy, cur.sem], /not allowed|permission denied/i) && await fails(null, "select public.credit_attended_scholars($1::uuid, $2, $3)", [a4, cur.sy, cur.sem], /permission denied/i, "anon"));
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2)", [a4, MONITOR]);
check("a monitor of THAT activity can use it", Number((await crediting(MONITOR, a4, cur.sy, cur.sem))[0].n) === 1);
const noCat = await makeActivity("TEST – Phase 5 no category", null);
await presentButNotCredited(noCat, [8]);
check("an activity with no category still cannot be credited (as before)", await fails(SEAD, "select public.credit_attended_scholars($1::uuid, $2, $3)", [noCat, cur.sy, cur.sem], /Choose an SDP category/));

console.log("\nMoving one credit to another semester");
const mv = await makeActivity("TEST – Phase 5 move");
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number, created_by) values ($1, $2, current_date, $3, $4, 1, $5)", [mv, num(4), cur.sy, cur.sem, SEAD]);   // stamped with the CURRENT semester
const mvId = (await credit(mv, 4))[0].id;
const complianceIn = async (sy, sem) => (await rows(SEAD, "select * from public.scholars_sdp_compliance($1, $2)", [sy, sem])).find(r => r.scholar_id_number === num(4));
const totalBefore = Number((await q("select count(*) n from sdp_attendance"))[0].n);
await rows(SEAD, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [mvId, other.sy, other.term]);
const moved = (await credit(mv, 4))[0];
check("the credit now counts in the other semester", moved.school_year === other.sy && moved.semester === other.term);
check("nothing was added or removed: the number of credits is the same", totalBefore === Number((await q("select count(*) n from sdp_attendance"))[0].n));
const line = (await q("select * from sdp_credit_history where activity_id = $1 and scholar_id_number = $2 and event_type = 'credit_changed'", [mv, num(4)]))[0];
check("the move is in the credit history with the old and the new semester, who did it, and how", line && line.source === "semester_move" && line.details.from.semester === cur.sem && line.details.to.semester === other.term && line.actor_name === "TEST SEAD Staff");
const histBefore = Number((await q("select count(*) n from sdp_credit_history"))[0].n);
await rows(SEAD, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [mvId, other.sy, other.term]);
check("moving it to the semester it is already in does nothing (no new history line)", histBefore === Number((await q("select count(*) n from sdp_credit_history"))[0].n));
check("an unknown semester is refused", await fails(SEAD, "select public.move_sdp_credit_semester($1::uuid, '1999-2000', '1st Semester')", [mvId], /not on record/i));
check("staff with no tools, a scholar and a visitor cannot move a credit; the credit stays where it is", await fails(PLAIN, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [mvId, cur.sy, cur.sem], /not allowed/i) && await fails(scholarUid(4), "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [mvId, cur.sy, cur.sem], /not allowed|permission denied/i) && await fails(null, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [mvId, cur.sy, cur.sem], /permission denied/i, "anon") && (await credit(mv, 4))[0].semester === other.term);
check("a credit that does not exist is refused", await fails(SEAD, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [crypto.randomUUID(), cur.sy, cur.sem], /not found/i));
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2)", [mv, MONITOR]);
check("the monitor of that activity can move its credits back", (await rows(MONITOR, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [mvId, cur.sy, cur.sem])).length === 1 && (await credit(mv, 4))[0].semester === cur.sem);

console.log("\nThe TestQR situation");
const tq = await makeActivity("TEST – TestQR (Not Credited in SDP)", "community_volunteerism");
await presentButNotCredited(tq, [2, 3]);                                   // present, no credit
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number, created_by) values ($1, $2, current_date, $3, $4, 1, $5)", [tq, num(4), cur.sy, cur.sem, SEAD]);   // manual credit stamped with the wrong (current) semester
const before = { s4: (await credit(tq, 4))[0], n: Number((await q("select count(*) n from sdp_attendance where activity_id = $1", [tq]))[0].n) };
await crediting(SEAD, tq, other.sy, other.term);
await rows(SEAD, "select public.move_sdp_credit_semester($1::uuid, $2, $3)", [before.s4.id, other.sy, other.term]);
const after = await q("select scholar_id_number, school_year, semester from sdp_attendance where activity_id = $1 order by 1", [tq]);
check("scholars 0002 and 0003 are credited and scholar 0004's credit is moved: all three now count in the same, correct semester, 3 credits in all, nobody twice", after.length === 3 && after.every(r => r.school_year === other.sy && r.semester === other.term) && before.n === 1);
check("the history of the activity tells the whole story (two credits added, one credit moved)", (await q("select count(*) n from sdp_credit_history where activity_id = $1 and event_type = 'credit_added'", [tq]))[0].n >= 3 && (await q("select count(*) n from sdp_credit_history where activity_id = $1 and event_type = 'credit_changed'", [tq]))[0].n === 1);

console.log("\nThe undo");
await db.exec(read("undo_sdp_update_p5.sql"));
check("the new functions are gone and the one-argument form works as before", (await q("select count(*) n from pg_proc where proname in ('move_sdp_credit_semester', '_sdp_period_is_known')"))[0].n === 0 && (await q("select count(*) n from pg_proc where proname = 'credit_attended_scholars'"))[0].n === 1);
const a5 = await makeActivity("TEST – Phase 5 after undo");
await presentButNotCredited(a5, [9]);
check("after the undo “Credit these scholars” credits in the current grading period, exactly as before", Number((await rows(SEAD, "select public.credit_attended_scholars($1::uuid) n", [a5]))[0].n) === 1 && (await credit(a5, 9))[0].semester === cur.sem);
await db.exec(read("supabase_migration_sdp_update_p5_semester.sql"));
await db.exec(read("supabase_migration_sdp_update_p5_semester.sql"));
check("the SQL can be put back (and run twice)", (await q("select count(*) n from pg_proc where proname = 'move_sdp_credit_semester'"))[0].n === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
