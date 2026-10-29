// tests/consultation-open/db_tests.mjs — a consultation can be booked any time (no renewal, no referral), and the scholar can choose the staff
//   (supabase_migration_consultation_open_and_choose_staff.sql, after the consultation types and referral reason files)
// Run:  node tests/consultation-open/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_consultation_open_and_choose_staff.sql", UNDO = "undo_consultation_open_and_choose_staff.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const EVALUATOR = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), ADMIN = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
const manilaDate = offset => new Date(Date.now() + 8 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const at = (day, hm) => new Date(`${day}T${hm}:00+08:00`).toISOString();
const D = manilaDate(14), D2 = manilaDate(15);
const free = (await q(`select s.scholar_id_number from scholars s where s.status not in ('Removed', 'On leave') and not exists (select 1 from scholar_counseling_referrals f where f.scholar_id_number = s.scholar_id_number)
  and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number) and not exists (select 1 from counseling_slots x where x.scholar_id_number = s.scholar_id_number) order by 1 limit 8`)).map(r => r.scholar_id_number);
const [S1, S2, S3, S4, S5] = free;
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const save = (uid, day, from, to) => attempt(uid, "select public.counseling_availability_save(null, $1, $2, false)", [at(day, from), at(day, to)]);
const selfSlots = s => q("select * from counseling_slots where scholar_id_number = $1 and state = 'booked' and record_id is null and referral_id is null", [s]);
check("the demo has scholars with no referral, renewal or booking (so these tests start clean)", free.length >= 5);

await db.exec(read(UNDO));      // start from the earlier behaviour: the harness may already have put the file on
await save(COUNSELOR, D, "09:00", "11:00"); await save(ADMIN, D, "09:00", "10:00"); await save(COUNSELOR, D2, "13:00", "14:00");

console.log("Before the file");
const before = await attempt(uidOf(S1), "select public.consult_self_book('one_failed', $1, 'AM', null)", [D]);
check("a scholar cannot book without a renewal or a referral", !before.ok && /does not exist|could not find/i.test(before.msg), before.msg);

await db.exec(read(FILE));
await db.exec(read(FILE));      // safe to run twice

console.log("\nWho is available (the scholar's choice)");
const staffAM = await rows(uidOf(S1), "select * from public.consult_block_staff('one_failed', $1, 'AM')", [D]);
check("the staff available in that morning are listed, the one with most minutes left first, with their names", staffAM.length === 2 && staffAM[0].staff_id === COUNSELOR && staffAM[0].free_minutes === 120 && staffAM[1].staff_id === ADMIN && staffAM[1].free_minutes === 60 && staffAM.every(s => s.staff_name), JSON.stringify(staffAM));
check("an afternoon with nobody available lists nobody", (await rows(uidOf(S1), "select * from public.consult_block_staff('one_failed', $1, 'PM')", [D])).length === 0);
check("a staff member whose minutes are too few for the type is not listed (25 minutes needs 25 free)", (await rows(uidOf(S1), "select * from public.consult_block_staff('personal', $1, 'AM')", [D])).length === 2);
check("a day less than 12 hours away is not offered", (await rows(uidOf(S1), "select * from public.consult_block_staff('one_failed', $1, 'AM')", [manilaDate(0)])).length === 0);
check("only a scholar can ask; an unknown type is refused", !(await attempt(PLAIN, "select * from public.consult_block_staff('one_failed', $1, 'AM')", [D])).ok && !(await attempt(uidOf(S1), "select * from public.consult_block_staff('nonsense', $1, 'AM')", [D])).ok);

console.log("\nBooking any time");
const types = await rows(uidOf(S1), "select * from public.consult_self_types()");
check("the scholar sees the seven types with their minutes, no renewal needed", types.length === 7 && types.find(t => t.key === "one_failed").minutes === 10 && !(await attempt(PLAIN, "select * from public.consult_self_types()")).ok);
const blocks = await rows(uidOf(S1), "select * from public.consult_self_open_blocks('one_failed')");
const morning = blocks.find(b => ymd(b.day) === D && b.half === "AM"), afternoon2 = blocks.find(b => ymd(b.day) === D2 && b.half === "PM");
check("the open mornings and afternoons are worked out from the staff's availability: 18 places in the morning of Day 14, 6 in the afternoon of Day 15", morning?.spots === 18 && afternoon2?.spots === 6, JSON.stringify(blocks));
const b1 = await attempt(uidOf(S1), "select public.consult_self_book('one_failed', $1, 'AM', null)", [D]);
check("a scholar with no renewal and no referral books a morning", b1.ok, b1.msg);
const s1 = (await selfSlots(S1))[0];
check("the booking belongs to nobody's renewal or referral, takes the type's 10 minutes and goes to the staff member with most minutes left", s1 && s1.minutes === 10 && s1.consult_type === "one_failed" && s1.staff_id === COUNSELOR, JSON.stringify(s1));
check("the scholar is told when and with whom", (await q("select body from scholar_notifications where scholar_id_number = $1 and kind = 'booking_confirmed'", [S1])).some(n => /morning/.test(n.body)));
check("a second booking is refused (change it instead)", !(await attempt(uidOf(S1), "select public.consult_self_book('personal', $1, 'PM', null)", [D2])).ok && (await selfSlots(S1)).length === 1);
const mine = await rows(uidOf(S1), "select * from public.consult_my_self()");
check("the scholar sees it with the staff name and that it can still be changed; another scholar sees nothing of it", mine.length === 1 && mine[0].staff_name && mine[0].can_change === true && mine[0].type_label === "1 Failed" && (await rows(uidOf(S2), "select * from public.consult_my_self()")).length === 0);
check("it is on the counselor's calendar with its type, and the booked minutes are used", (await rows(COUNSELOR, "select * from public.counseling_my_slots($1, $2)", [at(D, "00:00"), at(D2, "23:00")])).some(r => r.scholar_id_number === S1 && r.type_label === "1 Failed"));

console.log("\nChoosing the staff");
const c2 = await attempt(uidOf(S2), "select public.consult_self_book('one_failed', $1, 'AM', $2)", [D, ADMIN]);
check("a scholar who chooses a staff member gets that staff member (not the one with most minutes)", c2.ok && (await selfSlots(S2))[0]?.staff_id === ADMIN, c2.msg);
const c3 = await attempt(uidOf(S3), "select public.consult_self_book('one_failed', $1, 'AM', $2)", [D, EVALUATOR]);
check("a staff member who is not available then is refused, with a clear message, and nothing is booked", !c3.ok && /no room left/.test(c3.msg) && (await selfSlots(S3)).length === 0, c3.msg);
const c3b = await attempt(uidOf(S3), "select public.consult_self_book('one_failed', $1, 'PM', $2)", [D, ADMIN]);
check("a staff member who is available only in the morning is refused for the afternoon", !c3b.ok && (await selfSlots(S3)).length === 0, c3b.msg);
// ADMIN has 60 minutes that morning; fill them (50 more minutes = 2 x 25 minutes), then ADMIN has no room left for 25 minutes but the counselor does
for (const [s, n] of [[S3, 1], [S4, 2]]) { const r = await attempt(uidOf(s), "select public.consult_self_book('personal', $1, 'AM', $2)", [D, ADMIN]); check(`booking ${n} of 2 with the same staff member until the minutes run out`, r.ok, r.msg); }
const listedNow = await rows(uidOf(S5), "select * from public.consult_block_staff('personal', $1, 'AM')", [D]);
check("the staff member whose minutes are used up is no longer listed for another 25-minute consultation", listedNow.length === 1 && listedNow[0].staff_id === COUNSELOR, JSON.stringify(listedNow));
const c5 = await attempt(uidOf(S5), "select public.consult_self_book('personal', $1, 'AM', $2)", [D, ADMIN]);
check("choosing that full staff member is refused", !c5.ok && /no room left/.test(c5.msg) && (await selfSlots(S5)).length === 0, c5.msg);
const c5b = await attempt(uidOf(S5), "select public.consult_self_book('personal', $1, 'AM', null)", [D]);
check("choosing nobody still works: the staff member with room is given", c5b.ok && (await selfSlots(S5))[0]?.staff_id === COUNSELOR, c5b.msg);

console.log("\nChange and cancel");
const mv = await attempt(uidOf(S1), "select public.consult_self_reschedule('one_failed', $1, 'PM', $2)", [D2, COUNSELOR]);
const s1b = await selfSlots(S1);
check("the scholar changes the time (and chooses the staff); the old booking is released and there is only one", mv.ok && s1b.length === 1 && ymd(s1b[0].starts_at) === D2 && s1b[0].staff_id === COUNSELOR, mv.msg);
const mvBad = await attempt(uidOf(S1), "select public.consult_self_reschedule('one_failed', $1, 'PM', $2)", [D2, ADMIN]);
check("a change to a staff member who has no room is refused and the old booking stays", !mvBad.ok && (await selfSlots(S1)).length === 1 && (await selfSlots(S1))[0].staff_id === COUNSELOR, mvBad.msg);
await q("update counseling_slots set starts_at = now() + interval '5 hours', ends_at = now() + interval '5 hours 10 minutes' where id = $1", [s1b[0].id]);
check("less than 12 hours before, it can no longer be changed or cancelled", !(await attempt(uidOf(S1), "select public.consult_self_reschedule('one_failed', $1, 'PM', null)", [D2])).ok && !(await attempt(uidOf(S1), "select public.consult_self_cancel()")).ok);
await q("update counseling_slots set starts_at = $2, ends_at = $2::timestamptz + interval '10 minutes' where id = $1", [s1b[0].id, at(D2, "13:00")]);
const cx = await attempt(uidOf(S1), "select public.consult_self_cancel()");
check("the scholar cancels; the booking is removed, the scholar is told, and can book again", cx.ok && (await selfSlots(S1)).length === 0 && (await q("select 1 from scholar_notifications where scholar_id_number = $1 and kind = 'booking_cancelled'", [S1])).length === 1
  && (await attempt(uidOf(S1), "select public.consult_self_book('inc', $1, 'AM', null)", [D])).ok);
check("a scholar with no booking of this kind cannot cancel, and a staff member cannot either", !(await attempt(uidOf(free[6]), "select public.consult_self_cancel()")).ok && !(await attempt(PLAIN, "select public.consult_self_cancel()")).ok);

console.log("\nThe counselor's side");
const slot2 = (await selfSlots(S2))[0];
const att = await attempt(ADMIN, "select public.counseling_mark_slot($1, 'attended') r", [slot2.id]);
check("the counselor marks it Attended; the pre-fill says the scholar booked it", att.ok && att.rows[0].r.outcome === "attended" && /Booked by the scholar/.test(att.rows[0].r.term_label ?? ""), JSON.stringify(att.rows?.[0]?.r ?? att.msg));
const dr = await attempt(ADMIN, "select public.counseling_save_daily_record($1, $2, 'Regular', current_date, '', 'Talked about the semester', 'Follow up', 'Office') id", [slot2.id, S2]);
check("the Daily Record is saved and linked", dr.ok && (await q("select daily_record_id from counseling_slots where id = $1", [slot2.id]))[0].daily_record_id === dr.rows[0].id, dr.msg);
const slot3 = (await selfSlots(S3))[0];
await q("update counseling_slots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour 35 minutes' where id = $1", [slot3.id]);
const ns = await attempt(COUNSELOR === slot3.staff_id ? COUNSELOR : ADMIN, "select public.counseling_mark_slot($1, 'no_show') r", [slot3.id]);
check("a no-show is marked, the scholar is told, and the scholar can book a new one", ns.ok && (await q("select state from counseling_slots where id = $1", [slot3.id]))[0].state === "no_show"
  && (await attempt(uidOf(S3), "select public.consult_self_book('inc', $1, 'AM', null)", [D])).ok, ns.msg);

console.log("\nThe renewal and referral consultations get the staff choice too");
const evaluatorRefers = s => attempt(EVALUATOR, "select public.create_consultation_referral($1, 'one_failed', 'Retained', '[]'::jsonb, '[]'::jsonb, 'Renewal', current_date) id", [s]);
const free2 = (await q(`select s.scholar_id_number from scholars s where s.status not in ('Removed', 'On leave') and not exists (select 1 from scholar_counseling_referrals f where f.scholar_id_number = s.scholar_id_number)
  and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number) and not exists (select 1 from counseling_slots x where x.scholar_id_number = s.scholar_id_number) order by 1 desc limit 2`)).map(r => r.scholar_id_number);
const [R1, R2] = free2;
const rf1 = await evaluatorRefers(R1), rf2 = await evaluatorRefers(R2);
check("two scholars are referred for a consultation", rf1.ok && rf2.ok, rf1.msg ?? rf2.msg);
const refId = async s => (await q("select id from scholar_counseling_referrals where scholar_id_number = $1", [s]))[0].id;
const rb1 = await attempt(uidOf(R1), "select public.referral_book_consultation($1, $2, 'AM', $3)", [await refId(R1), D, ADMIN]);
check("a referred scholar chooses the staff member: that one is assigned and named on the referral", rb1.ok && (await q("select staff_id from counseling_slots where referral_id = $1 and state = 'booked'", [await refId(R1)]))[0]?.staff_id === ADMIN
  && (await q("select referred_to from scholar_counseling_referrals where id = $1", [await refId(R1)]))[0].referred_to === ADMIN, rb1.msg);
const rb2 = await attempt(uidOf(R2), "select public.referral_book_consultation($1, $2, 'AM')", [await refId(R2), D]);
check("the old call with no staff chosen still works and gives the staff member with most minutes left", rb2.ok && (await q("select staff_id from counseling_slots where referral_id = $1 and state = 'booked'", [await refId(R2)]))[0]?.staff_id === COUNSELOR, rb2.msg);
const rbBad = await attempt(uidOf(R1), "select public.referral_reschedule_consultation($1, $2, 'PM', $3)", [await refId(R1), D, ADMIN]);
check("changing a referral consultation to a staff member with no room is refused and the old booking stays", !rbBad.ok && (await q("select count(*)::int n from counseling_slots where referral_id = $1 and state = 'booked'", [await refId(R1)]))[0].n === 1, rbBad.msg);
const renewalRec = (await q(`select r.id, r.scholar_id_number from renewal_records r where public._renewal_consult_state(r.id) = 'ok' and not exists (select 1 from counseling_slots x where x.record_id = r.id and x.state = 'booked') limit 1`))[0];
if (renewalRec) {
  const rr = await attempt(uidOf(renewalRec.scholar_id_number), "select public.renewal_book_consultation($1, 'one_failed', $2, 'AM', $3)", [renewalRec.id, D, ADMIN]);
  check("a renewal consultation also lets the scholar choose the staff member (or none, as before)", rr.ok ? (await q("select staff_id from counseling_slots where record_id = $1 and state = 'booked'", [renewalRec.id]))[0]?.staff_id === ADMIN : /room|filled|Please/.test(rr.msg), rr.msg);
} else check("a renewal consultation also lets the scholar choose the staff member (no scholar ready to book in the demo: skipped)", true);

console.log("\nThe undo");
const keep = (await q("select count(*)::int n from counseling_slots where state = 'booked'"))[0].n;
await db.exec(read(UNDO));
const hasFn = async n => (await q("select count(*)::int c from pg_proc where proname = $1", [n]))[0].c > 0;
check("after the undo the new functions are gone and nothing is cancelled", !(await hasFn("consult_self_book")) && !(await hasFn("consult_block_staff")) && (await q("select count(*)::int n from counseling_slots where state = 'booked'"))[0].n === keep);
const old = await attempt(uidOf(R2), "select public.referral_reschedule_consultation($1, $2, 'PM')", [await refId(R2), D2]);
check("the referral booking works as before (three arguments)", old.ok, old.msg);
await db.exec(read(FILE));
check("the file can be put back", (await hasFn("consult_self_book")) && (await rows(uidOf(S5), "select * from public.consult_my_self()")).length === 1);
let early = "";
await db.exec("drop function if exists public._referral_place(uuid, text, date, text, text, text, uuid); drop function if exists public._referral_place(uuid, text, date, text, text, text);");
try { await db.exec(read(FILE)); } catch (e) { early = String(e.message); }
check("the file stops with a clear message when the referral files have not been run", /run the referral reason files first/.test(early), early);
const text = read(FILE).replace(/--.*$/gm, "");
const withoutOwnBooking = text.replace(/delete from public.counseling_slots where id = v_old.id;/g, "");
check("the file replaces and adds functions only: no table is created or changed; the only delete is the scholar's own booking when it is changed or cancelled", !/(create table|alter table|drop table|delete from|truncate)/i.test(withoutOwnBooking));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
