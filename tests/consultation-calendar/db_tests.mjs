// tests/consultation-calendar/db_tests.mjs — the all-staff (read-only) consultation calendar (supabase_migration_consultation_calendar_paging.sql): only the numbers of each morning and afternoon,
// the booking list in pages, nothing cut off at 1,000, the availability ranges with their true total, the undo (5 checks)
// Run:  node tests/consultation-calendar/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_calendar_paging.sql", UNDO = "undo_consultation_calendar_paging.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain"), ADMIN = seedId("staff:demo.admin");
const STAFF = [EVAL, COUNSELOR, ADMIN];
const summary = (uid, a = {}) => attempt(uid, "select * from public.renewal_calendar_summary($1, $2, $3)", [a.from ?? "2026-11-20T00:00:00+08:00", a.to ?? "2026-11-21T00:00:00+08:00", a.staff ?? null]);
const bookings = (uid, a = {}) => attempt(uid, "select * from public.renewal_calendar_bookings_page($1, $2, $3, $4, $5)", [a.day ?? "2026-11-20", a.half ?? "AM", a.staff ?? null, a.limit ?? 50, a.offset ?? 0]);
const ranges = (uid, a = {}) => attempt(uid, "select * from public.renewal_calendar_ranges($1, $2, $3, $4)", [a.from ?? "2026-11-22T00:00:00+08:00", a.to ?? "2026-11-23T00:00:00+08:00", a.staff ?? null, a.limit ?? 300]);

// one big day (2026-11-20, Philippine time): 1,300 bookings in the morning and 200 in the afternoon, shared by three staff, with the three states; plus one booking the day before and one the day after (must not count)
await q("delete from counseling_slots"); await q("delete from counseling_availability");
await q("set session_replication_role = replica");
const AV = {};
for (const s of STAFF) AV[s] = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, '2026-11-20T00:00:00+08:00', '2026-11-20T20:00:00+08:00') returning id", [s]))[0].id;
const SCH = (await q("select scholar_id_number s from scholars order by scholar_id_number limit 30")).map(r => r.s);
const STAFF_SQL = "(array[$1, $2, $3]::uuid[])";
await q(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, scholar_id_number, booked_at, minutes)
         select (array[$4, $5, $6]::uuid[])[(g % 3) + 1], ${STAFF_SQL}[(g % 3) + 1], timestamptz '2026-11-20T04:00:00+08:00' + (g * interval '10 seconds'), timestamptz '2026-11-20T04:00:00+08:00' + (g * interval '10 seconds') + interval '10 minutes',
                (array['booked', 'attended', 'no_show'])[(g % 3) + 1], ($7::text[])[(g % 30) + 1], now() + (g * interval '1 second'), case when g % 2 = 0 then 15 else null end
         from generate_series(1, 1300) g`, [EVAL, COUNSELOR, ADMIN, AV[EVAL], AV[COUNSELOR], AV[ADMIN], SCH]);
await q(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, scholar_id_number, booked_at, minutes)
         select (array[$4, $5, $6]::uuid[])[(g % 3) + 1], ${STAFF_SQL}[(g % 3) + 1], timestamptz '2026-11-20T13:00:00+08:00' + (g * interval '10 seconds'), timestamptz '2026-11-20T13:00:00+08:00' + (g * interval '10 seconds') + interval '10 minutes',
                'booked', ($7::text[])[(g % 30) + 1], now(), 20
         from generate_series(1, 200) g`, [EVAL, COUNSELOR, ADMIN, AV[EVAL], AV[COUNSELOR], AV[ADMIN], SCH]);
await q("insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, scholar_id_number, booked_at) values ($1, $2, '2026-11-19T23:59:00+08:00', '2026-11-20T00:09:00+08:00', 'booked', $3, now())", [AV[EVAL], EVAL, SCH[0]]);
await q("insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, scholar_id_number, booked_at) values ($1, $2, '2026-11-21T00:00:00+08:00', '2026-11-21T00:10:00+08:00', 'booked', $3, now())", [AV[EVAL], EVAL, SCH[0]]);
// 400 availability ranges on 2026-11-22 (more than the 300 a screen is given)
await q(`insert into counseling_availability (staff_id, starts_at, ends_at)
         select ${STAFF_SQL}[(g % 3) + 1], timestamptz '2026-11-22T00:00:00+08:00' + (g * interval '1 minute' * 10 * 0) + (g * interval '1 second'), timestamptz '2026-11-22T00:00:00+08:00' + (g * interval '1 second') + interval '20 minutes'
         from generate_series(1, 400) g`, [EVAL, COUNSELOR, ADMIN]);
await q("set session_replication_role = origin");

// 1. only the evaluator
const asC = await Promise.all([summary(COUNSELOR), bookings(COUNSELOR), ranges(COUNSELOR), summary(PLAIN)]);
const asE = await summary(EVAL);
check("1 only the Scholar Renewal evaluator can ask (the numbers, the booking list and the ranges); a consultation staff member or anyone else is refused",
  asC.every(r => !r.ok && /Only the Scholar Renewal Evaluator/i.test(r.msg)) && asE.ok, JSON.stringify(asC.map(r => r.msg)));

// 2. the numbers: ONE small answer for a day with 1,500 bookings (more than the 1,000 a single request can return)
const sum = asE.rows, am = sum.find(r => r.half === "AM"), pm = sum.find(r => r.half === "PM");
const expAm = (await q("select count(*)::int n, sum(coalesce(minutes, 10))::int m, count(*) filter (where state = 'booked')::int b, count(*) filter (where state = 'attended')::int a, count(*) filter (where state = 'no_show')::int x from counseling_slots where starts_at >= '2026-11-20T00:00:00+08:00' and starts_at < '2026-11-20T12:00:00+08:00'"))[0];
const oneStaff = (await summary(EVAL, { staff: COUNSELOR })).rows, week = (await summary(EVAL, { from: "2026-11-19T00:00:00+08:00", to: "2026-11-22T00:00:00+08:00" })).rows;
check("2 for a day with 1,500 bookings the calendar gets only 2 small rows (morning and afternoon) with the true numbers (booked / attended / no-show / minutes used); the booking just before midnight and the one at midnight after are the other days'; a staff member's own numbers are a part; a week is a few rows",
  sum.length === 2 && am.total === 1300 && pm.total === 200 && expAm.n === 1300 && am.used_minutes === expAm.m && am.booked === expAm.b && am.attended === expAm.a && am.no_show === expAm.x && pm.used_minutes === 4000
  && oneStaff.reduce((n, r) => n + r.total, 0) > 0 && oneStaff.reduce((n, r) => n + r.total, 0) < 1500 && week.length >= 4 && week.every(r => ["AM", "PM"].includes(r.half)),
  `${JSON.stringify(sum)} ${JSON.stringify(expAm)} week ${week.length}`);

// 3. the booking list in pages: nothing cut off at 1,000 (1,300 in the morning), every booking once, true total on every page, the day is the Philippine day
const seen = new Set(), totals = new Set(); let pages = 0;
for (let off = 0; ; off += 50) {
  const r = await bookings(EVAL, { half: "AM", offset: off });
  if (!r.ok || r.rows.length === 0) break;
  pages++; r.rows.forEach(x => { seen.add(x.slot_id); totals.add(String(x.total_count)); });
  if (r.rows.length < 50) break;
}
const pmAll = await bookings(EVAL, { half: "pm", limit: 200 }), big = await bookings(EVAL, { half: "PM", limit: 5000 }), staffOnly = await bookings(EVAL, { half: "PM", staff: COUNSELOR, limit: 200 });
const prevDay = await bookings(EVAL, { day: "2026-11-19", half: "PM" });
check("3 the morning's booking list is read in pages of 50: all 1,300 bookings (more than the 1,000 a single request can return), each once, with the true total on every page (26 pages); the afternoon's 200; one request never gives more than 200; one staff member's own list; the day is the Philippine day",
  seen.size === 1300 && pages === 26 && totals.size === 1 && [...totals][0] === "1300" && pmAll.rows.length === 200 && big.rows.length === 200 && Number(big.rows[0].total_count) === 200
  && staffOnly.rows.length > 0 && staffOnly.rows.length < 200 && staffOnly.rows.every(x => x.staff_id === COUNSELOR) && prevDay.rows.length === 1 && prevDay.rows[0].scholar_name !== undefined, `${seen.size} ${pages} ${[...totals]} ${pmAll.rows.length} prev ${prevDay.rows.length}`);

// 4. the availability ranges: at most the limit, with the true total so the screen can say "Showing 300 of 400"
const r300 = await ranges(EVAL), r5 = await ranges(EVAL, { limit: 5 }), rStaff = await ranges(EVAL, { staff: COUNSELOR });
check("4 the availability ranges come at most 300 at a time with the true total (400), so the screen can say that not all are shown; a smaller limit is respected; one staff member's ranges are a part",
  r300.ok && r300.rows.length === 300 && Number(r300.rows[0].total_count) === 400 && r5.rows.length === 5 && Number(r5.rows[0].total_count) === 400 && rStaff.rows.length > 0 && rStaff.rows.length < 300 && Number(rStaff.rows[0].total_count) < 400
  && r300.rows[0].minutes === 20, `${r300.rows?.length} ${r300.rows?.[0]?.total_count} ${rStaff.rows?.length}`);

// 5. the indexes exist; the undo removes the new functions and indexes only (the older calendar functions and every booking stay)
const idx = Number((await q("select count(*)::int n from pg_indexes where indexname in ('counseling_slots_booked_day_idx', 'counseling_availability_start_idx')"))[0].n);
const slotsBefore = Number((await q("select count(*)::int n from counseling_slots"))[0].n);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.renewal_calendar_summary(timestamptz,timestamptz,uuid)') a, to_regprocedure('public.renewal_calendar_bookings_page(date,text,uuid,integer,integer)') b, to_regprocedure('public.renewal_calendar_ranges(timestamptz,timestamptz,uuid,integer)') c, to_regprocedure('public.renewal_calendar_slots(timestamptz,timestamptz,uuid)') old1, to_regprocedure('public.renewal_calendar_availability(timestamptz,timestamptz,uuid)') old2"))[0];
const idxAfter = Number((await q("select count(*)::int n from pg_indexes where indexname in ('counseling_slots_booked_day_idx', 'counseling_availability_start_idx')"))[0].n);
check("5 the two indexes exist; after the undo the new functions and indexes are gone while the older calendar functions and every booking stay",
  idx === 2 && gone.a === null && gone.b === null && gone.c === null && gone.old1 !== null && gone.old2 !== null && idxAfter === 0 && Number((await q("select count(*)::int n from counseling_slots"))[0].n) === slotsBefore, `${idx} ${JSON.stringify(gone)} ${idxAfter}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
