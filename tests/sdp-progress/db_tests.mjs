// tests/sdp-progress/db_tests.mjs — SDP Progress Monitoring (picture confirmation): the tables, the private folder and the functions
//   (supabase_migration_sdp_progress_a_tables_functions.sql, supabase_migration_sdp_progress_b_qr_guard.sql)
// Run:  node tests/sdp-progress/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
// the demo seed already has one picture-confirmed activity with four pictures: these tests start from nothing so that every count is exact
await q("delete from sdp_progress_submissions"); await q("delete from sdp_progress_monitoring");
await q("delete from sdp_attendance where activity_id = $1", [seedId("act:progress")]); await q("delete from storage.objects where bucket_id = 'sdp-progress-photos'");
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain"), MONITOR = seedId("staff:demo.monitor"), ADMIN = seedId("staff:demo.admin");
const uidOf = n => seedId(`scholar:${n}`);
const sidOf = n => `TEST-${String(n).padStart(4, "0")}`;
const cur = (await q("select current_school_year sy, current_semester sem from grading_period_settings where id = true"))[0];

// activities of my own
const mkAct = async (key, { category = "community_service", start = "now()", end = "now() + interval '2 hours'", credits = 1, extra = "'[]'" } = {}) => {
  const id = seedId(`progtest:${key}`);
  await q(`insert into sdp_activities (id, name, category, activity_type, date_time, end_time, recurring_dates, credits, all_year_levels, organization, venue, nature, source_of_fund, objectives, target_partners, specific_role, work_plan, program_flow, budget_items, target_year_levels, target_barangays, target_clusters)
    values ($1, $2, ${category === null ? "null" : "'" + category + "'"}, 'one_time', ${start}, ${end}, ${extra}::jsonb, $3, true, 'TEST Org', 'TEST venue', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', '{}')`, [id, `PROG ${key}`, credits]);
  return id;
};
const A = await mkAct("today"), B = await mkAct("ended", { start: "now() - interval '3 days'", end: "now() - interval '3 days' + interval '2 hours'" }), C = await mkAct("nocategory", { category: null });
const D = await mkAct("series", { start: "now() - interval '1 day'", end: "now() - interval '1 day' + interval '2 hours'", extra: `jsonb_build_array(jsonb_build_object('date', (now() + interval '2 days')::text, 'venue', 'x'))` });
const E = await mkAct("monitored");
await q("insert into activity_monitors (activity_type, activity_id, staff_id) values ('sdp', $1, $2) on conflict do nothing", [E, MONITOR]);
const QRACT = seedId("act:coastal");           // a seeded activity that already has QR attendance
const path = (n, act, f = "a.jpg") => `${sidOf(n)}/${act}/${f}`;
const submit = (n, act, o = {}) => attempt(uidOf(n), "select public.sdp_progress_submit($1, $2, $3::timestamptz, $4, $5, $6, $7) r",
  [act, o.path ?? path(n, act, o.file ?? "a.jpg"), o.at ?? new Date().toISOString(), "lat" in o ? o.lat : 8.4542, "lng" in o ? o.lng : 124.6319, o.acc ?? 12, o.place ?? "Carmen, Cagayan de Oro City, Misamis Oriental"]);

console.log("The new tables, folder and functions");
check("both tables exist with row level security on", (await q("select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('sdp_progress_monitoring', 'sdp_progress_submissions') and c.relrowsecurity"))[0].n === 2);
check("the private picture folder exists, is not public, accepts only JPEG up to 2 MB", (await q("select * from storage.buckets where id = 'sdp-progress-photos'")).every(b => b.public === false && Number(b.file_size_limit) === 2097152 && JSON.stringify(b.allowed_mime_types) === JSON.stringify(["image/jpeg"])) && (await q("select count(*)::int n from storage.buckets where id = 'sdp-progress-photos'"))[0].n === 1);
const direct = await attempt(uidOf(1), "insert into sdp_progress_submissions (activity_id, scholar_id_number, image_path, captured_at, taken_lat, taken_lng) values ($1, 'TEST-0001', 'x', now(), 1, 1)", [A]);
check("a scholar cannot write to the tables directly (only the functions can)", !direct.ok);

console.log("\nAttach / detach");
check("a staff member without the SDP tag cannot turn it on", /not allowed to turn on/.test((await attempt(PLAIN, "select public.sdp_progress_enable($1)", [A])).msg ?? ""));
check("a scholar cannot turn it on", !(await attempt(uidOf(1), "select public.sdp_progress_enable($1)", [A])).ok);
check("an activity with no SDP category cannot get it (credit would have nowhere to go)", /Choose an SDP category/.test((await attempt(SEAD, "select public.sdp_progress_enable($1)", [C])).msg ?? ""));
check("an activity that already has QR attendance cannot get it", /QR attendance is already attached/.test((await attempt(SEAD, "select public.sdp_progress_enable($1)", [QRACT])).msg ?? ""));
for (const act of [A, B, D, E]) { const r = await attempt(SEAD, "select public.sdp_progress_enable($1)", [act]); if (!r.ok) console.log("   enable failed:", r.msg); }
check("SDP staff turn it on for the activities (twice is fine)", (await q("select count(*)::int n from sdp_progress_monitoring where activity_id = any($1)", [[A, B, D, E]]))[0].n === 4 && (await attempt(SEAD, "select public.sdp_progress_enable($1)", [A])).ok);
check("every signed-in user can see which activities use it (the scholar needs this)", (await rows(uidOf(1), "select count(*)::int n from sdp_progress_monitoring where activity_id = $1", [A]))[0].n === 1);
const qrNow = await attempt(SEAD, "insert into attendance_sessions (sdp_activity_id, type, expected_attendees) values ($1, 'voucher', 5)", [A]);
check("QR attendance can no longer be attached to an activity that has it (step B)", !qrNow.ok && /one way of confirming attendance/.test(qrNow.msg));
check("QR attendance for other activities is not affected by the guard", (await attempt(SEAD, "insert into attendance_sessions (sdp_activity_id, type, expected_attendees) values ($1, 'voucher', 5)", [C])).ok);

console.log("\nThe scholar sends a picture");
const s1 = await submit(1, A);
check("the picture is recorded as pending, with the place, the position and the two times", s1.ok && (await q("select * from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A])).every(r => r.status === "pending" && r.place_text.startsWith("Carmen") && Number(r.taken_lat) === 8.4542 && r.submitted_at && r.captured_at), s1.msg);
check("a first picture has no old file to delete", s1.ok && s1.rows[0].r.old_path === null);
const s1b = await submit(1, A, { file: "b.jpg" });
check("a second picture while waiting REPLACES the first (still one row) and names the old file to delete", s1b.ok && s1b.rows[0].r.old_path === path(1, A, "a.jpg") && (await q("select count(*)::int n from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A]))[0].n === 1 && (await q("select image_path from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A]))[0].image_path === path(1, A, "b.jpg"));
check("a picture in someone else's folder is refused", /not in your folder/.test((await submit(2, A, { path: path(1, A, "z.jpg") })).msg ?? ""));
check("a picture for another activity's folder is refused", /not in your folder/.test((await submit(2, A, { path: path(2, D, "z.jpg") })).msg ?? ""));
check("a phone clock that is off by more than 15 minutes is refused, with a clear message", /date and time on your phone/.test((await submit(2, A, { at: new Date(Date.now() - 40 * 60000).toISOString() })).msg ?? "") && /date and time on your phone/.test((await submit(2, A, { at: new Date(Date.now() + 40 * 60000).toISOString() })).msg ?? ""));
check("a picture with no location is refused", /location is needed/.test((await submit(2, A, { lat: null, lng: null })).msg ?? ""));
check("an activity that has ended is refused, with its last date", /has ended \(its last date was/.test((await submit(2, B)).msg ?? ""));
check("any day until the LAST date works: a series that started yesterday and ends in 2 days still accepts", (await submit(2, D)).ok);
check("an activity without progress monitoring is refused", /does not use picture confirmation/.test((await submit(2, C)).msg ?? ""));
check("a visitor or staff member (not a scholar) cannot send a picture", !(await attempt(SEAD, "select public.sdp_progress_submit($1, 'x/y/z.jpg', now(), 1, 1, 1, 'x')", [A])).ok);
const status3 = (await q("select status from scholars where scholar_id_number = $1", [sidOf(3)]))[0].status;
await q("update scholars set status = 'Removed' where scholar_id_number = $1", [sidOf(3)]);
check("a removed scholar cannot send a picture", /scholarship has ended/.test((await submit(3, A)).msg ?? ""));
await q("update scholars set status = $2 where scholar_id_number = $1", [sidOf(3), status3]);
check("a scholar sees only their own pictures", (await rows(uidOf(2), "select count(*)::int n from sdp_progress_submissions"))[0].n === 1 && (await rows(uidOf(1), "select count(*)::int n from sdp_progress_submissions"))[0].n === 1);
check("a staff member without any tag or monitoring sees none", (await rows(PLAIN, "select count(*)::int n from sdp_progress_submissions"))[0].n === 0);

console.log("\nThe list for the reviewers");
check("a staff member without the tag (and not a monitor) cannot open the list or the counts", !(await attempt(PLAIN, "select * from public.sdp_progress_list()")).ok && !(await attempt(PLAIN, "select * from public.sdp_progress_counts()")).ok);
check("a scholar cannot open the list", !(await attempt(uidOf(1), "select * from public.sdp_progress_list()")).ok);
const list = await attempt(SEAD, "select * from public.sdp_progress_list('pending')");
check("SDP staff see the pending pictures with the scholar's ID, name, school, program, the activity and the place", list.ok && list.rows.length === 2 && list.rows.every(r => r.scholar_id_number && r.scholar_name && r.school && r.program && r.activity_name && r.image_path && r.total_count == 2), list.msg);
check("the oldest waiting picture comes first", list.ok && list.rows[0].scholar_id_number === "TEST-0001");
check("the list can be narrowed by activity and by name or ID", (await attempt(SEAD, "select * from public.sdp_progress_list('pending', $1)", [D])).rows.length === 1 && (await attempt(SEAD, "select * from public.sdp_progress_list('pending', null, 'TEST-0002')")).rows.length === 1 && (await attempt(SEAD, "select * from public.sdp_progress_list('pending', null, 'zzzzz')")).rows.length === 0);
const cnt = (await attempt(SEAD, "select * from public.sdp_progress_counts()")).rows[0];
check("the counts say 2 waiting, 0 approved, 0 rejected", Number(cnt.pending) === 2 && Number(cnt.approved) === 0 && Number(cnt.rejected) === 0);
check("a monitor sees only the activity they monitor", (await attempt(MONITOR, "select * from public.sdp_progress_list('all')")).rows.length === 0);
await submit(4, E);
const mon = await attempt(MONITOR, "select * from public.sdp_progress_list('all')");
check("…and then sees that activity's picture, but not the others", mon.ok && mon.rows.length === 1 && mon.rows[0].activity_id === E, mon.msg);

console.log("\nApprove");
const sub1 = (await q("select id from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A]))[0].id;
check("a scholar cannot approve their own picture", !(await attempt(uidOf(1), "select public.sdp_progress_approve($1)", [sub1])).ok);
check("a staff member without the tag (not a monitor) cannot approve", /not allowed to review/.test((await attempt(PLAIN, "select public.sdp_progress_approve($1)", [sub1])).msg ?? ""));
const ap = await attempt(SEAD, "select public.sdp_progress_approve($1) r", [sub1]);
check("approving credits the scholar once: a sdp_attendance row in the current school year and semester, created by the approver", ap.ok && ap.rows[0].r.credit === "credited" && (await q("select * from sdp_attendance where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A])).every(r => r.school_year === cur.sy && r.semester === cur.sem && r.occurrence_number === 1 && r.created_by === SEAD), ap.msg);
check("the picture is now approved, with who and when", (await q("select * from sdp_progress_submissions where id = $1", [sub1]))[0].status === "approved" && (await q("select reviewed_by from sdp_progress_submissions where id = $1", [sub1]))[0].reviewed_by === SEAD);
check("the credit history says it came from a picture approval", (await q("select source, actor_name from sdp_credit_history where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A])).some(r => r.source === "progress_picture"));
check("approving again changes nothing (no second credit)", (await attempt(SEAD, "select public.sdp_progress_approve($1) r", [sub1])).rows[0].r.credit === "already_approved" && (await q("select count(*)::int n from sdp_attendance where activity_id = $1 and scholar_id_number = 'TEST-0001'", [A]))[0].n === 1);
check("a scholar whose picture was approved cannot send another", /already approved/.test((await submit(1, A, { file: "c.jpg" })).msg ?? ""));
const sub2 = (await q("select id from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0002'", [D]))[0].id;
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, 'TEST-0002', current_date, $2, $3, 1)", [D, cur.sy, cur.sem]);
const apDup = await attempt(ADMIN, "select public.sdp_progress_approve($1) r", [sub2]);
check("a scholar who was already credited by hand: the picture is approved, no second credit is made", apDup.ok && apDup.rows[0].r.credit === "already_credited" && (await q("select count(*)::int n from sdp_attendance where activity_id = $1 and scholar_id_number = 'TEST-0002'", [D]))[0].n === 1);
// a scholar who already has the 3 credits of the category this semester still gets the credit (the SDP tab shows 4/3: credit above the requirement is not capped or banked)
for (let i = 0; i < 3; i++) {
  const x = await mkAct(`filler${i}`);
  await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, school_year, semester, occurrence_number) values ($1, 'TEST-0005', current_date, $2, $3, 1)", [x, cur.sy, cur.sem]);
}
await submit(5, E);
const sub5 = (await q("select id from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0005'", [E]))[0].id;
const over = await attempt(MONITOR, "select public.sdp_progress_approve($1) r", [sub5]);
check("a monitor of the activity can approve; a scholar who already has 3 credits in the category still gets this one (shown as 4/3), the same as a QR scan", over.ok && over.rows[0].r.credit === "credited" && (await q("select count(*)::int n from sdp_attendance where activity_id = $1 and scholar_id_number = 'TEST-0005'", [E]))[0].n === 1, over.msg);
const notMine = (await q("select id from sdp_progress_submissions where status = 'pending' and activity_id <> $1 limit 1", [E]))[0]?.id;
check("a monitor cannot approve a picture of an activity they do not monitor", !notMine || /not allowed to review/.test((await attempt(MONITOR, "select public.sdp_progress_approve($1)", [notMine])).msg ?? ""));

console.log("\nReject");
await submit(6, A);
const sub6 = (await q("select id from sdp_progress_submissions where activity_id = $1 and scholar_id_number = 'TEST-0006'", [A]))[0].id;
check("a scholar cannot reject", !(await attempt(uidOf(6), "select public.sdp_progress_reject($1, 'x')", [sub6])).ok);
const rej = await attempt(SEAD, "select public.sdp_progress_reject($1, $2)", [sub6, "Too dark: take it again outside."]);
check("rejecting keeps the reason, who and when, and makes NO credit", rej.ok && (await q("select * from sdp_progress_submissions where id = $1", [sub6])).every(r => r.status === "rejected" && r.reject_reason === "Too dark: take it again outside." && r.reviewed_at) && (await q("select count(*)::int n from sdp_attendance where activity_id = $1 and scholar_id_number = 'TEST-0006'", [A]))[0].n === 0, rej.msg);
check("the scholar can read the reason on their own picture", (await rows(uidOf(6), "select reject_reason from sdp_progress_submissions where id = $1", [sub6]))[0].reject_reason === "Too dark: take it again outside.");
const again = await submit(6, A, { file: "second.jpg" });
check("after a rejection the scholar takes the picture again: back to pending, the reason is cleared, the old file is named for deletion", again.ok && again.rows[0].r.old_path === path(6, A, "a.jpg") && (await q("select status, reject_reason from sdp_progress_submissions where id = $1", [sub6]))[0].status === "pending" && (await q("select reject_reason from sdp_progress_submissions where id = $1", [sub6]))[0].reject_reason === null);
check("an approved picture cannot be rejected", /already approved/.test((await attempt(SEAD, "select public.sdp_progress_reject($1, 'no')", [sub1])).msg ?? ""));
const cnt2 = (await attempt(SEAD, "select * from public.sdp_progress_counts()")).rows[0];
check("the counts follow the pictures: 3 approved, 2 waiting (the rejected one was sent again)", Number(cnt2.approved) === 3 && Number(cnt2.pending) === 2 && Number(cnt2.rejected) === 0, JSON.stringify(cnt2));

console.log("\nThe category is needed to approve");
const F = await mkAct("lateCategory"); await attempt(SEAD, "select public.sdp_progress_enable($1)", [F]);
await submit(7, F); await q("update sdp_activities set category = null where id = $1", [F]);
check("if the category was removed after the picture was sent, approving says to choose it first (nothing is credited)", /Choose an SDP category/.test((await attempt(SEAD, "select public.sdp_progress_approve($1)", [(await q("select id from sdp_progress_submissions where activity_id = $1", [F]))[0].id])).msg ?? ""));

console.log("\nTurning it off");
const pendA = (await q("select count(*)::int n from sdp_progress_submissions where activity_id = $1 and status = 'pending'", [A]))[0].n;
const dis = await attempt(SEAD, "select public.sdp_progress_disable($1)", [A]);
check("…it is refused with a clear message while pictures wait, and works once none waits", pendA > 0 ? (!dis.ok && /still waiting for approval/.test(dis.msg)) : dis.ok);
await q("update sdp_progress_submissions set status = 'rejected' where activity_id = $1 and status = 'pending'", [A]);
check("with nothing waiting it is turned off", (await attempt(SEAD, "select public.sdp_progress_disable($1)", [A])).ok && (await q("select count(*)::int n from sdp_progress_monitoring where activity_id = $1", [A]))[0].n === 0);
check("QR attendance can then be attached again", (await attempt(SEAD, "insert into attendance_sessions (sdp_activity_id, type, expected_attendees) values ($1, 'voucher', 5)", [A])).ok);

console.log("\nThe private folder");
const ins = (uid, name) => attempt(uid, "insert into storage.objects (bucket_id, name, metadata) values ('sdp-progress-photos', $1, '{}'::jsonb)", [name]);
check("a scholar can add a picture in their own folder only", (await ins(uidOf(8), `${sidOf(8)}/${D}/p.jpg`)).ok && !(await ins(uidOf(8), `${sidOf(9)}/${D}/p.jpg`)).ok);
check("a scholar reads their own picture, another scholar does not, SDP staff do", (await rows(uidOf(8), "select count(*)::int n from storage.objects where bucket_id = 'sdp-progress-photos' and name = $1", [`${sidOf(8)}/${D}/p.jpg`]))[0].n === 1
  && (await rows(uidOf(9), "select count(*)::int n from storage.objects where bucket_id = 'sdp-progress-photos' and name = $1", [`${sidOf(8)}/${D}/p.jpg`]))[0].n === 0
  && (await rows(SEAD, "select count(*)::int n from storage.objects where bucket_id = 'sdp-progress-photos' and name = $1", [`${sidOf(8)}/${D}/p.jpg`]))[0].n === 1);
check("a staff member without the tag does not read it", (await rows(PLAIN, "select count(*)::int n from storage.objects where bucket_id = 'sdp-progress-photos' and name = $1", [`${sidOf(8)}/${D}/p.jpg`]))[0].n === 0);
await q("insert into storage.objects (bucket_id, name, metadata) values ('sdp-progress-photos', $1, '{}'::jsonb)", [path(1, A, "b.jpg")]);
check("a scholar can remove their own waiting picture, but never an approved one", (await rows(uidOf(8), "delete from storage.objects where bucket_id = 'sdp-progress-photos' and name = $1 returning name", [`${sidOf(8)}/${D}/p.jpg`])).length === 1
  && (await rows(uidOf(1), "delete from storage.objects where bucket_id = 'sdp-progress-photos' and name = $1 returning name", [path(1, A, "b.jpg")])).length === 0);

console.log("\nThe files");
check("each file has an undo file, and the undo of A does not delete any existing SDP table", fs.existsSync("undo_sdp_progress_a.sql") && fs.existsSync("undo_sdp_progress_b.sql") && !/drop table (if exists )?public\.(sdp_attendance|sdp_activities|attendance_sessions|scholars)\b/i.test(read("undo_sdp_progress_a.sql")));
check("step A alters no existing table and deletes nothing; step B only adds the guard", !/alter table public\.(?!sdp_progress)(sdp_|attendance_|scholars)/i.test(read("supabase_migration_sdp_progress_a_tables_functions.sql")) && !/\bdelete from\b[^;]*sdp_attendance|\btruncate\b/i.test(read("supabase_migration_sdp_progress_a_tables_functions.sql")) && /lock_timeout = '5s'/.test(read("supabase_migration_sdp_progress_b_qr_guard.sql")));
await db.exec(read("undo_sdp_progress_b.sql")); await db.exec(read("undo_sdp_progress_a.sql"));
check("after the undo the pictures' tables, functions and guard are gone, and the existing credits stay", (await q("select count(*)::int n from pg_class where relname in ('sdp_progress_monitoring', 'sdp_progress_submissions')"))[0].n === 0 && (await q("select count(*)::int n from pg_proc where proname like 'sdp_progress_%'"))[0].n === 0 && (await q("select count(*)::int n from sdp_attendance where activity_id = $1", [A]))[0].n >= 1);
await db.exec(read("supabase_migration_sdp_progress_a_tables_functions.sql")); await db.exec(read("supabase_migration_sdp_progress_b_qr_guard.sql"));
check("they can be put back after the undo", (await q("select count(*)::int n from pg_proc where proname = 'sdp_progress_approve'"))[0].n === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
