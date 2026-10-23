// tests/renewal/db/run_p3_tests.mjs — Phase 3 database checks: availability and 10-minute slots, booking / rescheduling / cancelling (the 12-hour
// rule, one booking per renewal), no-show and rebooking, Attended + the Daily Record (INC days given -> deadline, Summer hard copy), removing
// availability that scholars booked, the 1-day and 1-hour reminders, and who may do what.
//
// Same setup as run_p2_tests.mjs: the private database the local demo uses (every real migration file, in memory) with the demo's TEST data,
// run signed in as scholars / the counselor / the evaluator with the real `authenticated` role.  Run:  node tests/renewal/db/run_p3_tests.mjs
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
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), ADMIN = staffUid("demo.admin"), SEAD = staffUid("demo.sead");
const W1 = seedId("window:w1"), W2 = seedId("window:w2");

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid, role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const fails = async (uid, sql, params, pattern) => { try { await rpc(uid, sql, params); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const iso = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const recordOf = async (n, year, term) => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), year, term]))[0];
const fixtureUids = {};
const uidOf = n => fixtureUids[n] ?? scholarUid(n);
/** A throw-away scholar (lower school, SDP complete) for cases the demo data does not cover. */
async function mkScholar(n, grades) {
  const uid = crypto.randomUUID();
  const school = seedId("school:lower");
  await q("insert into auth.users (id, email) values ($1,$2)", [uid, `fx${n}@demo.local`]);
  await q(`insert into scholars (id, scholar_id_number, first_name, last_name, middle_name, birthday, email, school, course, status, barangay, year_level, house_unit_no, street, city_municipality, province_region, country, zip_code, school_id,
      emergency_contact_name, emergency_contact_relationship, emergency_contact_number)
    values ($1,$2,'TEST','Fixture ${n}','T','2005-05-05',$3,'TEST – Lower-Is-Better University','BS Test Studies','Regular','B','2nd Year','1','S','C','P','PH','0',$4,'G','P','0')`, [uid, num(n), `fx${n}@demo.local`, school]);
  const period = (await q("select id from academic_periods where school_year = '2025-2026' and term = '2nd Semester'"))[0].id;
  for (const [i, g] of grades.entries())
    await q("insert into scholar_subjects_grades (scholar_id_number, school_year, semester, subject, subject_code, grade, units, recorded_by_school_id, period_id) values ($1,'2025-2026','2nd Semester',$2,$3,$4,3,$5,$6)", [num(n), `TEST – S${i}`, `FX${i}`, g, school, period]);
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester) select a.id, $1, '2026-04-15', '2025-2026', '2nd Semester' from sdp_activities a where a.name in ('TEST – Community Service Day','TEST – Volunteer Drive','TEST – Formation Seminar')", [num(n)]);
  fixtureUids[n] = uid;
}
/** Uploads a document as the scholar; returns its id. */
async function upload(n, windowYear, term, kind) {
  const rec = await recordOf(n, windowYear, term);
  return (await rpc(uidOf(n), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
    values ($1,$2,$3,$4,$5,'application/pdf',500) returning id`, [rec.id, num(n), kind, `${num(n)}/${rec.id}/${kind}/${crypto.randomUUID()}-f.pdf`, kind + '.pdf']))[0].id;
}
const stateOfN = async (n, year, term) => (await rpc(uidOf(n), "select public.renewal_my_overview() o"))[0].o.windows.find(w => w.window.term === term && w.window.school_year === year).consult_state;
const apply = async (n, windowId) => (await rpc(uidOf(n), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') as r", [windowId]))[0].r;
const hoursFromNow = h => new Date(Date.now() + h * 3600 * 1000);
const T = "2026-2027", S1 = "1st Semester";

/** A slot inserted directly (so a test can have a slot in the past, or exactly 11 / 13 hours away). */
async function mkSlot({ staff = COUNSELOR, startsInHours, state = "open", record = null, scholar = null }) {
  const start = hoursFromNow(startsInHours);
  const end = new Date(start.getTime() + 10 * 60000);
  const av = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1,$2,$3) returning id", [staff, start.toISOString(), end.toISOString()]))[0].id;
  return (await q(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, record_id, scholar_id_number, booked_at)
    values ($1,$2,$3,$4,$5,$6,$7, case when $5 = 'open' then null else now() end) returning *`, [av, staff, start.toISOString(), end.toISOString(), state, record, scholar]))[0];
}
/** Uploads a study plan as the scholar and has the evaluator approve it (the scholar cannot book before that). */
async function approvePlan(n, uid = scholarUid(n)) {
  const rec = await recordOf(n, T, S1);
  const doc = (await rpc(uid, `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
    values ($1,$2,'study_plan',$3,'plan.pdf','application/pdf',500) returning id`, [rec.id, num(n), `${num(n)}/${rec.id}/study_plan/${crypto.randomUUID()}-plan.pdf`]))[0];
  await rpc(EVAL, "select public.renewal_review_document($1,true,'')", [doc.id]);
  return doc.id;
}
const notes = async (n, kind) => (await q("select * from scholar_notifications where scholar_id_number = $1 and kind = $2 order by created_at", [num(n), kind]));
// a start time on the hour, N days ahead, in Manila time (so the slots line up the way staff would type them)
const manilaAt = (daysAhead, hour) => { const d = new Date(Date.now() + 8 * 3600 * 1000 + daysAhead * 86400000); return new Date(`${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00+08:00`); };

console.log("\nAvailability: ranges become 10-minute slots");
let rangeId;
{
  const start = manilaAt(20, 9), end = manilaAt(20, 11);
  const res = (await rpc(COUNSELOR, "select public.counseling_availability_save(null,$1,$2,false) r", [start.toISOString(), end.toISOString()]))[0].r;
  rangeId = res.id;
  check("a 9:00-11:00 range is created", res.ok === true && !!rangeId);
  const slots = await q("select * from counseling_slots where availability_id = $1 order by starts_at", [rangeId]);
  check("it is split into twelve 10-minute slots, all open", slots.length === 12 && slots.every(s => s.state === "open" && (s.ends_at - s.starts_at) === 600000));
  check("the first slot starts at the start of the range and the last ends at its end", slots[0].starts_at.getTime() === start.getTime() && slots[11].ends_at.getTime() === end.getTime());
  check("a range that is not whole 10-minute slots is refused", await fails(COUNSELOR, "select public.counseling_availability_save(null,$1,$2,false)", [manilaAt(21, 9).toISOString(), new Date(manilaAt(21, 9).getTime() + 25 * 60000).toISOString()], /10-minute/));
  check("a range in the past is refused", await fails(COUNSELOR, "select public.counseling_availability_save(null,$1,$2,false)", [hoursFromNow(-2).toISOString(), hoursFromNow(-1).toISOString()], /future/));
  check("a range that overlaps another of the same staff member is refused", await fails(COUNSELOR, "select public.counseling_availability_save(null,$1,$2,false)", [manilaAt(20, 10).toISOString(), manilaAt(20, 12).toISOString()], /overlaps/));
  check("an end before the start is refused", await fails(COUNSELOR, "select public.counseling_availability_save(null,$1,$2,false)", [manilaAt(22, 11).toISOString(), manilaAt(22, 9).toISOString()], /after the start/));
  check("the evaluator cannot set availability", await fails(EVAL, "select public.counseling_availability_save(null,$1,$2,false)", [manilaAt(23, 9).toISOString(), manilaAt(23, 10).toISOString()], /consultation staff/));
  check("a scholar cannot set availability", await fails(scholarUid(3), "select public.counseling_availability_save(null,$1,$2,false)", [manilaAt(23, 9).toISOString(), manilaAt(23, 10).toISOString()], /consultation staff/));
  // a second staff member's range on the same day does not clash with the first
  const other = (await rpc(ADMIN, "select public.counseling_availability_save(null,$1,$2,false) r", [manilaAt(20, 9).toISOString(), manilaAt(20, 10).toISOString()]))[0].r;
  check("another staff member can offer the same hours", other.ok === true);
  // extend the range: new slots appear, old ones stay
  const ext = (await rpc(COUNSELOR, "select public.counseling_availability_save($1,$2,$3,false) r", [rangeId, manilaAt(20, 9).toISOString(), manilaAt(20, 11).toISOString().replace(/.*/, new Date(manilaAt(20, 11).getTime() + 30 * 60000).toISOString())]))[0].r;
  check("extending a range adds slots without touching the existing ones", ext.ok && (await q("select count(*)::int n from counseling_slots where availability_id = $1", [rangeId]))[0].n === 15);
  const cal = await rpc(COUNSELOR, "select * from public.counseling_my_availability($1,$2)", [hoursFromNow(0).toISOString(), hoursFromNow(24 * 40).toISOString()]);
  check("the staff member's list shows the range with its slot counts", cal.some(a => a.id === rangeId && a.slot_count === 15 && a.booked_count === 0));
  check("a staff member sees only their own ranges", cal.every(a => a.id !== other.id));
}

console.log("\nWho may book, and which times they see");
let rec3, slotA;
{
  await apply(1, W1);   // all passed -> no consultation needed
  const rec1 = await recordOf(1, T, S1);
  check("a scholar who needs no consultation cannot see or book slots' bookings", await fails(scholarUid(1), "select public.renewal_book_slot($1,$2)", [rec1.id, (await q("select id from counseling_slots where availability_id = $1 limit 1", [rangeId]))[0].id], /do not need/));
  await apply(3, W1);
  rec3 = await recordOf(3, T, S1);

  // Q1 of the owner: a scholar whose case needs a study plan waits for the evaluator's APPROVAL before booking
  const firstSlot = (await q("select id from counseling_slots where availability_id = $1 order by starts_at limit 1", [rangeId]))[0].id;
  const stateOf = async () => (await rpc(scholarUid(3), "select public.renewal_my_overview() o"))[0].o.windows.find(w => w.window.term === S1 && w.window.school_year === T).consult_state;
  check("no study plan yet: cannot see times or book, and is told to upload it first", await stateOf() === "study_plan_missing"
    && await fails(scholarUid(3), "select * from public.renewal_open_slots($1)", [rec3.id], /upload your study plan first/i)
    && await fails(scholarUid(3), "select public.renewal_book_slot($1,$2)", [rec3.id, firstSlot], /upload your study plan first/i));
  const docRow = (await rpc(scholarUid(3), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
    values ($1,$2,'study_plan',$3,'plan.pdf','application/pdf',500) returning id`, [rec3.id, num(3), `${num(3)}/${rec3.id}/study_plan/${crypto.randomUUID()}-plan.pdf`]))[0];
  check("plan uploaded but not approved: still cannot book, and is told to wait", await stateOf() === "study_plan_pending"
    && await fails(scholarUid(3), "select public.renewal_book_slot($1,$2)", [rec3.id, firstSlot], /approved by the evaluator/i)
    && await fails(scholarUid(3), "select * from public.renewal_open_slots($1)", [rec3.id], /approved by the evaluator/i));
  check("only the evaluator can review a document", await fails(scholarUid(3), "select public.renewal_review_document($1,true,'')", [docRow.id.toString()], /Evaluator/)
    && await fails(COUNSELOR, "select public.renewal_review_document($1,true,'')", [docRow.id], /Evaluator/));
  check("returning a plan needs a comment", await fails(EVAL, "select public.renewal_review_document($1,false,'')", [docRow.id], /tell the scholar what to fix/));
  await rpc(EVAL, "select public.renewal_review_document($1,false,'Please add a semester schedule')", [docRow.id]);
  check("a returned plan: the scholar is told why, must upload again, and cannot book", (await notes(3, "study_plan_returned")).some(n => /semester schedule/.test(n.body)) && await stateOf() === "study_plan_missing"
    && (await q("select status, reviewer_comment from renewal_documents where id = $1", [docRow.id]))[0].status === "returned");
  const doc2 = (await rpc(scholarUid(3), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes)
    values ($1,$2,'study_plan',$3,'plan2.pdf','application/pdf',500) returning id`, [rec3.id, num(3), `${num(3)}/${rec3.id}/study_plan/${crypto.randomUUID()}-plan2.pdf`]))[0];
  check("a case with an unapproved plan is not ready to endorse", (await recordOf(3, T, S1)).stage === "needs_study_plan_consultation");
  await rpc(EVAL, "select public.renewal_review_document($1,true,'Good plan')", [doc2.id]);
  check("approved: the scholar is told they can book, and now can", await stateOf() === "ok" && (await notes(3, "study_plan_approved")).some(n => /book your consultation/.test(n.body)));
  check("the approved plan is kept and cannot be removed by the scholar", await (async () => { const rows = await as(scholarUid(3), async tx => (await tx.query("delete from renewal_documents where id = $1 returning id", [doc2.id])).rows); return rows.length === 0; })());

  const open = await rpc(scholarUid(3), "select * from public.renewal_open_slots($1)", [rec3.id]);
  check("a scholar sees open slots with the staff name", open.length >= 21 && open.every(o => o.staff_name));
  check("slots of ALL counseling staff are offered", new Set(open.map(o => o.staff_name)).size >= 2);
  const soon = await mkSlot({ startsInHours: 5 });
  const far = await mkSlot({ startsInHours: 13 });
  const open2 = await rpc(scholarUid(3), "select * from public.renewal_open_slots($1)", [rec3.id]);
  check("a slot starting in less than 12 hours is not offered", !open2.some(o => o.slot_id === soon.id));
  check("a slot starting in 13 hours is offered", open2.some(o => o.slot_id === far.id));
  check("another scholar cannot list slots for my application", await fails(scholarUid(4), "select * from public.renewal_open_slots($1)", [rec3.id], /not found/));
  slotA = (await q("select * from counseling_slots where availability_id = $1 order by starts_at limit 1", [rangeId]))[0];
}

console.log("\nBooking");
{
  await rpc(scholarUid(3), "select public.renewal_book_slot($1,$2)", [rec3.id, slotA.id]);
  const s = (await q("select * from counseling_slots where id = $1", [slotA.id]))[0];
  check("the slot becomes booked for this scholar and renewal", s.state === "booked" && s.scholar_id_number === num(3) && s.record_id === rec3.id);
  check("the scholar is notified with the time and the staff name", (await notes(3, "booking_confirmed")).some(n => /Demo|Counselor|Super Admin/.test(n.body) || /TEST/.test(n.body)));
  check("a second booking for the same renewal is refused (reschedule instead)", await fails(scholarUid(3), "select public.renewal_book_slot($1,$2)", [rec3.id, (await q("select id from counseling_slots where availability_id = $1 and state = 'open' order by starts_at limit 1", [rangeId]))[0].id], /already have a consultation/));
  check("a booked slot cannot be taken by another scholar", await (async () => { await apply(4, W1); const r4 = await recordOf(4, T, S1); return fails(scholarUid(4), "select public.renewal_book_slot($1,$2)", [r4.id, slotA.id], /just taken/); })());
  check("the database itself allows only one booked slot per renewal", await (async () => { try { await q("update counseling_slots set state='booked', record_id=$1, scholar_id_number=$2 where id = (select id from counseling_slots where state='open' and availability_id=$3 limit 1)", [rec3.id, num(3), rangeId]); return false; } catch { return true; } })());
  check("a slot starting in under 12 hours cannot be booked", await (async () => { const near = await mkSlot({ startsInHours: 8 }); const r4 = await recordOf(4, T, S1); return fails(scholarUid(4), "select public.renewal_book_slot($1,$2)", [r4.id, near.id], /at least 12 hours/); })());
  check("a counselor cannot book on a scholar's behalf through the scholar function", await fails(COUNSELOR, "select public.renewal_book_slot($1,$2)", [rec3.id, slotA.id], /Not signed in as a scholar/));
  const ov = (await rpc(scholarUid(3), "select public.renewal_my_overview() o"))[0].o;
  const w = ov.windows.find(x => x.window.term === S1 && x.window.school_year === T);
  check("the overview shows the booking and that it can still be changed", w.booking && w.booking.can_change === true && w.booking.staff_name && w.consult_needed === true);
  const board = await rpc(EVAL, "select * from public.renewal_board($1,$2)", [T, S1]);
  check("the evaluator's board shows the next consultation", !!board.find(b => b.scholar_id_number === num(3))?.next_consultation);
}

console.log("\nThe INC letter needs approval too, and a returned document cancels the booking");
{
  await mkScholar(103, ["INC", "1.5"]);
  await apply(103, W1);
  const r103 = await recordOf(103, T, S1);
  const free = await mkSlot({ startsInHours: 40 });
  check("INC: no letter yet -> cannot book, told to upload it first", await stateOfN(103, T, S1) === "inc_letter_missing"
    && await fails(uidOf(103), "select public.renewal_book_slot($1,$2)", [r103.id, free.id], /upload your INC letter from your dean first/i));
  const letter = await upload(103, T, S1, "inc_letter");
  check("INC: letter uploaded but not approved -> still cannot book", await stateOfN(103, T, S1) === "inc_letter_pending"
    && await fails(uidOf(103), "select public.renewal_book_slot($1,$2)", [r103.id, free.id], /INC letter has to be approved/i)
    && await fails(uidOf(103), "select * from public.renewal_open_slots($1)", [r103.id], /INC letter has to be approved/i));
  await rpc(EVAL, "select public.renewal_review_document($1,true,'')", [letter]);
  check("INC: letter approved -> the scholar is told and can book", await stateOfN(103, T, S1) === "ok" && (await notes(103, "inc_letter_approved")).length === 1);
  await rpc(uidOf(103), "select public.renewal_book_slot($1,$2)", [r103.id, free.id]);
  check("INC: booked", (await q("select state from counseling_slots where id = $1", [free.id]))[0].state === "booked");
  await rpc(EVAL, "select public.renewal_review_document($1,false,'The dean did not sign it')", [letter]);
  const after = (await q("select state, record_id from counseling_slots where id = $1", [free.id]))[0];
  check("Q2: returning the INC letter CANCELS the booking and frees the slot", after.state === "open" && after.record_id === null);
  check("Q2: the scholar is told why, and that they can book again after the new letter is approved", (await notes(103, "document_returned")).some(n => /did not sign it/.test(n.body) && /was cancelled/.test(n.body)) && await stateOfN(103, T, S1) === "inc_letter_missing");
  check("Q2: the cancellation is in the booking history", (await q("select count(*)::int n from counseling_booking_history where record_id = $1 and action = 'removed_by_staff' and note like '%returned%'", [r103.id]))[0].n === 1);
  const letter2 = await upload(103, T, S1, "inc_letter");
  await rpc(EVAL, "select public.renewal_review_document($1,true,'')", [letter2]);
  check("a new letter, approved: booking is open again", await stateOfN(103, T, S1) === "ok");

  // study plan: same rule
  await mkScholar(104, ["5.0", "1.5"]);
  await apply(104, W1);
  const r104 = await recordOf(104, T, S1);
  const plan = await upload(104, T, S1, "study_plan");
  await rpc(EVAL, "select public.renewal_review_document($1,true,'')", [plan]);
  const s104 = await mkSlot({ startsInHours: 45 });
  await rpc(uidOf(104), "select public.renewal_book_slot($1,$2)", [r104.id, s104.id]);
  await rpc(EVAL, "select public.renewal_review_document($1,false,'Plan is too short')", [plan]);
  check("Q2: returning the study plan cancels the booking too, until the new plan is approved", (await q("select state from counseling_slots where id = $1", [s104.id]))[0].state === "open"
    && await stateOfN(104, T, S1) === "study_plan_missing" && (await notes(104, "study_plan_returned")).some(n => /was cancelled/.test(n.body)));

  // a slot that is already over is not touched; the prospectus gates nothing
  await mkScholar(105, ["1.5", "2.0"]);
  await apply(105, W2);
  const r105 = await recordOf(105, "2025-2026", "Summer");
  check("Summer: no document needs approval before booking", await stateOfN(105, "2025-2026", "Summer") === "ok");
  const s105 = await mkSlot({ startsInHours: 50, state: "booked", record: r105.id, scholar: num(105) });
  const prosp = await upload(105, "2025-2026", "Summer", "prospectus");
  await rpc(EVAL, "select public.renewal_review_document($1,false,'Please scan all pages')", [prosp]);
  check("returning the prospectus does NOT cancel the booking", (await q("select state from counseling_slots where id = $1", [s105.id]))[0].state === "booked");
}

console.log("\nRescheduling and cancelling (scenarios 28 and 29)");
{
  // 28: the booked slot is 13 hours away -> a change is allowed
  const r4 = await recordOf(4, T, S1);
  const booked13 = await mkSlot({ startsInHours: 13, state: "booked", record: r4.id, scholar: num(4) });
  const target = await mkSlot({ startsInHours: 30 });
  await rpc(scholarUid(4), "select public.renewal_reschedule_slot($1,$2)", [r4.id, target.id]);
  check("28 reschedule with the booked slot 13 hours away is allowed", (await q("select state from counseling_slots where id = $1", [target.id]))[0].state === "booked"
    && (await q("select state, record_id from counseling_slots where id = $1", [booked13.id]))[0].state === "open");
  check("28 rescheduling can be repeated (unlimited)", await (async () => { const t2 = await mkSlot({ startsInHours: 40 }); await rpc(scholarUid(4), "select public.renewal_reschedule_slot($1,$2)", [r4.id, t2.id]); const t3 = await mkSlot({ startsInHours: 41 }); await rpc(scholarUid(4), "select public.renewal_reschedule_slot($1,$2)", [r4.id, t3.id]); return true; })());
  check("the history keeps every change", (await q("select count(*)::int n from counseling_booking_history where record_id = $1 and action = 'rescheduled'", [r4.id]))[0].n === 3);
  // 29: only 11 hours left -> blocked with a clear message
  await q("update counseling_slots set state = 'open', record_id = null, scholar_id_number = null where record_id = $1", [r4.id]);
  const booked11 = await mkSlot({ startsInHours: 11, state: "booked", record: r4.id, scholar: num(4) });
  const target2 = await mkSlot({ startsInHours: 60 });
  check("29 reschedule with 11 hours left is blocked with a clear message", await fails(scholarUid(4), "select public.renewal_reschedule_slot($1,$2)", [r4.id, target2.id], /up to 12 hours before it starts/));
  check("29 cancelling with 11 hours left is blocked too", await fails(scholarUid(4), "select public.renewal_cancel_booking($1)", [r4.id], /up to 12 hours before it starts/));
  check("29 the booking is unchanged", (await q("select state from counseling_slots where id = $1", [booked11.id]))[0].state === "booked");
  const ov = (await rpc(scholarUid(4), "select public.renewal_my_overview() o"))[0].o;
  check("29 the overview says it can no longer be changed", ov.windows.find(x => x.window.term === S1 && x.window.school_year === T).booking.can_change === false);
  // cancel with plenty of time
  await q("update counseling_slots set state = 'open', record_id = null, scholar_id_number = null where id = $1", [booked11.id]);
  const booked20 = await mkSlot({ startsInHours: 20, state: "booked", record: r4.id, scholar: num(4) });
  await rpc(scholarUid(4), "select public.renewal_cancel_booking($1)", [r4.id]);
  check("cancelling 20 hours ahead works and frees the slot", (await q("select state from counseling_slots where id = $1", [booked20.id]))[0].state === "open" && (await notes(4, "booking_cancelled")).length === 1);
  check("another scholar cannot reschedule or cancel my booking", await fails(scholarUid(1), "select public.renewal_cancel_booking($1)", [r4.id], /not found/));
}

console.log("\nNo-show, and booking again");
{
  const r4 = await recordOf(4, T, S1);
  const past = await mkSlot({ startsInHours: -1, state: "booked", record: r4.id, scholar: num(4) });
  check("a no-show cannot be marked before the slot starts", await (async () => { const future = await mkSlot({ startsInHours: 50, state: "booked", record: (await recordOf(1, T, S1)).id, scholar: num(1) }); return fails(COUNSELOR, "select public.counseling_mark_slot($1,'no_show')", [future.id], /after the slot has started/); })());
  check("only consultation staff can mark", await fails(EVAL, "select public.counseling_mark_slot($1,'no_show')", [past.id], /consultation staff/) && await fails(scholarUid(4), "select public.counseling_mark_slot($1,'attended')", [past.id], /consultation staff/));
  check("another staff member cannot mark someone else's slot", await fails(ADMIN, "select public.counseling_mark_slot($1,'no_show')", [past.id], /not found/));
  await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'no_show')", [past.id]);
  const r = await recordOf(4, T, S1);
  check("no-show: the renewal is flagged and counted", r.no_show_flag === true && r.no_show_count === 1);
  check("no-show: the scholar is told to book a new slot", (await notes(4, "no_show")).length === 1);
  check("no-show: the consultation is not counted as done", r.consultation_done_at === null);
  check("no-show: the scholar can book a new slot", await (async () => { const open = await rpc(scholarUid(4), "select * from public.renewal_open_slots($1)", [r.id]); await rpc(scholarUid(4), "select public.renewal_book_slot($1,$2)", [r.id, open[0].slot_id]); return true; })());
  check("a slot already marked cannot be marked again", await fails(COUNSELOR, "select public.counseling_mark_slot($1,'attended')", [past.id], /not booked/));
}

console.log("\nAttended: the pre-filled Daily Record, days given to comply, the Summer hard copy");
{
  // INC (scenario 10): needs the days given
  await apply(7, W1);
  const r7 = await recordOf(7, T, S1);
  const slot7 = await mkSlot({ startsInHours: -0.5, state: "booked", record: r7.id, scholar: num(7) });
  const pre = (await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'attended') r", [slot7.id]))[0].r;
  check("attended: the answer carries what the Daily Record is pre-filled with", pre.scholar_id_number === num(7) && /Mathematics|TEST/.test(pre.failed_subjects) && pre.inc_items.length === 1 && pre.is_summer === false);
  check("attended: the consultation counts as done", (await recordOf(7, T, S1)).consultation_done_at !== null);
  check("attended: still 'needs INC letter + consultation' because no deadline is set yet", (await recordOf(7, T, S1)).stage === "needs_inc_letter_consultation");
  check("the Daily Record needs the days given to comply (INC)", await fails(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Probationary',current_date,'x','f','r','Office',null,null)", [slot7.id, num(7)], /days given to comply/));
  const rec = (await rpc(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Probationary',current_date,'INC in Math','Will complete','Finish by deadline','Office',20,null) id", [slot7.id, num(7)]))[0].id;
  const item = (await q("select * from renewal_inc_items where record_id = $1", [r7.id]))[0];
  const visit = (await q("select date_visited from scholar_counseling_records where id = $1", [rec]))[0].date_visited;
  check("the days given set the deadline: consultation date + 20 days", iso(item.deadline) === iso(new Date(visit.getTime() + 20 * 86400000)) && item.days_given === 20, `${iso(item.deadline)} ${iso(visit)}`);
  check("the case moves to 'waiting for INC compliance' and the scholar is told the deadline", (await recordOf(7, T, S1)).stage === "inc_waiting_compliance" && (await notes(7, "inc_deadline_set")).length === 1);
  const dr = (await q("select * from scholar_counseling_records where id = $1", [rec]))[0];
  check("the Daily Record is linked to the appointment and the renewal and keeps the days given", dr.slot_id === slot7.id && dr.renewal_record_id === r7.id && dr.days_given === 20);
  check("a second Daily Record for the same appointment is refused", await fails(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Probationary',current_date,'','','','Office',5,null)", [slot7.id, num(7)], /already saved/));
  check("the deadline appears in Probationary Monitoring's renewal info with the temporary INC tag", await (async () => {
    const info = (await rpc(COUNSELOR, "select public.counseling_probation_renewal_info() i"))[0].i;
    const row = info.find(x => x.scholar_id_number === num(7));
    return row && row.temporary_inc === true && row.inc_items.length === 1 && row.inc_items[0].days_left > 15;
  })());
  check("a scholar cannot read that info", await fails(scholarUid(7), "select public.counseling_probation_renewal_info()", [], /consultation staff/));
  // extension by counseling staff
  check("the deadline can only be extended by consultation staff", await fails(EVAL, "select public.renewal_extend_inc_deadline($1,$2::date,'More time')", [item.id, iso(new Date(Date.now() + 90 * 86400000))], /consultation staff/));
  check("an extension needs a reason and a later date", await fails(COUNSELOR, "select public.renewal_extend_inc_deadline($1,$2::date,'')", [item.id, iso(new Date(Date.now() + 90 * 86400000))], /reason/)
    && await fails(COUNSELOR, "select public.renewal_extend_inc_deadline($1,$2::date,'earlier')", [item.id, iso(new Date(Date.now() + 1 * 86400000))], /later than/));
  await rpc(COUNSELOR, "select public.renewal_extend_inc_deadline($1,$2::date,'Student has exams')", [item.id, iso(new Date(Date.now() + 90 * 86400000))]);
  check("the extension and its reason are kept in the history", (await q("select count(*)::int n from renewal_inc_extensions where item_id = $1 and reason = 'Student has exams'", [item.id]))[0].n === 1 && (await notes(7, "deadline_extended")).length === 1);

  // 1 failed (scenario 4): study plan + consultation done -> ready to endorse
  const r3 = await recordOf(3, T, S1);
  await q("update counseling_slots set state = 'open', record_id = null, scholar_id_number = null where record_id = $1", [r3.id]);
  const slot3 = await mkSlot({ startsInHours: -2, state: "booked", record: r3.id, scholar: num(3) });
  await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'attended')", [slot3.id]);
  check("study plan approved + consultation attended: ready to endorse to the Division Head", (await recordOf(3, T, S1)).stage === "ready_to_endorse");
  const dr3 = (await rpc(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Regular',current_date,'Mathematics (5.0)','Plan reviewed','Endorse','Office',null,null) id", [slot3.id, num(3)]))[0].id;
  check("a case without INC needs no days given", !!dr3);

  // Summer (scenarios 22/24): hard copy of the prospectus
  await apply(30, W2);
  const r30 = await recordOf(30, "2025-2026", "Summer");
  await rpc(scholarUid(30), `insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'prospectus',$3,'p.pdf','application/pdf',500)`, [r30.id, num(30), `${num(30)}/${r30.id}/prospectus/${crypto.randomUUID()}-p.pdf`]);
  const slot30 = await mkSlot({ startsInHours: -1, state: "booked", record: r30.id, scholar: num(30) });
  const pre30 = (await rpc(COUNSELOR, "select public.counseling_mark_slot($1,'attended') r", [slot30.id]))[0].r;
  check("Summer: the pre-filled record knows it is a Summer renewal", pre30.is_summer === true && /Summer/.test(pre30.term_label));
  check("Summer: attended but no hard copy yet -> still waiting", (await recordOf(30, "2025-2026", "Summer")).stage === "summer_requirements");
  await rpc(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Regular',current_date,'','Prospectus reviewed','','Office',null,true)", [slot30.id, num(30)]);
  const done30 = await recordOf(30, "2025-2026", "Summer");
  check("Summer: hard copy received + prospectus + consultation: ready for the evaluator to confirm", done30.hard_copy_received_at !== null && done30.stage === "ready_for_confirmation", done30.stage);
  check("only consultation staff can tick the hard copy", await fails(EVAL, "select public.counseling_set_hard_copy($1,true)", [done30.id], /consultation staff/));
}

console.log("\nRemoving availability that scholars booked");
{
  const start = manilaAt(25, 9), end = manilaAt(25, 10);
  const range = (await rpc(COUNSELOR, "select public.counseling_availability_save(null,$1,$2,false) r", [start.toISOString(), end.toISOString()]))[0].r.id;
  // scholar 2 is all passed -> no consultation; use scholar 5 (needs consultation)
  await apply(5, W1);
  const r5 = await recordOf(5, T, S1);
  const slot = (await q("select * from counseling_slots where availability_id = $1 order by starts_at limit 1", [range]))[0];
  await rpc(scholarUid(5), "select public.renewal_book_slot($1,$2)", [r5.id, slot.id]);
  const warn = (await rpc(COUNSELOR, "select public.counseling_availability_delete($1,false) r", [range]))[0].r;
  check("removing a range with a booked slot first WARNS and changes nothing", warn.ok === false && warn.needs_confirm === true && warn.booked.length === 1 && /TEST/.test(warn.booked[0].name)
    && (await q("select count(*)::int n from counseling_slots where availability_id = $1", [range]))[0].n === 6);
  check("shrinking a range over a booked slot warns too", await (async () => {
    const w = (await rpc(COUNSELOR, "select public.counseling_availability_save($1,$2,$3,false) r", [range, new Date(start.getTime() + 20 * 60000).toISOString(), end.toISOString()]))[0].r;
    return w.ok === false && w.needs_confirm === true;
  })());
  const done = (await rpc(COUNSELOR, "select public.counseling_availability_delete($1,true) r", [range]))[0].r;
  check("confirmed: the range is gone and the booked scholar is notified", done.ok === true && done.notified === 1
    && (await q("select count(*)::int n from counseling_availability where id = $1", [range]))[0].n === 0 && (await notes(5, "slot_removed")).length === 1);
  check("the removal is recorded in the booking history and the scholar can book again", (await q("select count(*)::int n from counseling_booking_history where record_id = $1 and action = 'removed_by_staff'", [r5.id]))[0].n === 1
    && (await rpc(scholarUid(5), "select * from public.renewal_open_slots($1)", [r5.id])).length > 0);
  check("a staff member cannot remove another staff member's range", await (async () => { const o = (await rpc(ADMIN, "select public.counseling_availability_save(null,$1,$2,false) r", [manilaAt(26, 9).toISOString(), manilaAt(26, 10).toISOString()]))[0].r.id; return fails(COUNSELOR, "select public.counseling_availability_delete($1,true)", [o], /not found/); })());
  check("a range that has already started cannot be changed", await (async () => { const a = await mkSlot({ startsInHours: -1 }); return fails(COUNSELOR, "select public.counseling_availability_delete($1,true)", [a.availability_id], /already started|not found/); })());
}

console.log("\nReminders: 1 day and 1 hour before");
{
  await apply(6, W1);
  const r6 = await recordOf(6, T, S1);
  const s23 = await mkSlot({ startsInHours: 23, state: "booked", record: r6.id, scholar: num(6) });
  await q("update counseling_slots set reminded_day_at = null where id = $1", [s23.id]);
  const j1 = (await q("select public.renewal_scheduled_jobs() r"))[0].r;
  check("a booking within the next 24 hours gets the 1-day reminder once", j1.day_reminders >= 1 && (await notes(6, "reminder_day")).length === 1);
  await q("select public.renewal_scheduled_jobs()");
  check("running the scheduler again does not repeat it", (await notes(6, "reminder_day")).length === 1);
  check("the 1-hour reminder waits until the hour before", (await notes(6, "reminder_hour")).length === 0);
  await q("update counseling_slots set starts_at = now() + interval '50 minutes', ends_at = now() + interval '60 minutes' where id = $1", [s23.id]);
  await q("select public.renewal_scheduled_jobs()");
  check("inside the last hour the 1-hour reminder goes out once", (await notes(6, "reminder_hour")).length === 1);
  await q("select public.renewal_scheduled_jobs()");
  check("and is not repeated", (await notes(6, "reminder_hour")).length === 1);
  // booked less than 24 hours ahead: no "1 day" reminder is sent late
  await apply(20, W1);
  await approvePlan(20);
  const r20 = await recordOf(20, T, S1);
  const open13 = await mkSlot({ startsInHours: 13 });
  await rpc(scholarUid(20), "select public.renewal_book_slot($1,$2)", [r20.id, open13.id]);
  await q("select public.renewal_scheduled_jobs()");
  check("a slot booked only 13 hours ahead gets no (late) 1-day reminder", (await notes(20, "reminder_day")).length === 0);
  check("nobody but the system can run the scheduler", await fails(scholarUid(6), "select public.renewal_scheduled_jobs()", [], /permission denied|must be owner|not authorized/i) && await fails(EVAL, "select public.renewal_scheduled_jobs()", [], /permission denied|must be owner|not authorized/i));
  const ovInc = await rpc(EVAL, "select * from public.renewal_inc_list($1,$2)", [T, S1]);
  check("the INC deadline sweep still runs for the evaluator's lists", Array.isArray(ovInc));
}

console.log("\nRow-level security");
{
  const own = await as(scholarUid(3), async tx => (await tx.query("select scholar_id_number from counseling_booking_history")).rows);
  check("a scholar reads only their own booking history", own.length >= 1 && own.every(r => r.scholar_id_number === num(3)));
  const slotsSeen = await as(scholarUid(3), async tx => (await tx.query("select count(*)::int n from counseling_slots")).rows[0].n);
  check("a scholar cannot read the slots table directly (they use the functions)", slotsSeen === 0);
  const mine = await as(COUNSELOR, async tx => (await tx.query("select count(*)::int n from counseling_slots where staff_id <> $1", [COUNSELOR])).rows[0].n);
  check("a counselor sees only their own slots in the table", mine === 0);
  check("nobody can write the slot table directly", await (async () => { try { await rpc(COUNSELOR, "update counseling_slots set state = 'attended' where staff_id = $1", [COUNSELOR]); return (await q("select count(*)::int n from counseling_slots where state = 'attended' and marked_by is null"))[0].n === 0; } catch { return true; } })());
  const cal = await rpc(COUNSELOR, "select * from public.counseling_my_slots($1,$2)", [hoursFromNow(-100).toISOString(), hoursFromNow(24 * 30).toISOString()]);
  check("the calendar lists the counselor's slots with the scholar and the case", cal.some(c => c.state === "booked" && c.scholar_name && c.term_label) && cal.every(c => c.starts_at));
  check("a scholar cannot open the staff calendar", await fails(scholarUid(3), "select * from public.counseling_my_slots($1,$2)", [hoursFromNow(0).toISOString(), hoursFromNow(48).toISOString()], /consultation staff/));
  const detail = (await rpc(EVAL, "select public.renewal_record_detail($1) d", [(await recordOf(3, T, S1)).id]))[0].d;
  check("the evaluator's detail shows the appointment history", detail.appointments.length >= 1);
}

console.log("\nThe evaluator sees the counselors' calendars (read-only)");
{
  const staff = await rpc(EVAL, "select * from public.renewal_calendar_staff()");
  check("the evaluator can list the consultation staff", staff.some(s => s.staff_id === COUNSELOR) && staff.some(s => s.staff_id === ADMIN));
  const from = hoursFromNow(-100).toISOString(), to = hoursFromNow(24 * 60).toISOString();
  const all = await rpc(EVAL, "select * from public.renewal_calendar_slots($1,$2,null)", [from, to]);
  const onlyC = await rpc(EVAL, "select * from public.renewal_calendar_slots($1,$2,$3)", [from, to, COUNSELOR]);
  check("all staff's slots are visible, with the staff name, the scholar and the case", all.some(s => s.staff_id === ADMIN) && all.some(s => s.staff_id === COUNSELOR) && all.filter(s => s.state === "booked").every(s => s.scholar_name && s.staff_name));
  check("the evaluator can pick one staff member", onlyC.length > 0 && onlyC.every(s => s.staff_id === COUNSELOR) && onlyC.length < all.length);
  const av = await rpc(EVAL, "select * from public.renewal_calendar_availability($1,$2,null)", [from, to]);
  check("the ranges are listed with their slot counts", av.length > 0 && av.every(a => a.slot_count >= 1 && a.staff_name));
  check("it is READ-ONLY: the evaluator cannot mark, book, add or remove anything", await fails(EVAL, "select public.counseling_mark_slot($1,'attended')", [all.find(s => s.state === "booked").slot_id], /consultation staff/)
    && await fails(EVAL, "select public.counseling_availability_delete($1,true)", [av[0].id], /consultation staff/)
    && await fails(EVAL, "select public.counseling_availability_save(null,$1,$2,false)", [manilaAt(30, 9).toISOString(), manilaAt(30, 10).toISOString()], /consultation staff/));
  check("nobody else can use the evaluator's calendar view", await fails(COUNSELOR, "select * from public.renewal_calendar_slots($1,$2,null)", [from, to], /Evaluator/)
    && await fails(scholarUid(3), "select * from public.renewal_calendar_staff()", [], /Evaluator/));
}

console.log("\nSafety: running the Phase 3 migration twice changes nothing");
{
  const count = async () => (await q("select (select count(*) from counseling_slots) a, (select count(*) from counseling_availability) b, (select count(*) from counseling_booking_history) c, (select count(*) from scholar_notifications) d"))[0];
  const before = await count();
  let ok = true;
  try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p3_appointments.sql", import.meta.url), "utf8")); } catch (e) { ok = false; console.log("   ", e.message); }
  check("the migration can be run twice", ok);
  check("and keeps every slot, range, history row and notification", JSON.stringify(before) === JSON.stringify(await count()));
}

console.log(`\n${failed === 0 ? "ALL PHASE 3 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
