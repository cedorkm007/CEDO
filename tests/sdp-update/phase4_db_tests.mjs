// tests/sdp-update/phase4_db_tests.mjs — SDP Monitoring update, Phase 4: sub-names for the days of a recurring activity (codes per day, Option X).
//   • codes carry a day; credits remember their day; the sub-name of that day is returned by the scan
//   • counting is exactly as before (one credit per day, the number of days limits the scans); sub-names are labels only
//   • one code per day per scholar (and the refused scan does not use up the code)
//   • older codes, monitor scans, the survey path and "Credit these scholars" keep working and also label their day
//   • the undo puts everything back
// Run:  node tests/sdp-update/phase4_db_tests.mjs
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
const SEAD = staffUid("demo.sead"), PLAIN = staffUid("demo.plain");
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");

const EMPTY = "'[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}'";
const manila = d => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);   // the Philippine calendar day of an instant
const dayIso = (offset, hour) => { const base = new Date(); const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offset, hour - 8, 0, 0)); return d.toISOString(); };
const dayDate = offset => manila(new Date(dayIso(offset, 12)));   // the Manila date of "today + offset"
async function makeActivity(name, type, subName, extra = [], base = dayIso(0, 9), category = "community_service") {
  return (await q(`insert into sdp_activities (name, category, activity_type, date_time, end_time, recurring_dates, sub_name, credits, all_year_levels, created_by, organization, venue,
      nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters)
    values ($1, $2, $3, $4, $5, $6::jsonb, $7, 1, true, $8, 'org', 'venue', ${EMPTY}) returning id`,
    [name, category, type, base, new Date(new Date(base).getTime() + 2 * 3600e3).toISOString(), JSON.stringify(extra), subName, SEAD]))[0].id;
}
const occ = (offset, subName) => ({ date: dayIso(offset, 9), endTime: dayIso(offset, 11), venue: "v", ...(subName ? { subName } : {}) });
async function makeSession(activityId, type, perDay) {   // perDay = [{ day: 'YYYY-MM-DD' | null, n }]
  const s = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, $2, 10, $3, $4) returning id", [activityId, type, type === "voucher" ? 1 : null, SEAD]))[0].id;
  const codes = [];
  for (const [i, { day, n }] of perDay.entries()) for (const kind of type === "voucher" ? ["voucher"] : ["time_in", "time_out"]) for (let k = 0; k < n; k++) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    await q("insert into attendance_codes (session_id, code, kind, batch_number, day_date) values ($1, $2, $3, $4, $5)", [s, code, kind, i + 1, day]);
    codes.push({ code, kind, day });
  }
  return { id: s, codes, pick: (kind, day, k = 0) => codes.filter(c => c.kind === kind && c.day === day)[k].code };
}
const redeem = async (n, code) => { try { return { ok: true, r: (await rows(scholarUid(n), "select public.redeem_attendance_code($1) r", [code]))[0].r }; } catch (e) { return { ok: false, error: String(e.message) }; } };
const credits = (act, n) => q("select occurrence_number, activity_day::text as activity_day from sdp_attendance where activity_id = $1 and scholar_id_number = $2 order by 1", [act, num(n)]);
const codeUsed = async code => (await q("select redeemed_by_scholar_id from attendance_codes where code = $1", [code]))[0].redeemed_by_scholar_id !== null;

const D1 = dayDate(0), D2 = dayDate(1), D3 = dayDate(2);
console.log("\nThe days of an activity and their sub-names");
const act = await makeActivity("TEST – Coastal Clean-up Series", "recurring", "Day 1 – Macabalan Beach", [occ(1, "Day 2 – Bonbon Shoreline"), occ(2, null)]);
const days = await q("select day::text as day, sub_name from public._sdp_schedule_days($1) order by ord", [act]);
check("the activity has three days, in order, with their sub-names (the third has none)", days.length === 3 && days[0].day === D1 && days[0].sub_name === "Day 1 – Macabalan Beach" && days[1].sub_name === "Day 2 – Bonbon Shoreline" && days[2].sub_name === null);
check("the sub-name of one day can be asked for", (await q("select public._sdp_day_sub_name($1, $2::date) s", [act, D2]))[0].s === "Day 2 – Bonbon Shoreline" && (await q("select public._sdp_day_sub_name($1, $2::date) s", [act, D3]))[0].s === null);

console.log("\nVoucher codes made per day (scenario 11, 12, 13)");
const sess = await makeSession(act, "voucher", [{ day: D1, n: 4 }, { day: D2, n: 4 }, { day: D3, n: 4 }]);
const r1 = await redeem(30, sess.pick("voucher", D1, 0)), r2 = await redeem(30, sess.pick("voucher", D2, 0)), r3 = await redeem(30, sess.pick("voucher", D3, 0));
check("each day's code is accepted and the answer says which day it was (the sub-name of that day, empty for the day without one)", r1.ok && r2.ok && r3.ok && r1.r.daySubName === "Day 1 – Macabalan Beach" && r2.r.daySubName === "Day 2 – Bonbon Shoreline" && (r3.r.daySubName === null || r3.r.daySubName === undefined) && r3.r.day === D3);
const c30 = await credits(act, 30);
check("each credit remembers its own day, one credit per day (3 credits)", c30.length === 3 && c30[0].activity_day === D1 && c30[1].activity_day === D2 && c30[2].activity_day === D3);
const legacy = await makeSession(act, "voucher", [{ day: null, n: 2 }]).catch(() => null);
check("a fourth scan is still refused by the number of days, as before (3 of 3 allowed)", await (async () => {
  const extra = crypto.randomBytes(5).toString("hex").toUpperCase();
  await q("insert into attendance_codes (session_id, code, kind, batch_number, day_date) values ($1, $2, 'voucher', 9, null)", [sess.id, extra]);
  const r = await redeem(30, extra);
  return !r.ok && /3 of 3 allowed/.test(r.error) && !(await codeUsed(extra));
})());
const rDup1 = await redeem(31, sess.pick("voucher", D1, 1)), rDup2 = await redeem(31, sess.pick("voucher", D1, 2));
check("two codes of the SAME day cannot both be used by one scholar; the second is refused, says which day, and is not used up", rDup1.ok && !rDup2.ok && /already scanned a code for this day \(Day 1 – Macabalan Beach\)/.test(rDup2.error) && !(await codeUsed(sess.pick("voucher", D1, 2))) && (await credits(act, 31)).length === 1);
check("…but a code of another day is accepted by that same scholar", (await redeem(31, sess.pick("voucher", D2, 1))).ok && (await credits(act, 31)).length === 2);
check("another scholar can use the same day's other codes (the rule is per scholar)", (await redeem(33, sess.pick("voucher", D1, 2))).ok);

console.log("\nSub-names are only labels: counting is identical without them");
const ctl = await makeActivity("TEST – Control without sub-names", "recurring", null, [occ(1, null), occ(2, null)]);
const ctlSess = await makeSession(ctl, "voucher", [{ day: null, n: 5 }]);
const ctlRuns = [];
for (let i = 0; i < 4; i++) ctlRuns.push(await redeem(34, ctlSess.pick("voucher", null, i)));
check("an identical activity with no sub-names and no day codes gives the same result: three credits and a refused fourth", ctlRuns.slice(0, 3).every(x => x.ok) && !ctlRuns[3].ok && (await credits(ctl, 34)).length === 3 && c30.length === 3);
const before = JSON.stringify(await rows(SEAD, "select * from public.scholars_sdp_compliance('2025-2026', '2nd Semester')"));
await q("update sdp_activities set sub_name = 'a brand new sub-name', recurring_dates = (select jsonb_agg(e || '{\"subName\": \"changed\"}'::jsonb) from jsonb_array_elements(recurring_dates) e) where id = $1", [act]);
check("changing the sub-names changes no credit and no Complied / Not complied result", before === JSON.stringify(await rows(SEAD, "select * from public.scholars_sdp_compliance('2025-2026', '2nd Semester')")) && (await credits(act, 30)).length === 3);
await q("update sdp_activities set sub_name = 'Day 1 – Macabalan Beach', recurring_dates = (select jsonb_agg(case when n = 1 then e || '{\"subName\": \"Day 2 – Bonbon Shoreline\"}'::jsonb else e - 'subName' end) from jsonb_array_elements(recurring_dates) with ordinality as t(e, n)) where id = $1", [act]);

console.log("\nTime-in / Time-out activities");
const tio = await makeActivity("TEST – Two-day Time-in/out", "recurring", "Day 1 – Opening", [occ(1, "Day 2 – Closing")]);
const ts = await makeSession(tio, "time_in_time_out", [{ day: D1, n: 3 }, { day: D2, n: 3 }]);
await redeem(35, ts.pick("time_in", D1, 0));
check("a time-in alone gives no credit", (await credits(tio, 35)).length === 0);
const tOut = await redeem(35, ts.pick("time_out", D1, 0));
check("the time-out completes the day: one credit labelled with that day", tOut.ok && tOut.r.daySubName === "Day 1 – Opening" && (await credits(tio, 35)).length === 1 && (await credits(tio, 35))[0].activity_day === D1);
const tInDup = await redeem(35, ts.pick("time_in", D1, 1));
check("a second time-in code of the same day is refused", !tInDup.ok && /already scanned a code for this day/.test(tInDup.error) && !(await codeUsed(ts.pick("time_in", D1, 1))));
await redeem(35, ts.pick("time_in", D2, 0)); const t2 = await redeem(35, ts.pick("time_out", D2, 0));
check("the second day is credited and labelled with its own sub-name", t2.ok && t2.r.daySubName === "Day 2 – Closing" && (await credits(tio, 35)).length === 2 && (await credits(tio, 35))[1].activity_day === D2);

console.log("\nOlder codes with no day, and scans on a day with no code of its own");
const old = await makeActivity("TEST – Old-style recurring", "recurring", "Today's sub-name", [occ(1, "Tomorrow's sub-name")]);
const oldSess = await makeSession(old, "voucher", [{ day: null, n: 3 }]);
const o1 = await redeem(36, oldSess.pick("voucher", null, 0));
check("an old code (no day) still works and is labelled with TODAY when today is one of the activity's days", o1.ok && o1.r.daySubName === "Today's sub-name" && (await credits(old, 36))[0].activity_day === D1);
const far = await makeActivity("TEST – Starts next week", "recurring", "Far sub-name", [occ(8, "Later")], dayIso(7, 9));
const farSess = await makeSession(far, "voucher", [{ day: null, n: 2 }]);
const f1 = await redeem(36, farSess.pick("voucher", null, 0));
check("an old code scanned on a day that is not one of the days gets no day (a label for today would be wrong)", f1.ok && (f1.r.daySubName === null || f1.r.daySubName === undefined) && (await credits(far, 36))[0].activity_day === null);
const one = await makeActivity("TEST – One-time activity", "one_time", null, []);
const oneSess = await makeSession(one, "voucher", [{ day: null, n: 2 }]);
const one1 = await redeem(37, oneSess.pick("voucher", null, 0)), one2 = await redeem(37, oneSess.pick("voucher", null, 1));
check("a one-time activity is unchanged: one scan, the second refused with the plain message", one1.ok && !one2.ok && /^You already completed this attendance requirement\.$/.test(one2.error));

console.log("\nThe monitor's ID-card scan");
const mon = await makeActivity("TEST – Monitor scan", "recurring", "Monitor day 1", [occ(1, "Monitor day 2")]);
await makeSession(mon, "voucher", [{ day: null, n: 1 }]);
const token = (await q("select qr_token from scholars where scholar_id_number = $1", [num(38)]))[0].qr_token;
const mscan = await rows(SEAD, "select public.record_monitor_attendance('sdp', $1::uuid, 'voucher', $2::uuid, null::text) r", [mon, token]).then(r => r[0].r).catch(e => ({ outcome: "error", error: String(e.message) }));
check("a monitor's scan still works and the credit is labelled with today's day", mscan.outcome === "success" && (await credits(mon, 38)).length === 1 && (await credits(mon, 38))[0].activity_day === D1, JSON.stringify(mscan));

console.log("\nThe survey path and “Credit these scholars”");
const gated = await makeActivity("TEST – Surveyed", "recurring", "Survey day 1", [occ(1, "Survey day 2")]);
const survey = (await q("insert into research_surveys (title, sdp_activity_id) values ('S', $1) returning id", [gated]))[0].id;
const gs = await makeSession(gated, "voucher", [{ day: D1, n: 2 }, { day: D2, n: 2 }]);
await redeem(39, gs.pick("voucher", D2, 0));
check("a scan with a survey waiting gives no credit yet", (await credits(gated, 39)).length === 0);
await q("create unique index if not exists test_finalized_unique on scholar_attendance_finalized_notifications (session_id, scholar_id_number)");
await q("select public._finalize_survey_gated_attendance($1, $2, $3)", [scholarUid(39), num(39), survey]);
check("once the survey is answered the credit is added and remembers the day of the code that was scanned", (await credits(gated, 39)).length === 1 && (await credits(gated, 39))[0].activity_day === D2);
const cr = await makeActivity("TEST – Credit these scholars", "recurring", "Credit day 1", [occ(1, "Credit day 2")]);
const crs = await makeSession(cr, "voucher", [{ day: D1, n: 2 }, { day: D2, n: 2 }]);
await redeem(40, crs.pick("voucher", D1, 0)); await redeem(40, crs.pick("voucher", D2, 0));
await q("delete from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [cr, num(40)]);
const credited = await rows(SEAD, "select public.credit_attended_scholars($1::uuid) n", [cr]);
const cc = await credits(cr, 40);
check("“Credit these scholars” gives each credit its own day, in the order the codes were scanned", Number(credited[0].n) === 1 && cc.length === 2 && cc[0].activity_day === D1 && cc[1].activity_day === D2);

console.log("\nThe history and other activities");
const hline = (await q("select details from sdp_credit_history where activity_id = $1 and scholar_id_number = $2 and event_type = 'credit_added' order by occurred_at, id limit 1", [act, num(30)]))[0];
check("the credit history line of a credit notes its day", hline && hline.details && hline.details.activity_day === D1);
const fa = (await q("insert into formation_activities (name, short_description, date_time, venue, target_year_levels, all_year_levels, attendance_enabled) values ('TEST – Formation', 'd', now(), 'v', '{}', true, true) returning id"))[0].id;
const fs_ = (await q("insert into attendance_sessions (formation_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 2, 1, $2) returning id", [fa, SEAD]))[0].id;
await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, 'FORM1111', 'voucher', 1)", [fs_]);
const form = await redeem(41, "FORM1111");
check("a Formation activity is unaffected (no day, no label, scan works as before)", form.ok && (form.r.daySubName === null || form.r.daySubName === undefined));
check("staff with no tools cannot put a day on a code", await (async () => { try { return (await rows(PLAIN, "insert into attendance_codes (session_id, code, kind, batch_number, day_date) values ($1, 'HACKDAY1', 'voucher', 1, $2) returning id", [sess.id, D1])).length === 0; } catch { return true; } })());

console.log("\nThe undo");
await db.exec(read("undo_sdp_update_p4.sql"));
check("the three new columns and the helper functions are gone", (await q("select count(*) n from information_schema.columns where (table_name = 'sdp_activities' and column_name = 'sub_name') or (table_name = 'attendance_codes' and column_name = 'day_date') or (table_name = 'sdp_attendance' and column_name = 'activity_day')"))[0].n === 0 && (await q("select count(*) n from pg_proc where proname in ('_sdp_schedule_days', '_sdp_day_sub_name', '_sdp_redeemed_days')"))[0].n === 0);
const undoAct = (await q(`insert into sdp_activities (name, category, activity_type, date_time, end_time, recurring_dates, credits, all_year_levels, created_by, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters)
  values ('TEST – after undo', 'community_service', 'recurring', $1, $2, $3::jsonb, 1, true, $4, 'o', 'v', ${EMPTY}) returning id`, [dayIso(0, 9), dayIso(0, 11), JSON.stringify([occ(1, null)]), SEAD]))[0].id;
const us = (await q("insert into attendance_sessions (sdp_activity_id, type, expected_attendees, duration_hours, created_by) values ($1, 'voucher', 5, 1, $2) returning id", [undoAct, SEAD]))[0].id;
for (const c of ["UNDO0001", "UNDO0002", "UNDO0003"]) await q("insert into attendance_codes (session_id, code, kind, batch_number) values ($1, $2, 'voucher', 1)", [us, c]);
const u = [await redeem(42, "UNDO0001"), await redeem(42, "UNDO0002"), await redeem(42, "UNDO0003")];
check("after the undo scanning works exactly as before (two days = two credits, the third scan refused)", u[0].ok && u[1].ok && !u[2].ok && /2 of 2 allowed/.test(u[2].error) && Number((await q("select count(*) n from sdp_attendance where activity_id = $1 and scholar_id_number = $2", [undoAct, num(42)]))[0].n) === 2);
await db.exec(read("supabase_migration_sdp_update_p4_day_labels.sql"));
await db.exec(read("supabase_migration_sdp_update_p4_day_labels.sql"));
check("the SQL can be put back (and run twice)", (await q("select count(*) n from information_schema.columns where table_name = 'attendance_codes' and column_name = 'day_date'"))[0].n === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
