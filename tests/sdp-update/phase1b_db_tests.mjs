// tests/sdp-update/phase1b_db_tests.mjs — Phase 1b: the live "staff full access" rule on the attendance tables is replaced by narrow rules.
// The test first puts the live situation back (the undo file recreates the open rule), proves the hole, applies the 1b file, and re-tests.
// Run:  node tests/sdp-update/phase1b_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain"), MONITOR = staffUid("demo.monitor"), STORAGE2 = staffUid("demo.storage2"), SEADHEAD = staffUid("demo.seadhead");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = [], role) => as(uid, async tx => (await tx.query(sql, params)).rows, role);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const works = async (uid, sql, params, role) => { try { await rows(uid, sql, params, role); return true; } catch { return false; } };

// ── put the LIVE situation back: the open "staff full access" rules, and the Formation functions open to anon ──
await db.exec(fs.readFileSync("undo_sdp_update_p1b.sql", "utf8"));
const act = (await q(`insert into sdp_activities (name, category, activity_type, date_time, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters, recurring_dates)
  values ('TEST – 1b', 'community_service', 'one_time', now(), 1, true, 'o', 'v', '[]','[]','[]','[]','[]','[]','[]','[]','{}','{}','{}','[]'::jsonb) returning id`))[0].id;
const sess = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 3, 1, $2) returning id", [act, SEAD]))[0].id;
await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, 'AAAA1111', 'voucher', 1), ($1, 'AAAA2222', 'voucher', 1)", [sess]);
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholars_formation') on conflict do nothing", [STORAGE2]);   // STORAGE2 = Formation tag only here
await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'storage_tool'", [STORAGE2]);

console.log("\nBefore the fix (the live situation)");
check("the hole is real: staff with NO tools can add a code straight into the table", await works(PLAIN, "insert into attendance_codes (session_id, code, kind, batch_number) values ($1, 'HOLE0001', 'voucher', 1)", [sess]));
check("…and read the codes", (await rows(PLAIN, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n > 0);
await q("delete from attendance_codes where code = 'HOLE0001'");

console.log("\nApplying the 1b file");
await db.exec(fs.readFileSync("supabase_migration_sdp_update_p1b_close_staff_full_access.sql", "utf8"));
await db.exec(fs.readFileSync("supabase_migration_sdp_update_p1b_close_staff_full_access.sql", "utf8"));   // twice: it must be safe to re-run
check("the open rules are gone and the narrow ones exist", (await q("select count(*) n from pg_policies where tablename in ('attendance_sessions','attendance_codes') and policyname = 'staff full access'"))[0].n === 0
  && (await q("select count(*) n from pg_policies where policyname in ('staff read attendance sessions','tool staff read attendance codes')"))[0].n === 2);

console.log("\nAttack tests (must now fail)");
const ins = "insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', 1)";
check("staff with no tools cannot add a code into the table", !(await works(PLAIN, ins, [sess, "HACK0001"])));
check("a monitor with no tools cannot add a code into the table", !(await works(MONITOR, ins, [sess, "HACK0002"])));
check("a Formation-tag-only staff member cannot add a code into the table", !(await works(STORAGE2, ins, [sess, "HACK0003"])));
check("a scholar cannot add a code", !(await works(scholarUid(1), ins, [sess, "HACK0004"])));
check("a visitor cannot add a code", !(await works(null, ins, [sess, "HACK0005"], "anon")));
check("staff with no tools cannot read the codes (they see zero)", Number((await rows(PLAIN, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) === 0);
check("a monitor with no tools cannot read the codes", Number((await rows(MONITOR, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) === 0);
check("a scholar cannot read the codes", Number((await rows(scholarUid(1), "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) === 0);
await rows(PLAIN, "delete from attendance_codes where session_id = $1", [sess]);
await rows(PLAIN, "update attendance_codes set redeemed_by_scholar_id = 'TEST-0001', redeemed_at = now() where session_id = $1", [sess]);
check("staff with no tools cannot delete or change codes (all codes intact and unused)", Number((await q("select count(*) n from attendance_codes where session_id = $1 and redeemed_by_scholar_id is null", [sess]))[0].n) === 2);
check("staff with no tools cannot create a session", !(await works(PLAIN, "insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 1, 1, $2)", [act, PLAIN])));
await rows(PLAIN, "delete from attendance_sessions where id = $1", [sess]);
check("staff with no tools cannot delete a session", Number((await q("select count(*) n from attendance_sessions where id = $1", [sess]))[0].n) === 1);
check("a visitor cannot call the Formation function", !(await works(null, "select public.create_formation_attendance_session_with_codes(gen_random_uuid(), 'voucher', 1, 1)", [], "anon")));

console.log("\nEverything that should still work");
check("SEAD staff can read and add codes", Number((await rows(SEAD, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) === 2 && await works(SEAD, ins, [sess, "SEAD0001"]));
check("SEAD staff without the SDP tag (head of SEAD) can read and add codes", Number((await rows(SEADHEAD, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) >= 2 && await works(SEADHEAD, ins, [sess, "SEAD0002"]));
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_monitoring') on conflict do nothing", [PLAIN]);
check("a staff member given the SDP Monitoring tag can read and add codes", Number((await rows(PLAIN, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) >= 2 && await works(PLAIN, ins, [sess, "SDP00001"]));
await q("delete from staff_account_tags where staff_id = $1 and tag_key = 'sdp_monitoring'", [PLAIN]);
check("a Formation-tag staff member can still READ codes (the Formation screen needs it)", Number((await rows(STORAGE2, "select count(*) n from attendance_codes where session_id = $1", [sess]))[0].n) >= 2);
check("the activity monitor's scanner can still read the session type (any staff can read sessions)", (await rows(MONITOR, "select type from attendance_sessions where sdp_activity_id = $1", [act])).length === 1);
check("a scholar still redeems a code (through the function)", await (async () => { const r = await rows(scholarUid(2), "select public.redeem_attendance_code('AAAA1111') r"); return !!r[0].r; })().catch(() => false));
const token = (await q("select qr_token from scholars where scholar_id_number = 'TEST-0003'"))[0].qr_token;
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2) on conflict do nothing", [act, MONITOR]);
check("a monitor can still scan a scholar's ID card for their activity (through the function)", await works(MONITOR, "select public.record_monitor_attendance('sdp', $1::uuid, 'voucher', $2::uuid, null::text)", [act, token]));
const fa = (await q("insert into formation_activities (name, short_description, date_time, venue, target_year_levels, all_year_levels, attendance_enabled) values ('TEST – F1b', 'd', now(), 'v', '{}', true, true) returning id"))[0].id;
check("SEAD staff can still create a Formation session with its codes", await works(SEAD, "select public.create_formation_attendance_session_with_codes($1::uuid, 'voucher', 3, 1)", [fa]));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
