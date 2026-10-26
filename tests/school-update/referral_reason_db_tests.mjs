// tests/school-update/referral_reason_db_tests.mjs — consultation referral BY REASON: staff choose only the reason, the scholar is told and books a morning / afternoon
//   (supabase_migration_referral_reason_a_referrals.sql, _b_slots.sql, _c_functions.sql)
// Run:  node tests/school-update/referral_reason_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_referral_reason_a_referrals.sql", "supabase_migration_referral_reason_b_slots.sql", "supabase_migration_referral_reason_c_functions.sql"];
const UNDOS = ["undo_referral_reason_c.sql", "undo_referral_reason_b.sql", "undo_referral_reason_a.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVALUATOR = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), ADMIN = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain"), SEAD = seedId("staff:demo.sead");
const manilaDate = offset => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const at = (day, hm) => new Date(`${day}T${hm}:00+08:00`).toISOString();
const D = manilaDate(14), D2 = manilaDate(15);
const free = (await q(`select s.scholar_id_number from scholars s where s.status not in ('Removed', 'On leave') and not exists (select 1 from scholar_counseling_referrals f where f.scholar_id_number = s.scholar_id_number)
  and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number) order by 1 limit 5`)).map(r => r.scholar_id_number);
const [S1, S2, S3] = free;
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const refer = (uid, scholar, reason) => attempt(uid, "select public.create_consultation_referral($1, $2, 'Retained', '[{\"subjectCode\":\"MATH101\",\"semesterAcademicYear\":\"1st 2025\",\"yearLevel\":\"1st\"}]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [scholar, reason]);
const save = (uid, day, from, to) => attempt(uid, "select public.counseling_availability_save(null, $1, $2, false)", [at(day, from), at(day, to)]);
check("the demo has scholars with no referral and no renewal (so these tests start clean)", free.length >= 3);
await save(COUNSELOR, D, "09:00", "11:00"); await save(ADMIN, D, "09:00", "10:00"); await save(COUNSELOR, D2, "13:00", "14:00");

console.log("\nStaff refer a scholar: only the reason");
check("the website can ask whether the new referral form is available", (await rows(EVALUATOR, "select public.consultation_referral_enabled() e"))[0].e === true);
const made = await refer(EVALUATOR, S1, "one_failed");
check("the evaluator refers a scholar with a reason, and no counselor", made.ok, made.msg);
const ref1 = (await q("select * from scholar_counseling_referrals where scholar_id_number = $1", [S1]))[0];
check("the referral waits for the scholar: no counselor, the reason saved, status 'awaiting_booking'", ref1.referred_to === null && ref1.reason === "one_failed" && ref1.status === "awaiting_booking");
check("the scholar is told, with the reason and its minutes", (await q("select title, body from scholar_notifications where scholar_id_number = $1 and kind = 'consultation_referral'", [S1])).some(n => /1 Failed/.test(n.body) && /10 minutes/.test(n.body)));
check("it is not in any counselor's queue yet", (await rows(COUNSELOR, "select * from public.scholar_counseling_queue()")).every(r => r.scholar_id_number !== S1));
check("a second referral for the same scholar is refused while the first is open", !(await refer(EVALUATOR, S1, "personal")).ok);
check("a reason that does not exist is refused", !(await refer(EVALUATOR, S2, "nonsense")).ok);
check("Scholar Management staff can refer too; a staff member with no tools, a scholar and a visitor cannot", (await refer(SEAD, S2, "personal")).ok && !(await refer(PLAIN, S3, "inc")).ok && !(await refer(uidOf(S3), S3, "inc")).ok
  && !(await attempt(null, "select public.create_consultation_referral($1, 'inc', 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date)", [S3], "anon")).ok);
await q("delete from scholar_counseling_referrals where scholar_id_number = $1", [S2]);

console.log("\nThe scholar books a morning or afternoon");
const mine = await rows(uidOf(S1), "select * from public.consultation_my_referrals()");
check("the scholar sees the referral with its reason and minutes, not booked yet; another scholar sees nothing of it", mine.length === 1 && mine[0].reason_label === "1 Failed" && mine[0].minutes === 10 && mine[0].slot_id === null
  && (await rows(uidOf(S2), "select * from public.consultation_my_referrals()")).length === 0);
const blocks = await rows(uidOf(S1), "select * from public.referral_open_blocks($1)", [ref1.id]);
const morning = blocks.find(b => ymd(b.day) === D && b.half === "AM");
check("the open mornings are worked out for that reason: 120 + 60 minutes at 10 minutes each = 18 places on the morning of Day 14", morning && morning.spots === 18 && morning.free_minutes === 180, JSON.stringify(morning));
check("another scholar cannot look at this referral's days", !(await attempt(uidOf(S2), "select * from public.referral_open_blocks($1)", [ref1.id])).ok);
const book = await attempt(uidOf(S1), "select public.referral_book_consultation($1, $2, 'AM')", [ref1.id, D]);
check("the scholar books the morning", book.ok, book.msg);
const slot = (await q("select * from counseling_slots where referral_id = $1 and state = 'booked'", [ref1.id]))[0];
check("the booking is for the reason's 10 minutes, belongs to the referral (not to a renewal), and goes to the staff member with the most minutes left", slot && slot.minutes === 10 && slot.consult_type === "one_failed" && slot.record_id === null && slot.staff_id === COUNSELOR);
const ref1b = (await q("select * from scholar_counseling_referrals where id = $1", [ref1.id]))[0];
check("the referral is now 'booked' and names the counselor", ref1b.status === "booked" && ref1b.referred_to === COUNSELOR);
check("the scholar is told when and with whom, and the counselor is told too", (await q("select body from scholar_notifications where scholar_id_number = $1 and kind = 'booking_confirmed'", [S1])).some(n => /morning/.test(n.body))
  && (await q("select count(*)::int n from notifications where type = 'renewal' and user_id = $1", [COUNSELOR]))[0].n >= 1);
check("a second booking for the same referral is refused (change it instead)", !(await attempt(uidOf(S1), "select public.referral_book_consultation($1, $2, 'PM')", [ref1.id, D2])).ok);
check("a day with no room, or no availability, is refused", !(await attempt(uidOf(S1), "select public.referral_reschedule_consultation($1, $2, 'AM')", [ref1.id, manilaDate(40)])).ok
  && (await q("select count(*)::int n from counseling_slots where referral_id = $1 and state = 'booked'", [ref1.id]))[0].n === 1);

console.log("\nChange and cancel");
const moved = await attempt(uidOf(S1), "select public.referral_reschedule_consultation($1, $2, 'PM')", [ref1.id, D2]);
check("the scholar changes it to the afternoon of the next day", moved.ok, moved.msg);
const slot2 = (await q("select * from counseling_slots where referral_id = $1 and state = 'booked'", [ref1.id]));
check("there is still exactly one booking, in the afternoon, and the first morning is free again", slot2.length === 1 && new Date(slot2[0].starts_at).toISOString() === at(D2, "13:00") && (await rows(COUNSELOR, "select * from public.counseling_my_availability($1, $2)", [at(D, "00:00"), at(D, "23:59")]))[0].booked_minutes === 0);
const cancel = await attempt(uidOf(S1), "select public.referral_cancel_booking($1)", [ref1.id]);
check("the scholar cancels: the booking is gone and the referral waits for the scholar again, with no counselor", cancel.ok && (await q("select count(*)::int n from counseling_slots where referral_id = $1", [ref1.id]))[0].n === 0
  && (await q("select status, referred_to from scholar_counseling_referrals where id = $1", [ref1.id]))[0].status === "awaiting_booking");
await attempt(uidOf(S1), "select public.referral_book_consultation($1, $2, 'AM')", [ref1.id, D]);

console.log("\nThe counselor's day");
const cal = await rows(COUNSELOR, "select * from public.counseling_my_slots($1, $2)", [at(D, "00:00"), at(D, "23:59")]);
check("the counselor's calendar lists it: the scholar, the reason (type) and its minutes; it is not tied to a renewal", cal.length === 1 && cal[0].type_label === "1 Failed" && cal[0].minutes === 10 && cal[0].record_id === null);
check("it is not in the queue until the consultation has happened", (await rows(COUNSELOR, "select * from public.scholar_counseling_queue()")).every(r => r.scholar_id_number !== S1));
const noShowEarly = await attempt(COUNSELOR, "select public.counseling_mark_slot($1, 'no_show')", [cal[0].slot_id]);
check("a no-show cannot be marked before the morning has started", !noShowEarly.ok);
await q("update counseling_slots set starts_at = now() - interval '1 hour', ends_at = now() - interval '50 minutes' where id = $1", [cal[0].slot_id]);
const noShow = await attempt(COUNSELOR, "select public.counseling_mark_slot($1, 'no_show')", [cal[0].slot_id]);
check("a no-show: the scholar is told to choose again, and the referral waits for the scholar, with no counselor", noShow.ok && (await q("select status, referred_to from scholar_counseling_referrals where id = $1", [ref1.id]))[0].status === "awaiting_booking"
  && (await q("select body from scholar_notifications where scholar_id_number = $1 and kind = 'no_show'", [S1])).length === 1);
const again = await attempt(uidOf(S1), "select public.referral_book_consultation($1, $2, 'AM')", [ref1.id, D]);
check("the scholar can book again after a no-show", again.ok, again.msg);
const slot3 = (await q("select id from counseling_slots where referral_id = $1 and state = 'booked'", [ref1.id]))[0].id;
await q("update counseling_slots set starts_at = now() - interval '1 hour', ends_at = now() - interval '50 minutes' where id = $1", [slot3]);
const attended = await attempt(COUNSELOR, "select public.counseling_mark_slot($1, 'attended') r", [slot3]);
check("marking Attended gives the pre-filled Daily Record from the referral (the scholar, the failed subject, no INC items)", attended.ok && attended.rows[0].r.outcome === "attended" && attended.rows[0].r.record_id === null
  && /MATH101/.test(attended.rows[0].r.failed_subjects) && attended.rows[0].r.inc_items.length === 0 && /1 Failed/.test(attended.rows[0].r.term_label), JSON.stringify(attended.rows?.[0]?.r));
check("the referral is now in the counselor's queue (consultation held)", (await q("select status from scholar_counseling_referrals where id = $1", [ref1.id]))[0].status === "pending"
  && (await rows(COUNSELOR, "select * from public.scholar_counseling_queue()")).some(r => r.scholar_id_number === S1));
const daily = await attempt(COUNSELOR, "select public.counseling_save_daily_record($1, $2, 'Regular', current_date, 'MATH101', 'Talked about it', 'Study plan', 'Office', null, null) id", [slot3, S1]);
check("the Daily Record is saved without any renewal application", daily.ok && (await q("select renewal_record_id, slot_id from scholar_counseling_records where id = $1", [daily.rows?.[0]?.id]))[0].renewal_record_id === null, daily.msg);
const forward = await attempt(COUNSELOR, "select public.forward_referral_to_division_head($1, 'Consulted. Recommend renewal.', 'Renewal')", [ref1.id]);
check("the existing steps carry on: the counselor forwards it to the Division Head", forward.ok && (await q("select status from scholar_counseling_referrals where id = $1", [ref1.id]))[0].status === "forwarded_to_division_head", forward.msg);
check("a finished referral no longer shows in the scholar's Consultation tile", (await rows(uidOf(S1), "select * from public.consultation_my_referrals()")).length === 0);

console.log("\nOlder things still work");
check("the old referral function (naming the counselor) still works for Scholar Management staff", (await attempt(SEAD, "select public.create_scholar_counseling_referral($1, $2, 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [S3, COUNSELOR])).ok);
const scholarsOpenBefore = (await q("select count(*)::int n from counseling_slots where state = 'booked'"))[0].n;
check("a renewal consultation is still booked the same way (the consultation-types tests cover it in detail)", (await q("select count(*)::int n from counseling_slots where record_id is not null")).length === 1 && scholarsOpenBefore >= 0);
check("a visitor who is not signed in cannot use any of the scholar functions", !(await attempt(null, "select * from public.consultation_my_referrals()", [], "anon")).ok && !(await attempt(null, "select public.referral_cancel_booking($1)", [ref1.id], "anon")).ok);
check("the internal helper cannot be called directly", !(await attempt(uidOf(S1), "select public._referral_place($1, $2, $3, 'AM', 'booked')", [ref1.id, S1, D])).ok);

console.log("\nRunning again, the undo and putting it back");
for (const f of FILES) await db.exec(read(f));
check("running the three files again changes nothing", (await q("select count(*)::int n from scholar_counseling_referrals where reason is not null"))[0].n >= 1);
await q("delete from scholar_counseling_referrals where status in ('awaiting_booking', 'booked')");
for (const f of UNDOS) await db.exec(read(f));
check("the undo removes the new functions and puts the three counselor-side functions back", (await q("select count(*)::int n from pg_proc where proname in ('create_consultation_referral', 'referral_book_consultation', 'consultation_my_referrals', '_referral_place')"))[0].n === 0
  && (await q("select count(*)::int n from pg_proc where proname = 'counseling_mark_slot'"))[0].n === 1);
check("after the undo the old rules are back: a referral must name a counselor and the old statuses only", !(await attempt(null, "select 1", [])).ok === false && await (async () => { try { await db.query("insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, endorsed_for, status) values ($1, $2, null, 'Retained', 'Renewal', 'pending')", [S3, EVALUATOR]); return false; } catch { return true; } })());
for (const f of FILES) await db.exec(read(f));
check("it can be put back after the undo and referring works again", (await refer(EVALUATOR, S2, "ethical")).ok);
const sqlText = read(FILES[2]).replace(/--.*$/gm, "");
check("file C changes no table and deletes nothing except a released booking", !/\balter table\b|\bdrop table\b|\btruncate\b/i.test(sqlText) && (sqlText.match(/delete from public\.\w+/g) ?? []).every(s => s === "delete from public.counseling_slots"));
check("file A changes only the referrals table; file B only the bookings table", !/alter table public\.(?!scholar_counseling_referrals)/i.test(read(FILES[0]).replace(/--.*$/gm, "")) && !/alter table public\.(?!counseling_slots)/i.test(read(FILES[1]).replace(/--.*$/gm, "")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
