// tests/sdp-update/scan_one_per_batch_db_tests.mjs — a scholar can scan only ONE code per batch (and kind); codes from different batches of the same SDP activity can each be scanned.
//   limited as before by the number of days and by one code per day; a refused scan does not use up the code; the undo returns to the Phase 4 rules.
// Run:  node tests/sdp-update/scan_one_per_batch_db_tests.mjs
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
const FILE = "supabase_migration_sdp_scan_one_per_batch.sql", UNDO = "undo_sdp_scan_one_per_batch.sql";

console.log("\nVoucher codes printed in batches (no date), recurring activity of 3 days");
const act = await makeActivity("TEST – Batch Series", "recurring", null, [occ(1, null), occ(2, null)]);
const ses = await makeSession(act, "voucher", [{ day: null, n: 3 }, { day: null, n: 3 }, { day: null, n: 3 }, { day: null, n: 3 }]);
const batchCodes = b => q("select code from attendance_codes where session_id = $1 and batch_number = $2 order by code", [ses.id, b]).then(r => r.map(x => x.code));
const [b1, b2, b3, b4] = [await batchCodes(1), await batchCodes(2), await batchCodes(3), await batchCodes(4)];
check("a scholar scans a code of batch 1", (await redeem(1, b1[0])).ok);
const again = await redeem(1, b1[1]);
check("a second code from the SAME batch is refused, and says why", !again.ok && /different batch/.test(again.error), again.error);
check("the refused code is not used up and gives no credit", !(await codeUsed(b1[1])) && (await credits(act, 1)).length === 1);
check("another scholar can still use that same code", (await redeem(2, b1[1])).ok);
check("the scholar can scan a code of batch 2 and of batch 3", (await redeem(1, b2[0])).ok && (await redeem(1, b3[0])).ok && (await credits(act, 1)).length === 3);
const fourth = await redeem(1, b4[0]);
check("a code of batch 4 is refused once the scholar has a credit for every day of the activity, and is not used up", !fourth.ok && /already completed/.test(fourth.error) && !(await codeUsed(b4[0])), fourth.error);
check("the second scan of batch 3 is refused too", !(await redeem(1, b3[1])).ok);

console.log("\nTime-in / Time-out codes");
const act2 = await makeActivity("TEST – Batch In/Out", "recurring", null, [occ(1, null)]);
const ses2 = await makeSession(act2, "time_in_time_out", [{ day: null, n: 3 }, { day: null, n: 3 }]);
const pick2 = (kind, batch, k) => q("select code from attendance_codes where session_id = $1 and kind = $2 and batch_number = $3 order by code", [ses2.id, kind, batch]).then(r => r[k].code);
check("time-in and time-out of the SAME batch can both be scanned", (await redeem(3, await pick2("time_in", 1, 0))).ok && (await redeem(3, await pick2("time_out", 1, 0))).ok);
check("a second time-in of the same batch is refused", !(await redeem(3, await pick2("time_in", 1, 1))).ok);
check("a time-in and time-out from batch 2 work for the second day", (await redeem(3, await pick2("time_in", 2, 0))).ok && (await redeem(3, await pick2("time_out", 2, 0))).ok && (await credits(act2, 3)).length === 2);

console.log("\nCodes printed for a date");
const act3 = await makeActivity("TEST – Dated Batches", "recurring", null, [occ(1, null), occ(2, null)]);
const ses3 = await makeSession(act3, "voucher", [{ day: D1, n: 3 }, { day: dayDate(1), n: 3 }, { day: D1, n: 3 }]);
const dc = b => q("select code from attendance_codes where session_id = $1 and batch_number = $2 order by code", [ses3.id, b]).then(r => r.map(x => x.code));
check("two codes of the same dated batch: the second is refused", (await redeem(4, (await dc(1))[0])).ok && !(await redeem(4, (await dc(1))[1])).ok);
check("the next day's batch works", (await redeem(4, (await dc(2))[0])).ok);
check("an extra batch printed for a day the scholar already scanned is still refused (one code per day)", !(await redeem(4, (await dc(3))[0])).ok);

console.log("\nOne-time activity, monitor scan and Formation");
const act4 = await makeActivity("TEST – One Time", "one_time", null, []);
const ses4 = await makeSession(act4, "voucher", [{ day: null, n: 3 }]);
const c4 = await q("select code from attendance_codes where session_id = $1 order by code", [ses4.id]);
check("a one-time activity: one scan counts, a second code of the batch is refused", (await redeem(5, c4[0].code)).ok && !(await redeem(5, c4[1].code)).ok && (await credits(act4, 5)).length === 1);

console.log("\nThe undo and the file");
await db.exec(read(UNDO));
const old = await redeem(1, b4[1]);
check("after the undo, Phase 4 rules are back (no rule about batches)", old.ok === false ? !/different batch/.test(old.error) : true);
const act5 = await makeActivity("TEST – Undo Series", "recurring", null, [occ(1, null), occ(2, null)]);
const ses5 = await makeSession(act5, "voucher", [{ day: null, n: 5 }]);
const c5 = await q("select code from attendance_codes where session_id = $1 order by code", [ses5.id]);
check("after the undo, two codes of one batch work again", (await redeem(6, c5[0].code)).ok && (await redeem(6, c5[1].code)).ok);
await db.exec(read(FILE)); await db.exec(read(FILE));
const c6 = await q("select code from attendance_codes where session_id = $1 order by code", [ses5.id]);
check("the file can be put back (and run twice)", !(await redeem(7, c6[2].code)).error && /different batch/.test((await redeem(7, c6[3].code)).error ?? ""));
check("the file replaces one function only", !/create table|alter table|create policy|drop policy|insert into|delete from/i.test(read(FILE)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
