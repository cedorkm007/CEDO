// tests/renewal/db/run_p6_tests.mjs — Phase 6 database checks: push devices, the push queue (outbox, claim, report), staff notifications for renewal
// events, the INC and window-closing reminders (hours, no repeats), and who may do what.
//
// Same setup as the earlier suites: every real migration file in memory + the demo's TEST data, run as signed-in people with the real
// `authenticated` role (and `service_role` for the push sender).  Run:  node tests/renewal/db/run_p6_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { useLegacySlots } from "./legacy_slots.mjs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await useLegacySlots(db);   // these tests cover the original 10-minute-slot booking model (see legacy_slots.mjs)

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), ADMIN = staffUid("demo.admin"), SEAD = staffUid("demo.sead"), DH = staffUid("demo.divhead");
const W1 = seedId("window:w1");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const asService = (sql, params = []) => as(null, async tx => (await tx.query(sql, params)).rows, "service_role");
const fails = async (uid, sql, params, pattern, role) => { try { await (role ? as(uid, async tx => (await tx.query(sql, params)).rows, role) : rpc(uid, sql, params)); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const finalize = async rec => { const f = (await q("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1 and status = 'division_head_approved'", [rec]))[0]; if (f) await rpc(f.referred_to, "select public.consult_finalize_decision($1)", [f.id]); };   // the consulting staff member makes the final decision after the Division Head signs
const recordOf = async (n, year = "2026-2027", term = "1st Semester") => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), year, term]))[0];
const staffNotes = async (uid, title) => q("select * from notifications where user_id = $1 and type = 'renewal' and title = $2", [uid, title]);
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const atManila = (dateStr, hour) => new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString();
const addDays = (dateStr, n) => new Date(new Date(dateStr + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const EP = n => `https://push.example.test/send/${n}`;
await q("delete from notifications where type = 'renewal'");     // start from a clean bell (the seed's own applications created some)
await q("delete from scholar_notifications");
await q("delete from push_outbox");

console.log("\nDevices: turning notifications on and off");
check("a scholar can turn notifications on for a device", (await rpc(scholarUid(1), "select public.push_subscribe($1, 'p256dh-key', 'auth-key', 'Chrome on Android') r", [EP("s1")])).length === 1 && (await q("select owner_kind, scholar_id_number from push_subscriptions where endpoint = $1", [EP("s1")]))[0].scholar_id_number === num(1));
check("a staff member can too (the device belongs to the staff member)", await (async () => { await rpc(EVAL, "select public.push_subscribe($1, 'p', 'a', 'Edge on Windows')", [EP("e1")]); const r = (await q("select owner_kind, staff_id, scholar_id_number from push_subscriptions where endpoint = $1", [EP("e1")]))[0]; return r.owner_kind === "staff" && r.staff_id === EVAL && r.scholar_id_number === null; })());
check("only secure (https) device addresses and real keys are accepted", await fails(scholarUid(1), "select public.push_subscribe('http://insecure.test/x', 'p', 'a')", [], /not valid/) && await fails(scholarUid(1), "select public.push_subscribe($1, '', 'a')", [EP("bad")], /not valid/) && await fails(scholarUid(1), "select public.push_subscribe($1, 'p', '')", [EP("bad")], /not valid/));
check("anonymous visitors cannot", await fails(null, "select public.push_subscribe($1, 'p', 'a')", [EP("anon")], undefined, "anon"));
check("a device that changes hands moves to the person using it now (no double delivery to the old owner)", await (async () => {
  await rpc(scholarUid(2), "select public.push_subscribe($1, 'p2', 'a2', 'Shared phone')", [EP("s1")]);
  const r = await q("select scholar_id_number, p256dh from push_subscriptions where endpoint = $1", [EP("s1")]);
  return r.length === 1 && r[0].scholar_id_number === num(2) && r[0].p256dh === "p2";
})());
check("each person sees only their own devices", (await rpc(scholarUid(1), "select * from public.push_my_devices()")).length === 0 && (await rpc(scholarUid(2), "select * from public.push_my_devices()")).length === 1
  && (await rpc(EVAL, "select * from public.push_my_devices()")).length === 1 && (await as(scholarUid(2), async tx => (await tx.query("select count(*)::int n from public.push_subscriptions")).rows[0].n)) === 1);
check("nobody can remove someone else's device; the owner can", await (async () => {
  await rpc(scholarUid(1), "select public.push_unsubscribe($1)", [EP("s1")]);
  const still = (await q("select 1 from push_subscriptions where endpoint = $1", [EP("s1")])).length === 1;
  await rpc(scholarUid(2), "select public.push_unsubscribe($1)", [EP("s1")]);
  return still && (await q("select 1 from push_subscriptions where endpoint = $1", [EP("s1")])).length === 0;
})());

console.log("\nEvery bell notification is also queued for push (only for people who turned push on)");
await rpc(scholarUid(1), "select public.push_subscribe($1, 'pk', 'ak', 'Phone')", [EP("s1")]);
await q("select public._notify_scholar($1, 'progress', 'Hello scholar', 'Body text', null)", [num(1)]);
await q("select public._notify_scholar($1, 'progress', 'Not subscribed', 'No device', null)", [num(3)]);
const ob = await q("select * from push_outbox order by created_at");
check("a scholar with a device gets a queued push with the right text and the Renewal tile link", ob.filter(o => o.title === "Hello scholar").length === 1 && /service=renewal/.test(ob.find(o => o.title === "Hello scholar").url) && ob.find(o => o.title === "Hello scholar").scholar_id_number === num(1));
check("a scholar with no device gets nothing queued (the bell still has it)", ob.every(o => o.title !== "Not subscribed") && (await q("select 1 from scholar_notifications where title = 'Not subscribed'")).length === 1);
await q("select public._notify_staff_member($1, 'Renewal thing', 'Something needs you', null, 'X')", [EVAL]);
await q("insert into notifications (id, type, user_id, user_name, title, message, \"timestamp\", read, reference_id) values (gen_random_uuid(), 'submission', $1, 'X', 'Task submitted', 'm', now(), false, 'r')", [EVAL]);
const sob = await q("select * from push_outbox where owner_kind = 'staff' order by created_at");
check("staff with a device get renewal notifications queued with a link to Scholar Renewal, other notification types with a link to the bell", sob.length === 2 && sob[0].url === "/?page=scholarRenewal" && sob[1].url === "/?page=notifications");
check("the staff push text is GENERIC: no scholar name, no task title (the bell has the full text)", sob.every(o => !/Something needs you|Task submitted|Renewal thing/.test(o.title + o.body)) && sob[0].title === "Scholar Renewal" && /renewal case/.test(sob[0].body) && sob[1].title === "CEDO" && /new notification/.test(sob[1].body));
check("the scholar's push keeps the real text (it is about their own case)", ob.find(o => o.title === "Hello scholar").body === "Body text");
check("push queue rows cannot be read by signed-in users directly", (await as(scholarUid(1), async tx => (await tx.query("select count(*)::int n from public.push_outbox")).rows[0].n)) === 0);

console.log("\nSending: the push-sender function's two calls (service role only)");
check("only the service role can claim or report", await fails(EVAL, "select public.push_claim(10)", [], /permission denied/i) && await fails(scholarUid(1), "select public.push_report(gen_random_uuid(), '[]')", [], /permission denied/i) && await fails(null, "select public.push_claim(10)", [], /permission denied/i, "anon"));
const claim1 = (await asService("select public.push_claim(50) c"))[0].c;
check("claiming returns each waiting message with the devices to send it to (and counts the try)", claim1.length === 3 && claim1.every(m => m.subscriptions.length >= 1 && m.title && m.url) && (await q("select count(*)::int n from push_outbox where attempts = 1"))[0].n === 3);
const mHello = claim1.find(m => m.title === "Hello scholar");
check("the right devices: the scholar's own device with its keys", mHello.subscriptions.length === 1 && mHello.subscriptions[0].endpoint === EP("s1") && mHello.subscriptions[0].p256dh === "pk" && mHello.subscriptions[0].auth === "ak");
await asService("select public.push_report($1, $2::jsonb)", [mHello.id, JSON.stringify([{ endpoint: EP("s1"), status: 201 }])]);
const sent = (await q("select sent_at from push_outbox where id = $1", [mHello.id]))[0];
check("a delivered message is marked sent and the device is marked working", sent.sent_at !== null && (await q("select last_ok_at, failures from push_subscriptions where endpoint = $1", [EP("s1")]))[0].last_ok_at !== null);
check("a sent message is not claimed again", !(await asService("select public.push_claim(50) c"))[0].c.some(m => m.id === mHello.id));

// a message with a dead device (the push service says it is gone)
await q("delete from push_outbox"); await q("select public._notify_scholar($1, 'progress', 'Dead device', 'x', null)", [num(1)]);
const dead = (await asService("select public.push_claim(50) c"))[0].c[0];
await asService("select public.push_report($1, $2::jsonb)", [dead.id, JSON.stringify([{ endpoint: EP("s1"), status: 410 }])]);
check("a device the push service says is gone (410) is removed, and the message is finished (nobody left to send to)", (await q("select 1 from push_subscriptions where endpoint = $1", [EP("s1")])).length === 0 && (await q("select sent_at from push_outbox where id = $1", [dead.id]))[0].sent_at !== null);

// a temporary failure is retried, up to 3 tries
await rpc(scholarUid(1), "select public.push_subscribe($1, 'pk', 'ak', 'Phone')", [EP("s1")]);
await q("delete from push_outbox"); await q("select public._notify_scholar($1, 'progress', 'Flaky', 'x', null)", [num(1)]);
let tries = 0;
for (let k = 0; k < 4; k++) {
  const c = (await asService("select public.push_claim(50) c"))[0].c;
  if (c.length === 0) break;
  tries++;
  await asService("select public.push_report($1, $2::jsonb)", [c[0].id, JSON.stringify([{ endpoint: EP("s1"), status: 503 }])]);
}
const flaky = (await q("select * from push_outbox"))[0];
check("a temporary failure (503) is retried, 3 tries at most, never marked sent; the device stays (failures counted)", tries === 3 && flaky.sent_at === null && flaky.attempts === 3 && /503/.test(flaky.last_error) && (await q("select failures from push_subscriptions where endpoint = $1", [EP("s1")]))[0].failures === 3);
check("a device that keeps failing is dropped (5 failures)", await (async () => {
  await q("update push_subscriptions set failures = 4 where endpoint = $1", [EP("s1")]);
  await q("delete from push_outbox"); await q("select public._notify_scholar($1, 'progress', 'Flaky 2', 'x', null)", [num(1)]);
  const c = (await asService("select public.push_claim(50) c"))[0].c[0];
  await asService("select public.push_report($1, $2::jsonb)", [c.id, JSON.stringify([{ endpoint: EP("s1"), status: 500 }])]);
  return (await q("select 1 from push_subscriptions where endpoint = $1", [EP("s1")])).length === 0;
})());
check("old messages (2+ days) are never sent, and a message whose devices were all removed is closed quietly", await (async () => {
  await rpc(scholarUid(1), "select public.push_subscribe($1, 'pk', 'ak', 'Phone')", [EP("s1")]);
  await q("delete from push_outbox");
  await q("select public._notify_scholar($1, 'progress', 'Old one', 'x', null)", [num(1)]);
  await q("update push_outbox set created_at = now() - interval '3 days'");
  const none = (await asService("select public.push_claim(50) c"))[0].c.length === 0;
  await q("delete from push_outbox"); await q("select public._notify_scholar($1, 'progress', 'Orphan', 'x', null)", [num(1)]);
  await q("delete from push_subscriptions where endpoint = $1", [EP("s1")]);
  const c2 = (await asService("select public.push_claim(50) c"))[0].c;
  return none && c2.length === 0 && (await q("select last_error from push_outbox"))[0].last_error === "no devices";
})());
await rpc(scholarUid(1), "select public.push_subscribe($1, 'pk', 'ak', 'Phone')", [EP("s1")]);
check("'Send me a test notification' queues one push for my own devices and says how many devices", (await rpc(scholarUid(1), "select public.push_send_test() n"))[0].n === 1 && (await q("select 1 from push_outbox where title = 'Notifications are working' and scholar_id_number = $1", [num(1)])).length === 1
  && (await rpc(scholarUid(5), "select public.push_send_test() n"))[0].n === 0);

console.log("\nStaff notifications for renewal events");
await q("delete from notifications where type = 'renewal'");
const rec1 = (await rpc(scholarUid(1), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') as r", [W1]))[0].r;
check("an all-passed application: every evaluator is told it is ready to confirm; the Division Head and counselor are not", (await staffNotes(EVAL, "Ready for you to confirm")).length === 1 && (await staffNotes(ADMIN, "Ready for you to confirm")).length === 1
  && (await q("select 1 from notifications where user_id in ($1, $2) and type = 'renewal'", [COUNSELOR, SEAD])).length === 0 && (await staffNotes(DH, "Ready for you to confirm")).length === 0);
const n1 = (await staffNotes(EVAL, "Ready for you to confirm"))[0];
check("the notice names the scholar and the term, and points at the case", /TEST All Passed/.test(n1.message) && /1st Semester 2026-2027/.test(n1.message) && n1.reference_id === rec1 && n1.read === false);
check("a late application, marks to review and a deadline that passed notify the evaluator", await (async () => {
  const r29 = await recordOf(29, "2025-2026", "1st Semester");
  await q("insert into renewal_history (record_id, from_stage, to_stage, note) values ($1, 'submitted', 'late_pending', 'x')", [r29.id]);
  await q("insert into renewal_history (record_id, from_stage, to_stage, note) values ($1, 'submitted', 'review_needed', 'x')", [r29.id]);
  await q("insert into renewal_history (record_id, from_stage, to_stage, note) values ($1, 'inc_waiting_compliance', 'inc_deadline_passed', 'x')", [r29.id]);
  return (await staffNotes(EVAL, "Late application needs your decision")).length === 1 && (await staffNotes(EVAL, "A case needs your review")).length === 1 && (await staffNotes(EVAL, "INC deadline passed — decision needed")).length === 1;
})());
check("a study plan waiting for approval notifies the evaluator", await (async () => {
  const rec3 = (await rpc(scholarUid(3), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') as r", [W1]))[0].r;
  await rpc(scholarUid(3), "insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'study_plan',$3,'p.pdf','application/pdf',9)", [rec3, num(3), `${num(3)}/${rec3}/study_plan/${crypto.randomUUID()}-p.pdf`]);
  const a = (await staffNotes(EVAL, "A document is waiting for your approval")).length;
  return a === 1;
})());
check("a scholar flagging a problem notifies the evaluator, with what they wrote", await (async () => {
  await rpc(scholarUid(1), "select public.renewal_flag_problem($1, 'My SDP credit from the seminar is missing')", [rec1]);
  const n = await staffNotes(EVAL, "A scholar flagged a problem");
  return n.length === 1 && /SDP credit from the seminar is missing/.test(n[0].message) && !/Scholar flagged/.test(n[0].message);
})());
check("the Division Head's decisions and send-backs notify the evaluator; sending a case to the Division Head does too", await (async () => {
  const rec41 = (await recordOf(41)).id, rec43 = (await recordOf(43)).id, rec45 = (await recordOf(45)).id, rec44 = (await recordOf(44)).id;
  await q("delete from notifications where type = 'renewal'");
  await rpc(DH, "select public.renewal_division_head_decide($1, 'reconsidered', 'sig.png', '')", [rec41]);
  await finalize(rec41);
  await rpc(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', 'sig.png', '')", [rec43]);
  await finalize(rec43);
  await rpc(EVAL, "select public.renewal_send_to_division_head($1, 'Missed twice and no reply')", [rec44]);
  return (await staffNotes(EVAL, "The Division Head reconsidered — please confirm")).length === 1
    && (await staffNotes(EVAL, "The Division Head approved — please confirm")).length === 1
    && (await staffNotes(EVAL, "Case sent to the Division Head")).length >= 1;
})());
check("a Division Head send-back notifies the evaluator with the reason", await (async () => {
  const rec44 = (await recordOf(44)).id;
  await q("delete from notifications where type = 'renewal'");
  await rpc(DH, "select public.renewal_division_head_return($1, 'Please interview the scholar first')", [rec44]);
  const n = await staffNotes(EVAL, "The Division Head sent a case back");
  return n.length === 1 && /Please interview the scholar first/.test(n[0].message);
})());
check("booking, changing and cancelling a consultation notify the consultation staff member who owns the slot", await (async () => {
  await q("delete from notifications where type = 'renewal'");
  const day = addDays(manilaToday(), 25);
  const start = atManila(day, 9);
  await rpc(COUNSELOR, "select public.counseling_availability_save(null, $1, $2, false)", [start, atManila(day, 10)]);
  const slot = (await q("select id from counseling_slots where staff_id = $1 and starts_at = $2", [COUNSELOR, start]))[0].id;
  const rec37 = (await recordOf(37)).id;
  await rpc(scholarUid(37), "select public.renewal_cancel_booking($1)", [rec37]);
  const cancelled = await staffNotes(COUNSELOR, "A consultation was cancelled");
  await rpc(scholarUid(37), "select public.renewal_book_slot($1, $2)", [rec37, slot]);
  const booked = await staffNotes(COUNSELOR, "A consultation was booked");
  return cancelled.length === 1 && /TEST Consult Tomorrow/.test(cancelled[0].message) && booked.length === 1 && /TEST Consult Tomorrow/.test(booked[0].message) && (await staffNotes(EVAL, "A consultation was booked")).length === 0;
})());
check("each notice is also queued for push when that staff member has a device", (await q("select 1 from push_outbox where owner_kind = 'staff' and staff_id = $1", [EVAL])).length >= 1);

console.log("\nReminders: INC deadline (7 and 2 days) and the window closing (3 and 1 day)");
const today = manilaToday();
await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
const inc26 = (await q("select i.id, i.record_id from renewal_inc_items i join renewal_records r on r.id = i.record_id where r.scholar_id_number = $1", [num(26)]))[0];
await q("update renewal_inc_items set deadline = $2 where id = $1", [inc26.id, addDays(today, 7)]);
check("outside 8:00-18:00 (Manila) nothing is sent", (await q("select public.renewal_notification_jobs($1) r", [atManila(today, 3)]))[0].r.skipped !== undefined && (await q("select 1 from scholar_notifications where kind = 'inc_reminder'")).length === 0);
const r7 = (await q("select public.renewal_notification_jobs($1) r", [atManila(today, 10)]))[0].r;
const incNote = await q("select * from scholar_notifications where kind = 'inc_reminder' and scholar_id_number = $1", [num(26)]);
check("7 days before: the scholar is told how many days are left and the date", r7.inc_reminders >= 1 && incNote.length === 1 && incNote[0].title === "Your INC deadline is in 7 days" && /7 days left/.test(incNote[0].body) && incNote[0].record_id === inc26.record_id);
await q("select public.renewal_notification_jobs($1)", [atManila(today, 11)]);
check("running the job again the same day sends nothing twice", (await q("select 1 from scholar_notifications where kind = 'inc_reminder' and scholar_id_number = $1", [num(26)])).length === 1);
await q("update renewal_inc_items set deadline = $2 where id = $1", [inc26.id, addDays(today, 2)]);
await q("select public.renewal_notification_jobs($1)", [atManila(today, 9)]);
check("2 days before: a second reminder (for the deadline as it is now)", (await q("select title from scholar_notifications where kind = 'inc_reminder' and scholar_id_number = $1 order by created_at", [num(26)])).map(r => r.title).join("|") === "Your INC deadline is in 7 days|Your INC deadline is in 2 days");
check("a settled INC gets no reminder", await (async () => { await q("update renewal_inc_items set state = 'resolved_passed', deadline = $2 where id = $1", [inc26.id, addDays(today, 7)]); await q("delete from scholar_notifications"); await q("delete from renewal_notice_log"); await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]); return (await q("select 1 from scholar_notifications where scholar_id_number = $1 and kind = 'inc_reminder'", [num(26)])).length === 0; })());

await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
await q("update renewal_windows set closes_on = $2 where id = $1", [W1, addDays(today, 3)]);
await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]);
const winNotes = await q("select scholar_id_number, title from scholar_notifications where kind = 'window_closing'");
const expectedNotApplied = (await q("select count(*)::int n from scholars s where s.status not in ('Removed','On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = '2026-2027' and r.term = '1st Semester')"))[0].n;
check("3 days before the window closes: scholars who have not applied are told (and only them)", winNotes.length === expectedNotApplied && winNotes.length > 5 && winNotes.every(n => /Renewal closes in 3 days/.test(n.title))
  && !winNotes.some(n => n.scholar_id_number === num(1)) && !winNotes.some(n => n.scholar_id_number === num(12)) && !winNotes.some(n => n.scholar_id_number === num(11)));
await q("select public.renewal_notification_jobs($1)", [atManila(today, 15)]);
check("the same day again: nothing twice", (await q("select count(*)::int n from scholar_notifications where kind = 'window_closing'"))[0].n === winNotes.length);
await q("update renewal_windows set closes_on = $2 where id = $1", [W1, addDays(today, 1)]);
await q("update renewal_records set stage = 'returned' where scholar_id_number = $1 and school_year = '2026-2027' and term = '1st Semester'", [num(1)]);
await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]);
const day1 = await q("select scholar_id_number, title, body from scholar_notifications where kind = 'window_closing' and title like '%1 day%'");
check("1 day before: the reminder again, and a scholar whose application was returned is asked to submit it again", day1.some(n => n.scholar_id_number === num(1) && /submit your renewal again/i.test(n.title) && /was returned/.test(n.body)) && day1.some(n => n.scholar_id_number === num(14) && /Renewal closes in 1 day$/.test(n.title)));
check("a window that has closed or has not opened yet sends nothing", await (async () => {
  await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
  await q("update renewal_windows set closes_on = $2 where id = $1", [W1, addDays(today, -1)]);
  await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]);
  const a = (await q("select count(*)::int n from scholar_notifications where kind = 'window_closing'"))[0].n;
  await q("update renewal_windows set opens_on = $2, closes_on = $3 where id = $1", [W1, addDays(today, 2), addDays(today, 3)]);
  await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]);
  return a === 0 && (await q("select count(*)::int n from scholar_notifications where kind = 'window_closing'"))[0].n === 0;
})());

await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
await q("update renewal_windows set opens_on = $2, closes_on = $3 where id = $1", [W1, today, addDays(today, 20)]);
await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]);
const openNotes = await q("select scholar_id_number, title, body from scholar_notifications where kind = 'window_open'");
check("a window that opens today: every scholar who can renew and has not applied is told once ('Renewal ... is now open', until when)", openNotes.length > 5 && openNotes.every(n => /1st Semester 2026-2027 is now open/.test(n.title) && /You can apply from your Renewal tile until/.test(n.body))
  && !openNotes.some(n => [num(1), num(3), num(11), num(12)].includes(n.scholar_id_number)) && openNotes.some(n => n.scholar_id_number === num(14)));
await q("select public.renewal_notification_jobs($1)", [atManila(today, 16)]);
check("the same day again: nothing twice; the next day too", (await q("select count(*)::int n from scholar_notifications where kind = 'window_open'"))[0].n === openNotes.length
  && ((await q("select public.renewal_notification_jobs($1)", [atManila(addDays(today, 1), 10)])), (await q("select count(*)::int n from scholar_notifications where kind = 'window_open'"))[0].n === openNotes.length));
check("a window that opened more than a day ago is not announced late; nothing outside 8:00-18:00", await (async () => {
  await q("delete from scholar_notifications"); await q("delete from renewal_notice_log");
  await q("update renewal_windows set opens_on = $2, closes_on = $3 where id = $1", [W1, addDays(today, -5), addDays(today, 20)]);
  await q("select public.renewal_notification_jobs($1)", [atManila(today, 10)]);
  const old = (await q("select count(*)::int n from scholar_notifications where kind = 'window_open'"))[0].n;
  await q("update renewal_windows set opens_on = $2 where id = $1", [W1, today]);
  await q("select public.renewal_notification_jobs($1)", [atManila(today, 22)]);
  return old === 0 && (await q("select count(*)::int n from scholar_notifications where kind = 'window_open'"))[0].n === 0;
})());

console.log("\nThe scheduler as a whole");
check("one call runs the Phase 3 reminders and the Phase 6 reminders", await (async () => { const r = (await q("select public.renewal_run_scheduled_jobs() r"))[0].r; return "day_reminders" in r && ("window_open_alerts" in r); })());
check("nobody signed in can run the scheduler or the helpers", await fails(EVAL, "select public.renewal_run_scheduled_jobs()", [], /permission denied/i) && await fails(EVAL, "select public.renewal_notification_jobs()", [], /permission denied/i) && await fails(EVAL, "select public._notify_staff_member($1,'x','y',null)", [EVAL], /permission denied/i));
check("old pushes are tidied away by the job (older than a week)", await (async () => { await q("delete from push_outbox"); await q("insert into push_outbox (owner_kind, scholar_id_number, title, created_at) values ('scholar', $1, 'ancient', now() - interval '8 days')", [num(1)]); await q("select public.renewal_notification_jobs()"); return (await q("select 1 from push_outbox where title = 'ancient'")).length === 0; })());
check("setting up the push-sender schedule says what to do when pg_cron / pg_net are not on", /Switch on the pg_cron and pg_net/.test((await q("select public.push_sender_schedule('https://x.supabase.co/functions/v1/push-sender', 'secret') r"))[0].r) && await fails(EVAL, "select public.push_sender_schedule('https://x', 's')", [], /permission denied/i));
check("the migration can be run twice", await (async () => { try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p6_notifications.sql", import.meta.url), "utf8")); return true; } catch (e) { console.log("   ", e.message); return false; } })());

console.log(`\n${failed === 0 ? "ALL PHASE 6 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
