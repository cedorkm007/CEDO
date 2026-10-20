// tests/sdp-update/phase1_db_tests.mjs — SDP Monitoring update, Phase 1, against the real migration files in memory.
//   B2  only the right people can create attendance codes (attack tests: visitor, scholar, staff with no tools)
//   B3  the credit history only grows and records every credit change and every category change
//   B1a the faster Checklist calculation gives exactly the same answers as the old one
// Run:  node tests/sdp-update/phase1_db_tests.mjs
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
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain"), STORAGE2 = staffUid("demo.storage2"), SEADHEAD = staffUid("demo.seadhead");

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
// The function as the database itself would run it (as owner) while a given person is signed in: tests the check INSIDE the function.
async function insideAs(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid ?? "", JSON.stringify(uid ? { sub: uid, role: "authenticated" } : { role: "anon" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const failsInside = async (uid, sql, params, pattern) => { try { await insideAs(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };

const EMPTY_ARRAYS = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
async function makeActivity(name, type, category, dateTime, endTime, extra = []) {
  return (await q(`insert into sdp_activities (name, category, activity_type, date_time, end_time, recurring_dates, credits, all_year_levels, created_by, organization, venue,
      nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters)
    values ($1, $2, $3, $4, $5, $6::jsonb, 1, true, $7, 'org', 'venue', ${EMPTY_ARRAYS}) returning id`,
    [name, category, type, dateTime, endTime, JSON.stringify(extra), SEAD]))[0].id;
}
async function makeSession(activityId, type, n) {
  const s = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, $2, $3, $4, $5) returning id", [activityId, type, n, type === "voucher" ? 1 : null, SEAD]))[0].id;
  const codes = { time_in: [], time_out: [], voucher: [] };
  for (const kind of type === "voucher" ? ["voucher"] : ["time_in", "time_out"]) {
    for (let i = 0; i < n; i++) { const code = crypto.randomBytes(5).toString("hex").toUpperCase(); codes[kind].push(code); await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, $3, 1)", [s, code, kind]); }
  }
  return { id: s, codes };
}
const redeem = async (n, code) => { try { return { ok: true, r: (await rows(scholarUid(n), "select public.redeem_attendance_code($1) r", [code]))[0].r }; } catch (e) { return { ok: false, error: String(e.message) }; } };
const hist = (activity, extra = "") => q(`select * from sdp_credit_history where activity_id = $1 ${extra} order by occurred_at, id`, [activity]);

await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_monitoring') on conflict do nothing", [STORAGE2]);   // STORAGE2 = staff holding ONLY the SDP Monitoring tag (not SEAD staff)
const day = (offset, hour) => `2026-10-${String(20 + offset).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+08:00`;
const act = await makeActivity("TEST – Phase 1 activity", "one_time", "community_service", day(0, 9), day(0, 11));
const sess = await makeSession(act, "voucher", 5);
const codesBefore = Number((await q("select count(*) n from attendance_codes where session_id = $1", [sess.id]))[0].n);

console.log("\nB2: creating attendance codes");
const GEN = "select public.generate_attendance_codes($1::uuid, 'voucher', 3, 9)";
check("a visitor who is not signed in cannot call it", await fails(null, GEN, [sess.id], /permission denied/i, "anon"));
check("a signed-in scholar cannot call it", await fails(scholarUid(1), GEN, [sess.id], /permission denied/i));
check("staff with no tools cannot call it", await fails(PLAIN, GEN, [sess.id], /permission denied/i));
check("even SDP Monitoring staff cannot call it DIRECTLY (only the staff-checked screens can)", await fails(SEAD, GEN, [sess.id], /permission denied/i));
check("nothing was created by the refused attempts", Number((await q("select count(*) n from attendance_codes where session_id = $1", [sess.id]))[0].n) === codesBefore);
// the check inside the function itself (in case the closed door is ever opened again by mistake)
const GEN_Q = "select public.generate_attendance_codes($1::uuid, 'voucher', 2, 7)";
check("inside the function: no signed-in person is refused", await failsInside(null, GEN_Q, [sess.id], /Sign in/i));
check("inside the function: a scholar is refused", await failsInside(scholarUid(1), GEN_Q, [sess.id], /not allowed/i));
check("inside the function: staff with no tools are refused", await failsInside(PLAIN, GEN_Q, [sess.id], /not allowed/i));
check("inside the function: SEAD staff without the SDP tag are still allowed (SEAD staff may manage attendance)", !(await failsInside(SEADHEAD, GEN_Q, [sess.id])));
check("inside the function: a staff member holding the SDP Monitoring tag is allowed", !(await failsInside(STORAGE2, "select public.generate_attendance_codes($1::uuid, 'voucher', 2, 8)", [sess.id])));
check("inside the function: a made-up session is refused", await failsInside(SEAD, GEN_Q, [crypto.randomUUID()], /not found/i));
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2)", [act, PLAIN]);
check("inside the function: a monitor assigned to THIS activity is allowed", !(await failsInside(PLAIN, "select public.generate_attendance_codes($1::uuid, 'voucher', 2, 6)", [sess.id])));
const other = await makeActivity("TEST – Someone else's activity", "one_time", "community_service", day(0, 9), day(0, 11));
const otherSess = await makeSession(other, "voucher", 1);
check("inside the function: that same monitor is refused for ANOTHER activity", await failsInside(PLAIN, GEN_Q, [otherSess.id], /not allowed/i));
await q("delete from activity_monitors where activity_id = $1", [act]);
const fAct = (await q("insert into formation_activities (name, short_description, date_time, venue, target_year_levels, all_year_levels, attendance_enabled) values ('TEST – Formation for monitor', 'd', now(), 'v', '{}', true, true) returning id"))[0].id;
const fSess = (await q("insert into attendance_sessions (formation_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 2, 1, $2) returning id", [fAct, SEAD]))[0].id;
check("inside the function: staff with no tools are refused for a Formation session", await failsInside(PLAIN, "select public.generate_attendance_codes($1::uuid, 'voucher', 2, 5)", [fSess], /not allowed/i));
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('formation', $1, $2)", [fAct, PLAIN]);
check("inside the function: a monitor of THAT Formation activity is allowed (this is how a monitor such as sead.saps keeps working)", !(await failsInside(PLAIN, "select public.generate_attendance_codes($1::uuid, 'voucher', 2, 5)", [fSess])));
await q("delete from activity_monitors where activity_id = $1", [fAct]);
check("a scholar cannot add codes straight into the table either", await fails(scholarUid(1), "insert into attendance_codes (session_id, code, kind, batch_number) values ($1, 'HACKED1', 'voucher', 1)", [sess.id], /row-level security|permission denied/i));
check("a visitor cannot add codes straight into the table", await fails(null, "insert into attendance_codes (session_id, code, kind, batch_number) values ($1, 'HACKED2', 'voucher', 1)", [sess.id], /permission denied|row-level security/i, "anon"));

console.log("\nB2: the Formation screen that does need it keeps working");
const fa = (await q("insert into formation_activities (name, short_description, date_time, venue, target_year_levels, all_year_levels, attendance_enabled) values ('TEST – Formation', 'd', now(), 'v', '{}', true, true) returning id"))[0].id;
const created = await rows(SEAD, "select public.create_formation_attendance_session_with_codes($1::uuid, 'voucher', 4, 1) id", [fa]).catch(e => ({ error: String(e.message) }));
check("SEAD staff can still create a Formation session with its codes (4 codes)", !created.error && Number((await q("select count(*) n from attendance_codes where session_id = $1", [created[0]?.id]))[0].n) === 4, created.error);
check("staff with no tools cannot create a Formation session", await fails(PLAIN, "select public.create_formation_attendance_session_with_codes($1::uuid, 'voucher', 4, 1)", [fa], /Not authorized/i));
check("a scholar cannot create a Formation session", await fails(scholarUid(1), "select public.create_formation_attendance_session_with_codes($1::uuid, 'voucher', 4, 1)", [fa], /Not authorized/i));

console.log("\nB3: the credit history");
const got = await redeem(5, sess.codes.voucher[0]);
let h = await hist(act);
check("a scholar's scan is credited and written to the history as 'scholar_scan' with the scholar's name", got.ok && h.length === 1 && h[0].event_type === "credit_added" && h[0].source === "scholar_scan" && h[0].scholar_id_number === num(5) && !!h[0].actor_name && h[0].activity_name === "TEST – Phase 1 activity" && h[0].category === "community_service");
const token = (await q("select qr_token from scholars where scholar_id_number = $1", [num(6)]))[0].qr_token;
const mon = await rows(SEAD, "select public.record_monitor_attendance('sdp', $1::uuid, 'voucher', $2::uuid, null::text) r", [act, token]).then(r => r[0].r).catch(e => ({ error: String(e.message) }));
h = await hist(act, "and scholar_id_number = '" + num(6) + "'");
check("a monitor's scan of an ID card is written as 'monitor_scan' by that staff member", !mon.error && h.length === 1 && h[0].source === "monitor_scan" && /SEAD/.test(h[0].actor_name || ""), mon.error);
await rows(SEAD, "insert into sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, school_year, semester) values ($1, $2, current_date, $3, '2025-2026', '2nd Semester') on conflict (activity_id, scholar_id_number, occurrence_number) do nothing", [act, num(7), SEAD]);
h = await hist(act, "and scholar_id_number = '" + num(7) + "'");
check("a credit added by hand is written as 'manual'", h.length === 1 && h[0].source === "manual" && h[0].school_year === "2025-2026" && h[0].semester === "2nd Semester");
await rows(SEAD, "delete from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [act, num(7)]);
h = await hist(act, "and scholar_id_number = '" + num(7) + "'");
check("removing it writes a second line ('credit_removed'); the first line is still there", h.length === 2 && h[1].event_type === "credit_removed" && h[0].event_type === "credit_added");
// a scholar who attended but has no credit -> "Credit these scholars"
const attendedOnly = await makeActivity("TEST – attended without credit", "one_time", null, day(0, 9), day(0, 11));
const sa = await makeSession(attendedOnly, "voucher", 2);
await redeem(8, sa.codes.voucher[0]);
check("a scan on an activity that has no category is still written to the history (category left blank)", (await hist(attendedOnly)).length === 1 && (await hist(attendedOnly))[0].category === null);
await q("delete from sdp_attendance where activity_id = $1", [attendedOnly]);   // make the scholar 'attended, but no credit' (the TestQR situation)
await q("update sdp_activities set category = 'formation_program' where id = $1", [attendedOnly]);
const credited = await rows(SEAD, "select public.credit_attended_scholars($1::uuid) n", [attendedOnly]);
h = await hist(attendedOnly, "and source = 'credit_attended'");
check("'Credit these scholars' credits the scholar and writes 'credit_attended' lines", Number(credited[0].n) === 1 && h.length === 1 && h[0].source === "credit_attended");
const hintLeft = (await q("select coalesce(current_setting('app.sdp_source', true), '') v"))[0].v;
check("the label used for that does not leak into later changes", hintLeft === "" || hintLeft === null);
// category changes
const catHist = await hist(attendedOnly, "and event_type = 'category_changed'");
check("changing an activity's category from none to a category is written to the history (from / to)", catHist.length === 1 && catHist[0].details.from === null && catHist[0].details.to === "formation_program");
await q("update sdp_activities set category = 'community_volunteerism' where id = $1", [attendedOnly]);
const moved = (await q("select count(*) n from sdp_attendance where activity_id = $1", [attendedOnly]))[0].n;
check("changing the category again is logged, and the credit stays (not deleted, not duplicated)", (await hist(attendedOnly, "and event_type = 'category_changed'")).length === 2 && Number(moved) === 1);
await q("update sdp_activities set venue = 'elsewhere' where id = $1", [attendedOnly]);
check("an edit that is not about the category writes nothing", (await hist(attendedOnly, "and event_type = 'category_changed'")).length === 2);
// credit moved to another semester
await q("update sdp_attendance set semester = '1st Semester' where activity_id = $1", [attendedOnly]);
const ch = await hist(attendedOnly, "and event_type = 'credit_changed'");
check("moving a credit to another semester writes 'credit_changed' with the old and new semester", ch.length === 1 && ch[0].details.to.semester === "1st Semester");
// deleting an activity keeps its history
const before = Number((await q("select count(*) n from sdp_credit_history where activity_id = $1", [act]))[0].n);
await rows(SEAD, "delete from sdp_attendance where activity_id = $1", [act]);
await q("delete from attendance_records where session_id in (select id from attendance_sessions where sdp_activity_id = $1)", [act]);
await q("delete from attendance_codes where session_id in (select id from attendance_sessions where sdp_activity_id = $1)", [act]);
await q("delete from attendance_sessions where sdp_activity_id = $1", [act]);
await rows(SEAD, "delete from sdp_activities where id = $1", [act]);
check("deleting an activity does not delete its history (the removals are recorded too)", Number((await q("select count(*) n from sdp_credit_history where activity_id = $1", [act]))[0].n) > before);

console.log("\nB3: the history cannot be changed");
const one = (await q("select id from sdp_credit_history limit 1"))[0].id;
check("a line cannot be edited, even by the database owner", await fails(null, "update sdp_credit_history set scholar_id_number = 'X' where id = $1", [one], /read-only/i, "postgres").catch(() => false) || await (async () => { try { await q("update sdp_credit_history set scholar_id_number = 'X' where id = $1", [one]); return false; } catch (e) { return /read-only/.test(String(e.message)); } })());
check("a line cannot be deleted, even by the database owner", await (async () => { try { await q("delete from sdp_credit_history where id = $1", [one]); return false; } catch (e) { return /read-only/.test(String(e.message)); } })());
check("the history cannot be emptied", await (async () => { try { await q("truncate sdp_credit_history"); return false; } catch (e) { return /read-only/.test(String(e.message)); } })());
check("staff cannot add a made-up line", await fails(SEAD, "insert into sdp_credit_history (event_type, source) values ('credit_added', 'forged')", [], /permission denied/i));
check("staff cannot edit a line through the website", await fails(SEAD, "update sdp_credit_history set source = 'x'", [], /permission denied/i));
check("staff cannot delete a line through the website", await fails(SEAD, "delete from sdp_credit_history", [], /permission denied/i));
check("a visitor cannot read the history", await fails(null, "select * from sdp_credit_history", [], /permission denied/i, "anon"));

console.log("\nB3: who can read the history");
const rd = async uid => (await rows(uid, "select count(*) n from sdp_credit_history where activity_id = $1", [attendedOnly]))[0].n;
check("SEAD staff can read it", Number(await rd(SEAD)) > 0);
check("a staff member with the SDP Monitoring tag can read it", Number(await rd(STORAGE2)) > 0);
check("staff with no tools see nothing", Number(await rd(PLAIN)) === 0);
check("a scholar sees nothing", Number(await rd(scholarUid(8))) === 0);
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2)", [attendedOnly, PLAIN]);
check("an activity's own monitor sees that activity's history", Number(await rd(PLAIN)) > 0);
check("…but not another activity's", Number((await rows(PLAIN, "select count(*) n from sdp_credit_history where activity_id = $1", [other]))[0].n) === 0);

console.log("\nB1: the faster Checklist calculation gives the same answers");
const oldDef = fs.readFileSync("supabase_migration_sdp_show_total_credits_over_required.sql", "utf8");
const s0 = oldDef.indexOf("create or replace function public._sdp_period_totals(");
const oldFn = oldDef.slice(s0, oldDef.indexOf("$$;", s0) + 3).replace("public._sdp_period_totals(", "public._sdp_period_totals_old(");
await q(oldFn);
// Add credits across five semesters so carry-over, summer and several categories are all exercised.
const periods = [["2024-2025", "1st Semester"], ["2024-2025", "2nd Semester"], ["2024-2025", "Summer"], ["2025-2026", "1st Semester"], ["2025-2026", "2nd Semester"]];
const cats = ["community_service", "community_volunteerism", "formation_program"];
const acts = [];
for (let i = 0; i < 12; i++) acts.push(await makeActivity(`TEST – compare ${i}`, "one_time", cats[i % 3], day(0, 9), day(0, 11)));
await q("update sdp_activities set credits = 2 where id = any($1::uuid[]) and name like '%compare 1%'", [acts]);
let seedN = 0;
const existing = (await q("select scholar_id_number from scholars where scholar_id_number like 'TEST-%' order by 1")).map(r => r.scholar_id_number);
for (const [s, sid] of existing.entries()) for (const [p, [sy, sem]] of periods.entries()) for (let k = 0; k < (s + p) % 5; k++) {
  const a = acts[(s * 3 + p * 5 + k * 7) % acts.length];
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, $2, current_date, $3, $4, $5) on conflict do nothing", [a, sid, sy, sem, 100 + seedN++]);
}
let totalRows = 0, diffRows = 0;
for (const [sy, sem] of periods) {
  const a = await q("select scholar_id_number, category, total from public._sdp_period_totals($1, $2) order by 1, 2", [sy, sem]);
  const b = await q("select scholar_id_number, category, total from public._sdp_period_totals_old($1, $2) order by 1, 2", [sy, sem]);
  totalRows += a.length; if (JSON.stringify(a) !== JSON.stringify(b)) diffRows += 1;
  for (const sid of [existing[0], existing[6], existing[19], existing[30], existing[40]]) {
    const x = await q("select category, total from public._sdp_period_totals($1, $2, $3) order by 1", [sy, sem, sid]);
    const y = await q("select category, total from public._sdp_period_totals_old($1, $2, $3) order by 1", [sy, sem, sid]);
    if (JSON.stringify(x) !== JSON.stringify(y)) diffRows += 1;
  }
}
check(`new and old calculation agree for all five semesters, all scholars and single scholars (${totalRows} rows compared)`, totalRows > 100 && diffRows === 0);
const comp = await rows(SEAD, "select count(*) n from public.scholars_sdp_compliance('2025-2026', '2nd Semester')");
check("the Checklist function that uses it still returns every active scholar", Number(comp[0].n) === Number((await q("select count(*) n from scholars where status <> 'Removed'"))[0].n), JSON.stringify(comp[0]));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
