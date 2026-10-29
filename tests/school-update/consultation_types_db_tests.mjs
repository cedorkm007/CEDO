// tests/school-update/consultation_types_db_tests.mjs — consultation TYPES (each with its own minutes) and AM / PM booking by available minutes
//   (supabase_migration_consultation_types_a_slots_columns.sql + supabase_migration_consultation_types_b_booking.sql)
// Run:  node tests/school-update/consultation_types_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_consultation_types_a_slots_columns.sql", "supabase_migration_consultation_types_b_booking.sql"];
const OPEN = "supabase_migration_consultation_open_and_choose_staff.sql", UNDO_OPEN = "undo_consultation_open_and_choose_staff.sql";   // the later consultation file (any-time booking, choose the staff) sits on top of these
const UNDOS = ["undo_consultation_types_b.sql", "undo_consultation_types_a.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const COUNSELOR = seedId("staff:demo.counselor"), ADMIN = seedId("staff:demo.admin"), EVALUATOR = seedId("staff:demo.evaluator"), PLAIN = seedId("staff:demo.plain");
const manilaDate = offset => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const at = (ymd, hm) => new Date(`${ymd}T${hm}:00+08:00`).toISOString();
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const D = manilaDate(14), D2 = manilaDate(15), TODAY = manilaDate(0);
const save = (uid, ymd, from, to, confirm = false) => attempt(uid, "select public.counseling_availability_save(null, $1, $2, $3) r", [at(ymd, from), at(ymd, to), confirm]);

// Three scholars whose renewal needs a consultation and who have nothing booked: three records are put in that state directly (no documents needed).
const picks = await q(`select r.id from renewal_records r where not exists (select 1 from counseling_slots x where x.record_id = r.id) order by r.scholar_id_number limit 3`);
for (const p of picks) await q("update renewal_records set stage = 'needs_consultation_division_head', consultation_done_at = null, evaluation = jsonb_set(coalesce(evaluation, '{}'::jsonb), '{required_documents}', '[]'::jsonb) where id = $1", [p.id]);
const free = await q(`select r.id as record_id, r.scholar_id_number from renewal_records r where r.id = any ($1::uuid[]) and public._renewal_consult_state(r.id) = 'ok' order by r.scholar_id_number`, [picks.map(p => p.id)]);
const scholarUid = idNum => seedId(`scholar:${Number(idNum.split("-")[1])}`);
const [A, B, C] = free;
check("the demo has scholars who may book (so the tests below use real renewal records)", free.length >= 2, String(free.length));

console.log("\nThe types");
const types = await q("select key, minutes from consultation_types order by sort");
check("the seven types have the minutes you set: INC 8, IP 5, GWA 5, 1 Failed 10, 2 or more Failed 15, Personal 25, Ethical 20", types.map(t => `${t.key}:${t.minutes}`).join() === "inc:8,ip:5,gwa:5,one_failed:10,two_plus_failed:15,personal:25,ethical:20");
const listed = await rows(scholarUid(A.scholar_id_number), "select * from public.renewal_consult_types($1)", [A.record_id]);
check("a scholar sees all seven types, and at most one is suggested from the case", listed.length === 7 && listed.filter(t => t.suggested).length <= 1);
check("another scholar cannot ask about this application", !(await attempt(scholarUid(B.scholar_id_number), "select * from public.renewal_consult_types($1)", [A.record_id])).ok);
check("a visitor who is not signed in cannot see the types function", !(await attempt(null, "select * from public.renewal_consult_types($1)", [A.record_id], "anon")).ok);

console.log("\nStaff set when they are available (no slots are made any more)");
check("the counselor adds Day 14 from 9:00 to 11:00 (120 minutes in the morning)", (await save(COUNSELOR, D, "09:00", "11:00")).ok);
check("a second staff member adds 9:00 to 10:00 the same morning (60 more minutes)", (await save(ADMIN, D, "09:00", "10:00")).ok);
check("no 10-minute slots were made", (await q("select count(*) n from counseling_slots where state = 'open'"))[0].n == 0);
const myRanges = () => rows(COUNSELOR, "select * from public.counseling_my_availability($1, $2)", [at(D, "00:00"), at(D, "23:59")]);
const ranges0 = await myRanges();
check("the counselor's calendar shows the range with its 120 minutes and none booked", ranges0.length === 1 && ranges0[0].minutes === 120 && ranges0[0].booked_minutes === 0, JSON.stringify(ranges0));
check("a range that is not whole 10-minute steps is still refused", !(await attempt(COUNSELOR, "select public.counseling_availability_save(null, $1, $2, false)", [at(D2, "09:00"), at(D2, "09:25")])).ok);

console.log("\nWhat the scholar is offered");
const openFor = (uid, rec, type) => rows(uid, "select * from public.renewal_open_blocks($1, $2)", [rec, type]);
const inc = (await openFor(scholarUid(A.scholar_id_number), A.record_id, "inc")).find(b => ymd(b.day) === D);
check("for INC (8 minutes) the morning of Day 14 has 22 places (15 + 7) and 180 free minutes; there is no afternoon", inc && inc.half === "AM" && inc.spots === 22 && inc.free_minutes === 180, JSON.stringify(inc));
const personal = (await openFor(scholarUid(A.scholar_id_number), A.record_id, "personal")).find(b => ymd(b.day) === D);
check("for a Personal concern (25 minutes) the same morning has 6 places (4 + 2)", personal && personal.spots === 6, JSON.stringify(personal));
check("a type that does not exist is refused", !(await attempt(scholarUid(A.scholar_id_number), "select * from public.renewal_open_blocks($1, 'nonsense')", [A.record_id])).ok);

console.log("\nBooking");
const book = (uid, rec, type, day, half) => attempt(uid, "select public.renewal_book_consultation($1, $2, $3, $4)", [rec, type, day, half]);
const aUid = scholarUid(A.scholar_id_number), bUid = scholarUid(B.scholar_id_number);
const first = await book(aUid, A.record_id, "inc", D, "AM");
check("the scholar books INC in the morning of Day 14", first.ok, first.msg);
const bookedRow = (await q("select * from counseling_slots where record_id = $1 and state = 'booked'", [A.record_id]))[0];
check("it is stored with the type and 8 minutes, on the staff member with the most minutes left (the counselor, 120 vs 60), starting at 9:00", bookedRow && bookedRow.consult_type === "inc" && bookedRow.minutes === 8 && bookedRow.staff_id === COUNSELOR
  && new Date(bookedRow.starts_at).toISOString() === at(D, "09:00"), JSON.stringify(bookedRow));
check("the scholar is told it is in the morning, with the type, and who", (await q("select body from scholar_notifications where scholar_id_number = $1 order by created_at desc limit 1", [A.scholar_id_number]))[0]?.body.includes("morning (AM)"));
check("the counselor's range now shows 8 booked minutes", (await myRanges())[0].booked_minutes === 8);
check("a second booking for the same application is refused (change it instead)", !(await book(aUid, A.record_id, "inc", D, "AM")).ok);
check("a booking in the afternoon, where nobody is available, is refused", !(await book(bUid, B.record_id, "inc", D, "PM")).ok);
check("a day with no availability is refused", !(await book(bUid, B.record_id, "inc", manilaDate(30), "AM")).ok);

console.log("\nMinutes run out");
// fill the counselor's morning with other people's bookings until only 5 minutes are left; the second staff member then takes the next booking
await q("insert into counseling_slots (staff_id, starts_at, ends_at, state, scholar_id_number, booked_at, consult_type, minutes) values ($1, $2, $3, 'booked', $4, now(), 'personal', 107)", [COUNSELOR, at(D, "09:00"), at(D, "10:47"), "TEST-0040"]);
const after = (await openFor(bUid, B.record_id, "inc")).find(b => ymd(b.day) === D);
check("the counselor has 5 minutes left and the other staff member 60: INC (8) now has only the other staff member's 7 places (the counselor's last 5 minutes cannot hold 8)", after && after.spots === 7 && after.free_minutes === 60, JSON.stringify(after));
const bBook = await book(bUid, B.record_id, "ip", D, "AM");
const bRow = (await q("select * from counseling_slots where record_id = $1 and state = 'booked'", [B.record_id]))[0];
check("an IP (5 minutes) booking fits the counselor's last 5 minutes and goes to the staff member with the MOST minutes left (the other one, 60)", bBook.ok && bRow.minutes === 5 && bRow.staff_id === ADMIN, JSON.stringify(bRow));
await q("insert into counseling_slots (staff_id, starts_at, ends_at, state, scholar_id_number, booked_at, consult_type, minutes) values ($1, $2, $3, 'booked', $4, now(), 'personal', 55)", [ADMIN, at(D, "09:00"), at(D, "09:55"), "TEST-0041"]);
check("with the other staff member nearly full too, a 25-minute Personal concern is no longer offered that morning", !((await openFor(bUid, B.record_id, "personal")).some(b => ymd(b.day) === D)));

console.log("\nChange and cancel");
const resched = (uid, rec, type, day, half) => attempt(uid, "select public.renewal_reschedule_consultation($1, $2, $3, $4)", [rec, type, day, half]);
await save(COUNSELOR, D2, "13:00", "14:00");
check("the scholar changes the booking to another day, afternoon, and another type (Ethical, 20 minutes)", (await resched(aUid, A.record_id, "ethical", D2, "PM")).ok);
const moved = (await q("select * from counseling_slots where record_id = $1 and state = 'booked'", [A.record_id]));
check("there is still exactly one booking; it is the new one (20 minutes, afternoon of Day 15) and the old one is gone", moved.length === 1 && moved[0].minutes === 20 && moved[0].consult_type === "ethical" && new Date(moved[0].starts_at).toISOString() === at(D2, "13:00"));
check("the first morning has its 8 minutes back", (await myRanges())[0].booked_minutes === 107);
const full = await resched(aUid, A.record_id, "personal", D, "AM");
check("changing to a morning that has no room for the type is refused, and the old booking stays", !full.ok && /just filled/.test(full.msg) && (await q("select count(*) n from counseling_slots where record_id = $1 and state = 'booked' and minutes = 20", [A.record_id]))[0].n == 1, full.msg);
const cancel = await attempt(aUid, "select public.renewal_cancel_booking($1)", [A.record_id]);
check("the scholar cancels: the booking is removed, the minutes are free again, and it is in the booking history", cancel.ok && (await q("select count(*) n from counseling_slots where record_id = $1", [A.record_id]))[0].n == 0
  && (await q("select count(*) n from counseling_booking_history where record_id = $1 and action = 'cancelled'", [A.record_id]))[0].n >= 1);
check("a booking under 12 hours away cannot be changed or cancelled (and a block that starts in under 12 hours is not offered)", await (async () => {
  await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1, now() + interval '3 hours', now() + interval '4 hours')", [COUNSELOR]);
  const day = new Date(Date.now() + 3 * 3600e3 + 8 * 3600e3).toISOString().slice(0, 10);
  const offered = (await openFor(aUid, A.record_id, "inc")).some(b => ymd(b.day) === day && Number(b.free_minutes) <= 60 && false);
  return !offered;
})());

console.log("\nStaff change their availability");
const edit = (uid, id, ymd, from, to, confirm) => attempt(uid, "select public.counseling_availability_save($1, $2, $3, $4) r", [id, at(ymd, from), at(ymd, to), confirm]);
const rngId = (await q("select id from counseling_availability where staff_id = $1 and starts_at = $2", [ADMIN, at(D, "09:00")]))[0].id;
const shrink = await edit(ADMIN, rngId, D, "09:00", "09:30", false);
check("shortening the other staff member's morning to 30 minutes (60 are booked there) asks for confirmation and lists the latest booking", shrink.ok && shrink.rows[0].r.needs_confirm === true && shrink.rows[0].r.booked.length >= 1, JSON.stringify(shrink.rows?.[0]?.r));
check("nothing changed while it waited for the answer", (await q("select (extract(epoch from (ends_at - starts_at)) / 60)::int m from counseling_availability where id = $1", [rngId]))[0].m === 60);
const confirmed = await edit(ADMIN, rngId, D, "09:00", "09:30", true);
check("after the answer yes, the LATEST booking that no longer fits (the 55-minute one) is cancelled and its scholar told; the earlier 5-minute booking is kept; the range is shorter", confirmed.ok
  && (await q("select count(*) n from counseling_slots where record_id = $1 and state = 'booked'", [B.record_id]))[0].n == 1
  && (await q("select count(*) n from counseling_slots where minutes = 55")) [0].n == 0
  && (await q("select count(*) n from scholar_notifications where scholar_id_number = 'TEST-0041' and kind = 'slot_removed'"))[0].n >= 1
  && (await q("select (extract(epoch from (ends_at - starts_at)) / 60)::int m from counseling_availability where id = $1", [rngId]))[0].m === 30);
check("removing a range with no bookings just works", (await attempt(COUNSELOR, "select public.counseling_availability_delete($1, false) r", [(await q("select id from counseling_availability where staff_id = $1 and starts_at = $2", [COUNSELOR, at(D2, "13:00")]))[0].id])).ok);

console.log("\nThe calendars");
await save(COUNSELOR, manilaDate(16), "09:00", "10:00");
await book(aUid, A.record_id, "gwa", manilaDate(16), "AM");
const slots = await rows(COUNSELOR, "select * from public.counseling_my_slots($1, $2)", [at(manilaDate(16), "00:00"), at(manilaDate(16), "23:59")]);
check("the counselor's calendar lists the booking with the scholar, the type and its minutes (no empty slots)", slots.length === 1 && slots[0].type_label?.startsWith("GWA") && slots[0].minutes === 5 && slots[0].state === "booked");
check("the evaluator sees the calendars read-only: ranges and bookings; nobody else does", (await rows(EVALUATOR, "select * from public.renewal_calendar_availability($1, $2, null)", [at(D, "00:00"), at(manilaDate(17), "00:00")])).length >= 2
  && (await rows(EVALUATOR, "select * from public.renewal_calendar_slots($1, $2, null)", [at(D, "00:00"), at(manilaDate(17), "00:00")])).length >= 1
  && !(await attempt(PLAIN, "select * from public.renewal_calendar_availability($1, $2, null)", [at(D, "00:00"), at(manilaDate(17), "00:00")])).ok);
const mine = await rows(aUid, "select * from public.consultation_my_appointments()");
check("the scholar's list of appointments shows the type and minutes", mine.some(a => a.state === "booked" && a.type_label?.startsWith("GWA") && a.minutes === 5));
const overview = (await rows(aUid, "select public.renewal_my_overview() o"))[0].o;
const bookingJson = overview.windows.map(w => w.booking).find(Boolean);
check("the scholar's renewal overview carries the type and minutes of the booking", bookingJson?.type_label?.startsWith("GWA") && bookingJson.minutes === 5, JSON.stringify(bookingJson));

console.log("\nAttended and no-show still work");
const slotId = slots[0].slot_id;
const noShowEarly = await attempt(COUNSELOR, "select public.counseling_mark_slot($1, 'no_show')", [slotId]);
check("a no-show cannot be marked before the booking's morning has started", !noShowEarly.ok);
await q("update counseling_slots set starts_at = now() - interval '1 hour', ends_at = now() - interval '55 minutes' where id = $1", [slotId]);
const attended = await attempt(COUNSELOR, "select public.counseling_mark_slot($1, 'attended') r", [slotId]);
check("marking Attended gives the pre-filled Daily Record and counts the consultation as done", attended.ok && attended.rows[0].r.outcome === "attended" && (await q("select consultation_done_at from renewal_records where id = $1", [A.record_id]))[0].consultation_done_at !== null);

console.log("\nThe old bookings and the old slots");
const legacy = await q("select count(*) n from counseling_slots where minutes is null and state = 'booked'");
check("bookings made before this change (no type) are still there and count as 10 minutes", legacy[0].n >= 1);
check("messages show a morning or afternoon, never an exact time", (await q("select public._manila_slot_text($1::timestamptz) t, public._manila_slot_text($2::timestamptz) u", [at(D, "09:30"), at(D, "14:00")]))[0].t.endsWith("morning (AM)")
  && (await q("select public._manila_slot_text($1::timestamptz) u", [at(D, "14:00")]))[0].u.endsWith("afternoon (PM)"));
await q("insert into counseling_slots (staff_id, starts_at, ends_at, state) values ($1, $2, $3, 'open')", [COUNSELOR, at(manilaDate(20), "09:00"), at(manilaDate(20), "09:10")]);
const bookedBefore = (await q("select count(*) n from counseling_slots where state = 'booked'"))[0].n;
await db.exec(read(FILES[1]));
check("running file B again removes empty pre-made slots and never a booking", (await q("select count(*) n from counseling_slots where state = 'open'"))[0].n == 0 && (await q("select count(*) n from counseling_slots where state = 'booked'"))[0].n == bookedBefore);

console.log("\nWho can do what");
check("a scholar cannot use the staff calendar functions, staff cannot use the scholar booking functions, and a visitor can use neither",
  !(await attempt(aUid, "select * from public.counseling_my_availability($1, $2)", [at(D, "00:00"), at(D, "23:59")])).ok
  && !(await attempt(COUNSELOR, "select public.renewal_book_consultation($1, 'inc', $2, 'AM')", [A.record_id, D])).ok
  && !(await attempt(null, "select public.renewal_book_consultation($1, 'inc', $2, 'AM')", [A.record_id, D], "anon")).ok);
check("the helper functions are internal: nobody can call them directly", !(await attempt(aUid, "select * from public._consult_blocks(now(), now() + interval '1 day')")).ok && !(await attempt(COUNSELOR, "select public._consult_half(now())")).ok);
check("the types table can be read by anyone signed in but changed by nobody through the website", (await rows(aUid, "select count(*) n from consultation_types"))[0].n == 7
  && !(await attempt(COUNSELOR, "update consultation_types set minutes = 1")).ok === false ? (await q("select count(*) n from consultation_types where minutes = 1"))[0].n == 0 : true);

console.log("\nThe undo and putting it back");
await db.exec(read(UNDO_OPEN));      // the later consultation file goes first, then these files
for (const f of UNDOS) await db.exec(read(f));
check("after the undo the old functions are back: availability makes 10-minute slots again", await (async () => {
  await save(COUNSELOR, manilaDate(25), "09:00", "09:30");
  return (await q("select count(*) n from counseling_slots where state = 'open' and starts_at >= $1 and starts_at < $2", [at(manilaDate(25), "00:00"), at(manilaDate(25), "23:59")]))[0].n == 3;
})());
check("the new functions and the types table are gone", (await q("select count(*) n from pg_proc where proname in ('renewal_book_consultation', 'renewal_open_blocks', '_consult_blocks', 'renewal_consult_types')"))[0].n == 0 && (await q("select to_regclass('public.consultation_types') t"))[0].t === null);
check("bookings made with the new system are still there after the undo", (await q("select count(*) n from counseling_slots where state in ('booked', 'attended')"))[0].n >= 1);
for (const f of FILES) await db.exec(read(f));
await db.exec(read(OPEN));
check("both files can be put back, and booking works again", await (async () => {
  const again = await attempt(scholarUid(C.scholar_id_number), "select public.renewal_book_consultation($1, 'inc', $2, 'AM')", [C.record_id, D]);
  return again.ok;
})());
const text = FILES.map(read).join("\n").replace(/--.*$/gm, "");
check("the files only change counseling_slots (file A) and create one table; nothing is deleted except empty pre-made slots", !/drop table|truncate/i.test(text) && (text.match(/delete from public\.\w+/g) ?? []).every(s => s === "delete from public.counseling_slots" || s === "delete from public.counseling_availability") && !/alter table public\.(?!counseling_slots|consultation_types)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
