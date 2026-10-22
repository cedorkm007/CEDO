// tests/sdp-update/manual_credit_by_day_db_tests.mjs — manual credit for a chosen day of a recurring activity (supabase_migration_sdp_manual_credit_by_day.sql).
//   one credit per day, never twice for a day, never more than the number of days, only real days, the right people, one-time activities as before, the history, the undo.
// Run:  node tests/sdp-update/manual_credit_by_day_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_manual_credit_by_day.sql", UNDO = "undo_sdp_manual_credit_by_day.sql";
const SDP_STAFF = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), MONITOR = seedId("staff:demo.monitor"), SCHOLAR = seedId("scholar:5");
const COASTAL = seedId("act:coastal"), VOLUNTEER = seedId("act:cv3"), ONE_TIME = seedId("act:cs3");
async function call(uid, args, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)", [uid ?? "", role]);
    return (await tx.query("select public.credit_scholar_for_day($1::uuid, $2, $3::date, $4::date, $5, $6) r", args)).rows[0].r;
  });
}
const tryCall = async (uid, args, role) => { try { return { ok: true, r: await call(uid, args, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const days = (await q("select distinct to_char(d.day, 'YYYY-MM-DD') as day from public._sdp_schedule_days($1) d order by 1", [COASTAL])).map(r => r.day);
const credits = async (act, who) => q("select occurrence_number n, to_char(activity_day, 'YYYY-MM-DD') as day, to_char(attended_date, 'YYYY-MM-DD') as attended, school_year sy, semester sem, created_by by from sdp_attendance where activity_id = $1 and scholar_id_number = $2 order by occurrence_number", [act, who]);
const S1 = "TEST-0007", S2 = "TEST-0008", S3 = "TEST-0009";

console.log("\nA recurring activity: one credit for each chosen day");
check("the demo's Coastal Clean-up Series has 3 days", days.length === 3);
const r1 = await call(SDP_STAFF, [COASTAL, S1, days[0], null, null, null]);
check("crediting day 1 works and says which day and credit number it was", r1.ok === true && r1.occurrence === 1 && r1.day === days[0], JSON.stringify(r1));
let list = await credits(COASTAL, S1);
check("the credit is saved with its day, the staff member and the current semester", list.length === 1 && list[0].day === days[0] && list[0].attended === days[0] && list[0].by === SDP_STAFF && list[0].sy && list[0].sem);
await call(SDP_STAFF, [COASTAL, S1, days[1], null, null, null]);
await call(SDP_STAFF, [COASTAL, S1, days[2], null, null, null]);
list = await credits(COASTAL, S1);
check("the same scholar can be credited for day 2 and day 3 as well: three credits, numbered 1, 2, 3, one per day", list.length === 3 && list.map(c => c.n).join() === "1,2,3" && list.map(c => c.day).join() === days.join());
check("the same day twice is refused, with the day named", (await tryCall(SDP_STAFF, [COASTAL, S1, days[1], null, null, null])).msg?.includes("already credited for") === true);
check("nothing was added by the refused attempt", (await credits(COASTAL, S1)).length === 3);

console.log("\nOnly real days, and never more credits than days");
check("a date that is not a day of the activity is refused", (await tryCall(SDP_STAFF, [COASTAL, S2, "2020-01-01", null, null, null])).msg?.includes("not one of the days") === true);
check("with several days, choosing no day is refused (the screen asks which day)", (await tryCall(SDP_STAFF, [COASTAL, S2, null, null, null, null])).msg?.includes("Choose which day") === true);
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) values ($1, $2, '2020-01-05', 1, '2025-2026', '1st Semester'), ($1, $2, '2020-01-06', 2, '2025-2026', '1st Semester'), ($1, $2, '2020-01-07', 3, '2025-2026', '1st Semester')", [COASTAL, S3]);
check("a scholar who already has as many credits as the activity has days cannot get another, even for a day not yet credited", (await tryCall(SDP_STAFF, [COASTAL, S3, days[0], null, null, null])).msg?.includes("already has all 3 credits") === true);
const cur = (await q("select current_school_year sy, current_semester sem from grading_period_settings where id = true"))[0];
check("an unknown Scholar ID is refused, and the ID is matched without regard to capitals", (await tryCall(SDP_STAFF, [COASTAL, "NO-SUCH-ID", days[0], null, null, null])).msg?.includes("No scholar with Scholar ID") === true
  && (await tryCall(SDP_STAFF, [COASTAL, S2.toLowerCase(), days[0], null, null, null])).ok === true);
check("a chosen semester is stamped on the credit; one that is not on record is refused", (await tryCall(SDP_STAFF, [COASTAL, "TEST-0010", days[0], null, "2025-2026", "1st Semester"])).ok === true
  && (await credits(COASTAL, "TEST-0010"))[0].sem === "1st Semester" && (await tryCall(SDP_STAFF, [COASTAL, "TEST-0011", days[0], null, "1999-2000", "1st Semester"])).msg?.includes("not on record") === true);
check("an attended date can be given as well; without it the credit takes the chosen day", (await tryCall(SDP_STAFF, [COASTAL, "TEST-0012", days[0], days[1], null, null])).ok === true && (await credits(COASTAL, "TEST-0012"))[0].attended === days[1] && (await credits(COASTAL, "TEST-0012"))[0].day === days[0]);

console.log("\nOne-time activities work as before");
await call(SDP_STAFF, [ONE_TIME, S1, null, "2026-10-01", null, null]);
await call(SDP_STAFF, [ONE_TIME, S1, null, "2026-10-02", null, null]);
list = await credits(ONE_TIME, S1);
check("a one-time activity keeps ONE credit; crediting again only updates its date", list.length === 1 && list[0].attended === "2026-10-02");

console.log("\nWho may do it");
check("a staff member with no tools is refused", (await tryCall(PLAIN, [COASTAL, S2, days[2], null, null, null])).msg?.includes("not allowed") === true);
check("the monitor of this activity may credit it, but not an activity they do not monitor", (await tryCall(MONITOR, [COASTAL, "TEST-0013", days[0], null, null, null])).ok === true && (await tryCall(MONITOR, [ONE_TIME, "TEST-0013", null, null, null, null])).msg?.includes("not allowed") === true);
check("a scholar and a visitor cannot run it", !(await tryCall(SCHOLAR, [COASTAL, S2, days[2], null, null, null])).ok && !(await tryCall(null, [COASTAL, S2, days[2], null, null, null], "anon")).ok);

console.log("\nThe history and the undo");
const hist = await q("select event_type, source, details from sdp_credit_history where activity_id = $1 and scholar_id_number = $2 order by occurred_at, id", [COASTAL, S1]);
check("each credit is in the credit history as added by hand, with its day", hist.length === 3 && hist.every(h => h.event_type === "credit_added" && h.source === "manual") && hist.every((h, i) => JSON.stringify(h.details).includes(days[i])));
await db.exec(read(FILE));
check("running the file again changes nothing", (await credits(COASTAL, S1)).length === 3);
await db.exec(read(UNDO));
check("the undo removes the function and leaves the credits", (await q("select count(*) n from pg_proc where proname = 'credit_scholar_for_day'"))[0].n == 0 && (await credits(COASTAL, S1)).length === 3);
await db.exec(read(FILE));
check("it can be put back after the undo", (await tryCall(SDP_STAFF, [COASTAL, "TEST-0014", days[0], null, null, null])).ok === true);
check("the file creates a function only: no table or rule is changed", !/create table|alter table|create policy|drop policy|insert into public\.|delete from/i.test(read(FILE).replace(/insert into public\.sdp_attendance/g, "")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
