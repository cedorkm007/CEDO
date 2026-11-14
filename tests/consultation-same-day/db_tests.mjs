// tests/consultation-same-day/db_tests.mjs — a consultation can be booked on the SAME DAY (at least 1 hour ahead); only the part of today's availability still ahead counts (5 checks, short on purpose)
// Run:  node tests/consultation-same-day/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_consultation_same_day.sql", UNDO = "undo_consultation_same_day.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const COUNSELOR = seedId("staff:demo.counselor"), SEAD = seedId("staff:demo.sead");
const scholarNo = (await q("select scholar_id_number s from scholars where status = 'Regular' order by 1 limit 1"))[0].s;
const SCH = seedId(`scholar:${Number(scholarNo.split("-")[1])}`);
const type = (await q("select key, minutes from consultation_types where active order by sort limit 1"))[0];
await q("delete from counseling_availability where staff_id in ($1, $2)", [COUNSELOR, SEAD]);
await q("delete from counseling_slots where staff_id in ($1, $2) and state = 'open'", [COUNSELOR, SEAD]).catch(() => {});

// availability that starts 2 hours from now and lasts 2 hours (the counselor)
const av = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, date_trunc('minute', now()) + interval '2 hours', date_trunc('minute', now()) + interval '4 hours') returning starts_at", [COUNSELOR]))[0];
// the morning or afternoon that contains the middle of the range (so it has at least 60 minutes of room, wherever noon falls)
const first = (await q("select ((starts_at + interval '60 minutes') at time zone 'Asia/Manila')::date d, public._consult_half(starts_at + interval '60 minutes') h from counseling_availability where staff_id = $1", [COUNSELOR]))[0];
await db.exec(read(UNDO)).catch(() => {});
const before = await attempt(SCH, "select * from consult_self_open_blocks($1) where day = $2 and half = $3", [type.key, first.d, first.h]);
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const after = await attempt(SCH, "select * from consult_self_open_blocks($1) where day = $2 and half = $3", [type.key, first.d, first.h]);
check("1 a morning or afternoon that starts in 2 hours was NOT offered before (the 12-hour rule) and IS offered now", before.ok && before.rows.length === 0 && after.ok && after.rows.length === 1, `${before.rows?.length} ${after.rows?.length} ${before.msg ?? ""}${after.msg ?? ""}`);
const room = async (staff) => Number((await q("select coalesce(sum(capacity - booked), 0)::int n from public._consult_blocks(now() - interval '1 day', now() + interval '3 days') where staff_id = $1", [staff]))[0].n);
const roomBefore = await room(COUNSELOR);
const book = await attempt(SCH, "select public.consult_self_book($1, $2, $3, $4)", [type.key, first.d, first.h, COUNSELOR]);
const slot = (await q("select starts_at, state, minutes from counseling_slots where staff_id = $1 and scholar_id_number = $2 and state = 'booked' order by booked_at desc limit 1", [COUNSELOR, scholarNo]))[0];
check("2 the scholar books it: the booking starts at least 1 hour from now, on a 10-minute mark, and the staff member is chosen as asked",
  book.ok && !!slot && new Date(slot.starts_at).getTime() >= Date.now() + 59 * 60_000 && new Date(slot.starts_at).getUTCMinutes() % 10 === 0, `${book.msg} ${slot?.starts_at}`);
const roomAfter = await room(COUNSELOR);
check("3 the booking uses up the room it took (the minutes of the type) and no more", roomBefore - roomAfter === type.minutes, `${roomBefore} ${roomAfter} ${type.minutes}`);
// availability that already started (30 minutes ago, 2 hours long: it ends 90 minutes from now) and one that ends in 30 minutes
await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, date_trunc('minute', now()) - interval '30 minutes', date_trunc('minute', now()) + interval '90 minutes')", [SEAD]);
const partial = await q("select capacity, window_start from public._consult_blocks(now() - interval '1 day', now() + interval '3 days') where staff_id = $1", [SEAD]);
const cap = partial.reduce((s, r) => s + r.capacity, 0);
await q("delete from counseling_availability where staff_id = $1", [SEAD]);
await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, date_trunc('minute', now()) - interval '90 minutes', date_trunc('minute', now()) + interval '30 minutes')", [SEAD]);
const tooLate = await q("select 1 from public._consult_blocks(now() - interval '1 day', now() + interval '3 days') where staff_id = $1", [SEAD]);
check("4 only the part of today that is still ahead counts: availability that started 30 minutes ago keeps just the time after the 1-hour lead (about 20 to 30 minutes of its 120), and availability that ends within the hour is not offered at all",
  cap >= 10 && cap <= 30 && partial.every(r => new Date(r.window_start).getTime() >= Date.now() + 59 * 60_000) && tooLate.length === 0, `${cap} ${tooLate.length}`);
await db.exec(read(UNDO));
const undone = await attempt(SCH, "select * from consult_self_open_blocks($1) where day = $2 and half = $3", [type.key, first.d, first.h]);
check("5 after the undo the 12-hour rule is back (the block that starts in 2 hours is not offered again)", undone.ok && undone.rows.length === 0, `${undone.rows?.length} ${undone.msg ?? ""}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
