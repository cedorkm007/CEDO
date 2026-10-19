// tests/sdp-monitoring/run_db_tests.mjs — SDP Monitoring fixes, against the real migration files in memory.
//   • recurring activities: one scan per DAY (counted in Philippine time, not UTC), for vouchers AND for Time-in / Time-out
//   • a one-time activity behaves exactly as before
//   • banking when the category is already complete (once per new credited day), the survey gate, the monitor's own scan
//   • the pubmat picture of an SDP activity can be saved by SDP-monitoring staff (not only SEAD staff)
// Run:  node tests/sdp-monitoring/run_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.query("set timezone to 'UTC'");   // the real database runs in UTC; the checks must not depend on this computer's time zone

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain"), STORAGE2 = staffUid("demo.storage2");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid, role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fails = async (uid, sql, params, pattern) => { try { await rows(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };

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
const creditRows = (activity, n) => q("select occurrence_number from sdp_attendance where activity_id = $1 and scholar_id_number = $2 order by 1", [activity, num(n)]);
const record = async (session, n) => (await q("select * from attendance_records where session_id = $1 and scholar_id_number = $2", [session, num(n)]))[0];
const allowed = async id => (await q("select public._sdp_allowed_occurrences($1) n", [id]))[0].n;

console.log("\nHow many days an activity has");
const day = (offset, hour) => `2026-10-${String(20 + offset).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+08:00`;
const a1 = await makeActivity("One time", "one_time", "community_service", day(0, 9), day(0, 11));
const a2 = await makeActivity("3 days", "recurring", "community_volunteerism", day(0, 9), day(0, 11), [{ date: day(1, 9), endTime: day(1, 11), venue: "v" }, { date: day(2, 9), endTime: day(2, 11), venue: "v" }]);
const a3 = await makeActivity("Early second day", "recurring", "formation_program", day(0, 9), day(0, 11), [{ date: day(1, 5), endTime: day(1, 8), venue: "v" }]);
const a4 = await makeActivity("Same day twice", "recurring", "formation_program", day(0, 9), day(0, 11), [{ date: day(0, 14), endTime: day(0, 16), venue: "v" }, { date: day(1, 9), endTime: day(1, 11), venue: "v" }]);
const a5 = await makeActivity("No dates yet", "recurring", "formation_program", null, null, []);
check("a one-time activity allows one scan", (await allowed(a1)) === 1);
check("a recurring activity allows one scan per day (3 days = 3)", (await allowed(a2)) === 3);
check("days are Philippine calendar days: 9:00 AM on the 20th and 5:00 AM on the 21st are TWO days (in UTC both are the 20th)", (await allowed(a3)) === 2);
check("two occurrences on the same day count once", (await allowed(a4)) === 2);
check("a recurring activity with no dates yet still allows one scan", (await allowed(a5)) === 1);

console.log("\nRecurring VOUCHER activity");
const sv = await makeSession(a2, "voucher", 8);
const v = [];
for (let i = 0; i < 4; i++) v.push(await redeem(30, sv.codes.voucher[i]));
check("three scans work (one per day) and the fourth is refused, saying how many were used", v[0].ok && v[1].ok && v[2].ok && !v[3].ok && /3 of 3 allowed/.test(v[3].error));
check("each scan is credited as its own occurrence, and the refused code was not used up", (await creditRows(a2, 30)).length === 3 && (await q("select redeemed_by_scholar_id from attendance_codes where code = $1", [sv.codes.voucher[3]]))[0].redeemed_by_scholar_id === null);
const tz = await makeSession(a3, "voucher", 4);
const t1 = await redeem(31, tz.codes.voucher[0]), t2 = await redeem(31, tz.codes.voucher[1]);
check("the 9 AM / 5 AM activity now accepts its second day", t1.ok && t2.ok);

console.log("\nRecurring TIME-IN / TIME-OUT activity");
const st = await makeSession(a2, "time_in_time_out", 8).catch(() => null);
check("an activity can have its session made (the earlier voucher session is separate)", st === null || st.id !== sv.id);
// a2 already has a voucher session; use a fresh 3-day activity for the time-in/out checks
const b = await makeActivity("3 days time in out", "recurring", "community_service", day(0, 9), day(0, 11), [{ date: day(1, 9), endTime: day(1, 11), venue: "v" }, { date: day(2, 9), endTime: day(2, 11), venue: "v" }]);
const sb = await makeSession(b, "time_in_time_out", 6);
const log = [];
for (let d = 0; d < 3; d++) { log.push(await redeem(29, sb.codes.time_in[d])); log.push(await redeem(29, sb.codes.time_out[d])); }
check("one time-in and one time-out per day work for 3 days", log.every(x => x.ok));
check("every complete day is credited (3 credit rows) and the record says present with 3 days", (await creditRows(b, 29)).length === 3 && (await record(sb.id, 29)).status === "present" && (await record(sb.id, 29)).time_in_count === 3 && (await record(sb.id, 29)).time_out_count === 3);
const extra = await redeem(29, sb.codes.time_in[3]), extraOut = await redeem(29, sb.codes.time_out[3]);
check("a fourth day is refused for both time-in and time-out", !extra.ok && !extraOut.ok && /3 of 3 allowed/.test(extra.error));
const sb2 = await makeSession(await makeActivity("time in out partial", "recurring", "community_service", day(0, 9), day(0, 11), [{ date: day(1, 9), endTime: day(1, 11), venue: "v" }]), "time_in_time_out", 4);
const act2 = (await q("select sdp_activity_id from attendance_sessions where id = $1", [sb2.id]))[0].sdp_activity_id;
await redeem(33, sb2.codes.time_in[0]);
check("a time-in alone is not credited and the scholar shows as incomplete", (await creditRows(act2, 33)).length === 0 && (await record(sb2.id, 33)).status === "incomplete");
await redeem(33, sb2.codes.time_out[0]);
check("the time-out completes day 1: one credit", (await creditRows(act2, 33)).length === 1 && (await record(sb2.id, 33)).status === "present");
await redeem(33, sb2.codes.time_in[1]);
check("the next day's time-in alone adds no credit yet and keeps the scholar present", (await creditRows(act2, 33)).length === 1 && (await record(sb2.id, 33)).status === "present");
await redeem(33, sb2.codes.time_out[1]);
check("its time-out completes day 2: a second credit", (await creditRows(act2, 33)).length === 2);

console.log("\nA one-time activity is unchanged");
const so = await makeSession(a1, "time_in_time_out", 4);
const o = [await redeem(34, so.codes.time_in[0]), await redeem(34, so.codes.time_out[0]), await redeem(34, so.codes.time_in[1]), await redeem(34, so.codes.time_out[1])];
check("one time-in and one time-out, credited once; a second time-in or time-out is refused with the plain message", o[0].ok && o[1].ok && !o[2].ok && !o[3].ok && /^You already completed this attendance requirement\.$/.test(o[2].error) && (await creditRows(a1, 34)).length === 1);
const sov = await makeSession(await makeActivity("one time voucher", "one_time", "community_service", day(0, 9), day(0, 11)), "voucher", 3);
const ov = [await redeem(34, sov.codes.voucher[0]), await redeem(34, sov.codes.voucher[1])];
check("a one-time voucher activity still allows exactly one scan", ov[0].ok && !ov[1].ok);

console.log("\nA scholar who already has 3 credits in the category");
// Since supabase_migration_sdp_show_total_credits_over_required.sql nothing is banked any more: every finished day is a credit row, and the total can go above 3.
const full = 1;   // TEST-0001 has 3 credits in every category in the demo data
const capAct = await makeActivity("cap days", "recurring", "community_service", day(0, 9), day(0, 11), [{ date: day(1, 9), endTime: day(1, 11), venue: "v" }]);
const sc = await makeSession(capAct, "time_in_time_out", 4);
const reservedBefore = Number((await q("select count(*) n from sdp_reserved_credits where scholar_id_number = $1", [num(full)]))[0].n);
const cr = [];
for (let d = 0; d < 2; d++) { cr.push(await redeem(full, sc.codes.time_in[d])); cr.push(await redeem(full, sc.codes.time_out[d])); }
const reservedAfter = Number((await q("select count(*) n from sdp_reserved_credits where scholar_id_number = $1", [num(full)]))[0].n);
check("each finished day is a credit row (2 days = 2 rows, 5 credits in all), and nothing is set aside as 'saved for later'", cr.every(x => x.ok) && (await creditRows(capAct, full)).length === 2 && reservedAfter === reservedBefore
  && (await q("select public._sdp_period_credits($1, 'community_service', '2025-2026', '2nd Semester') n", [num(full)]))[0].n === 5);


console.log("\nThe survey gate");
const g = await makeActivity("gated", "recurring", "community_volunteerism", day(0, 9), day(0, 11), [{ date: day(1, 9), endTime: day(1, 11), venue: "v" }]);
const survey = (await q("insert into research_surveys (title, sdp_activity_id) values ('S', $1) returning id", [g]))[0].id;
const sg = await makeSession(g, "time_in_time_out", 4);
await redeem(35, sg.codes.time_in[0]); const gOut = await redeem(35, sg.codes.time_out[0]);
check("a time-out with a survey waiting makes the scholar 'waiting for the survey' and gives no credit yet", gOut.ok && (await record(sg.id, 35)).status === "pending_survey" && (await creditRows(g, 35)).length === 0);
await q("create unique index if not exists test_finalized_unique on scholar_attendance_finalized_notifications (session_id, scholar_id_number)");   // the live table has this rule; the demo copy may not
await q("select public._finalize_survey_gated_attendance($1, $2, $3)", [scholarUid(35), num(35), survey]);
check("answering the survey makes them present and credits the finished day", (await record(sg.id, 35)).status === "present" && (await creditRows(g, 35)).length === 1);

console.log("\nThe monitor's own scan (scholar ID card)");
const mon = await makeActivity("monitor scan", "recurring", "formation_program", day(0, 9), day(0, 11), [{ date: day(1, 9), endTime: day(1, 11), venue: "v" }]);
const sm = await makeSession(mon, "time_in_time_out", 3);
const token = (await q("select qr_token from scholars where scholar_id_number = $1", [num(36)]))[0].qr_token;
const scan = kind => rows(SEAD, "select public.record_monitor_attendance('sdp', $1::uuid, $2, $3::uuid, null::text) r", [mon, kind, token]).then(r => r[0].r).catch(e => ({ outcome: "error", error: String(e.message) }));
const m = [await scan("time_in"), await scan("time_out"), await scan("time_in"), await scan("time_out"), await scan("time_in")];
check("a monitor can scan a recurring activity's time-in and time-out on each day, and the extra scan is reported as already scanned", m.slice(0, 4).every(x => x.outcome === "success") && m[4].outcome === "already_scanned" && (await creditRows(mon, 36)).length === 2);

console.log("\nOld records keep working");
check("existing time-in / time-out records were given their counts", (await q("select count(*)::int n from attendance_records where time_in_at is not null and time_in_count = 0"))[0].n === 0 && (await q("select count(*)::int n from attendance_records where time_out_at is not null and time_out_count = 0"))[0].n === 0);
check("the two SQL files can be run again without harm", await (async () => {
  for (const f of ["supabase_migration_sdp_recurring_attendance_fix.sql", "supabase_migration_activity_pubmats_sdp_monitors.sql", "supabase_migration_sdp_credit_attended_scholars.sql"]) await db.exec(fs.readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"));
  return (await allowed(a3)) === 2;
})());

console.log("\nThe pubmat of an SDP activity");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_monitoring') on conflict do nothing", [PLAIN]);
const putPic = (uid, name) => rows(uid, "insert into storage.objects (bucket_id, name, owner, metadata) values ('activity-pubmats', $1, $2, '{}'::jsonb) returning name", [name, uid]);
const pic = `sdp/${a1}/pubmat-1700000000000.jpg`;
check("SDP-monitoring staff who are NOT SEAD staff can store a picture for an SDP activity (this was refused before)", (await q("select is_sead_staff from users where id = $1", [PLAIN]))[0].is_sead_staff === false && (await putPic(PLAIN, pic)).length === 1);
check("…but not for a Formation activity, a Quest subject, or a path that is not an activity", await fails(PLAIN, "insert into storage.objects (bucket_id, name, owner, metadata) values ('activity-pubmats', $1, $2, '{}'::jsonb)", [`formation/${a1}/pubmat.jpg`, PLAIN])
  && await fails(PLAIN, "insert into storage.objects (bucket_id, name, owner, metadata) values ('activity-pubmats', $1, $2, '{}'::jsonb)", [`quest/${a1}/pubmat.jpg`, PLAIN]) && await fails(PLAIN, "insert into storage.objects (bucket_id, name, owner, metadata) values ('activity-pubmats', 'sdp/not-an-id/x.jpg', $1, '{}'::jsonb)", [PLAIN]));
check("staff without the tag cannot store a picture; SEAD staff still can (everything that worked before still works)", await fails(STORAGE2, "insert into storage.objects (bucket_id, name, owner, metadata) values ('activity-pubmats', $1, $2, '{}'::jsonb)", [pic.replace("1700000000000", "1"), STORAGE2])
  && (await putPic(SEAD, `quest/${crypto.randomUUID()}/pubmat.jpg`)).length === 1);
await rows(PLAIN, "select public.set_activity_pubmat('sdp', $1, $2)", [a1, pic]);
check("the picture's path is saved on the activity by the new function", (await q("select pubmat_path from sdp_activities where id = $1", [a1]))[0].pubmat_path === pic);
check("the function refuses a path of another activity, an unknown activity, a different kind, and people who may not", await fails(PLAIN, "select public.set_activity_pubmat('sdp', $1, $2)", [a1, `sdp/${a2}/pubmat.jpg`], /does not belong/)
  && await fails(PLAIN, "select public.set_activity_pubmat('sdp', $1, $2)", [crypto.randomUUID(), null], /not found/) && await fails(PLAIN, "select public.set_activity_pubmat('quest', $1, null)", [a1], /not allowed/)
  && await fails(STORAGE2, "select public.set_activity_pubmat('sdp', $1, null)", [a1], /not allowed/));
await rows(PLAIN, "select public.set_activity_pubmat('sdp', $1, null)", [a1]);
check("a picture can be removed again", (await q("select pubmat_path from sdp_activities where id = $1", [a1]))[0].pubmat_path === null);

console.log("\nCrediting scholars who attended but have no credit");
// the situation found on the real project: an activity made without a category, scanned, the category chosen afterwards
const late = await makeActivity("created without a category", "one_time", null, day(0, 9), day(0, 11));
const sl = await makeSession(late, "time_in_time_out", 5);
for (const n of [20, 21]) { await redeem(n, sl.codes.time_in[n - 20]); await redeem(n, sl.codes.time_out[n - 20]); }
await redeem(22, sl.codes.time_in[2]);   // timed in only: not present
await q("delete from sdp_attendance where activity_id = $1", [late]);   // present, but no credit row
check("with no category the function refuses and says to choose one first", await fails(SEAD, "select public.credit_attended_scholars($1)", [late], /Choose an SDP category/));
await q("update sdp_activities set category = 'community_service' where id = $1", [late]);
const credited = (await rows(SEAD, "select public.credit_attended_scholars($1) n", [late]))[0].n;
check("once the category is chosen, every present scholar is credited (2), the one who only timed in is not, in the current semester, marked as added by staff",
  credited === 2 && (await creditRows(late, 20)).length === 1 && (await creditRows(late, 21)).length === 1 && (await creditRows(late, 22)).length === 0
  && (await q("select created_by from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [late, num(20)]))[0].created_by === SEAD
  && (await q("select semester from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [late, num(20)]))[0].semester === "2nd Semester");
check("pressing it again credits nobody twice", (await rows(SEAD, "select public.credit_attended_scholars($1) n", [late]))[0].n === 0 && (await creditRows(late, 20)).length === 1);
check("people who are not SDP / SEAD staff or monitors of the activity are refused, and an unknown activity is reported", await fails(STORAGE2, "select public.credit_attended_scholars($1)", [late], /not allowed/) && await fails(SEAD, "select public.credit_attended_scholars($1)", [crypto.randomUUID()], /not found/));
check("the credited scholars now count in the category total", Number((await q("select public._sdp_period_credits($1, 'community_service', '2025-2026', '2nd Semester') n", [num(20)]))[0].n) >= 1);

console.log(`\n${failed ? "SOME CHECKS FAILED" : "ALL SDP MONITORING DATABASE CHECKS PASSED"} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
