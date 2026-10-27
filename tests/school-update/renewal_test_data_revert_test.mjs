// tests/school-update/renewal_test_data_revert_test.mjs — the revert of the renewal test data (sql_oneoff/renewal_test_data_REVERT.sql)
//   a dry run changes nothing; it stops when anything belongs to a non-test account; the real run backs up, removes only what it says, keeps everything else.
// Run:  node tests/school-update/renewal_test_data_revert_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const SQL = fs.readFileSync("sql_oneoff/renewal_test_data_REVERT.sql", "utf8");
const DRY = SQL, REAL = SQL.replace("v_confirm text := 'NO';", "v_confirm text := 'YES';");
check("the file as sent is the dry run (it says 'NO')", /v_confirm text := 'NO';/.test(SQL));
const run = async sql => { const res = await db.exec(sql); return res[res.length - 1]?.rows ?? []; };
const attempt = async sql => { try { return { ok: true, rows: await run(sql) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const tables = ["renewal_windows", "renewal_records", "renewal_history", "renewal_documents", "renewal_inc_items", "csr_issued", "csr_counters", "scholar_notifications", "renewal_notice_log", "notifications",
  "push_outbox", "renewal_export_log", "scholars", "scholar_status_history", "counseling_availability", "counseling_slots", "scholar_counseling_referrals", "scholar_counseling_records", "push_subscriptions", "renewal_study_plan_forms"];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await q(`select count(*)::int n from public.${t}`))[0].n])));

console.log("\nIt stops when something belongs to a real (non-test) person or to a booking");
check("the demo data has bookings and referrals tied to renewals, so the script stops and says why", await (async () => { const r = await attempt(DRY); return !r.ok && /STOPPED/.test(r.msg); })());
check("on the demo, before the testers are set, it also stops (applications that belong to no testers-only window)", (await attempt(REAL)).ok === false);

// the real project's situation: one testers-only window, applications from the testers, one certificate, and the bookings / referrals / Daily Records that the test applications made (all hang on test applications)
const owners = await q("select distinct w.id, r.scholar_id_number from renewal_records r join renewal_windows w on w.id = r.window_id");
for (const w of [...new Set(owners.map(o => o.id))]) await q("update renewal_windows set testers = $2 where id = $1", [w, owners.filter(o => o.id === w).map(o => o.scholar_id_number)]);
const tester1 = (await q("select r.scholar_id_number s, r.id, r.school_year y, r.term t from renewal_records r order by r.scholar_id_number limit 1"))[0];
await q("insert into csr_issued (csr_number, version, record_id, scholar_id_number, school_year, term, issued_at, storage_path) values ('CSR-DEMO-0001', 1, $1, $2, $3, $4, now(), $5)", [tester1.id, tester1.s, tester1.y, tester1.t, tester1.s + "/CSR-DEMO-0001.pdf"]);
await q("insert into csr_counters (school_year, term, last_number) values ($1, $2, 1) on conflict (school_year, term) do update set last_number = 1", [tester1.y, tester1.t]);
await q("insert into renewal_notice_log (kind, scholar_id_number, ref) values ('window_open', 'TEST-0001', 'demo'), ('window_open', 'TEST-0002', 'demo')");
await q("insert into push_outbox (owner_kind, scholar_id_number, title, body) values ('scholar', 'TEST-0001', 'Renewal is now open', 'x')");
await q("insert into renewal_export_log (by_label, school_year, term, row_count) values ('test', '2026-2027', '1st Semester', 3)");
await q("insert into notifications (id, type, user_id, user_name, title, message, \"timestamp\", read, reference_id) values (gen_random_uuid(), 'renewal', $1, '', 'Renewal test', 'x', now(), false, ''), (gen_random_uuid(), 'task', $1, '', 'A normal task notice', 'x', now(), false, '')", [seedId("staff:demo.evaluator")]);
await q("insert into scholar_notifications (scholar_id_number, kind, title, body) values ('TEST-0001', 'some_other_kind', 'Not a renewal notice', 'x')");
const csrBefore = (await q("select count(*)::int n from csr_issued"))[0].n;
// like the real project: one booking made by the new booking system (it has a type), one made the older way (a ready-made time slot), and a Daily Record the renewal made for a test application
await q("update counseling_slots set consult_type = 'INC', minutes = 8 where id = (select id from counseling_slots where record_id is not null order by starts_at limit 1)");
await q("insert into scholar_counseling_records (scholar_id_number, status, consulted_by, renewal_record_id) select r.scholar_id_number, 'Regular', (select staff_id from counseling_slots where record_id is not null limit 1), r.id from renewal_records r order by r.scholar_id_number limit 1");
const linked = (await q(`select (select count(*)::int from counseling_slots where record_id is not null) slots, (select count(*)::int from counseling_slots where record_id is not null and (consult_type is not null or referral_id is not null)) deleted_slots,
  (select count(*)::int from scholar_counseling_referrals where renewal_record_id is not null) refs, (select count(*)::int from scholar_counseling_records where renewal_record_id is not null) recs`))[0];
check("the demo has bookings, referrals and Daily Records that hang on test applications (like the real project's two of each)", linked.slots >= 2 && linked.deleted_slots === 1 && linked.refs >= 1 && linked.recs === 1, JSON.stringify(linked));
const before = await counts();
check("the demo now looks like the real project: applications from the testers, a certificate, notices, push messages", before.renewal_records > 0 && csrBefore >= 1 && before.scholar_notifications > 0 && before.push_outbox >= 1 && before.renewal_notice_log >= 2);

console.log("\nThe dry run");
const dry = await run(DRY);
const find = (rows, what) => rows.find(r => r.what.startsWith(what));
check("it only counts: nothing in any table changed, and no holding table was made", JSON.stringify(await counts()) === JSON.stringify(before) && (await q("select to_regclass('public._renewal_test_backup') t"))[0].t === null);
check("it says it is a dry run", dry.some(r => r.step === "RESULT" && /DRY RUN/.test(r.what)));
check("it counts exactly what it would remove", Number(find(dry, "applications of the test accounts").rows) === before.renewal_records && Number(find(dry, "notices sent to scholars").rows) === before.scholar_notifications - 1
  && Number(find(dry, "staff bell notices").rows) === 1 && Number(find(dry, "queued").rows) === before.push_outbox && Number(find(dry, "certificate records").rows) === csrBefore, JSON.stringify(dry.filter(r => r.step === "1. REMOVE")));
check("it lists the certificate file to delete by hand", dry.some(r => r.step.startsWith("2. FILE") && r.what === "TEST-0026/CSR-DEMO-0001.pdf" || r.step.startsWith("2. FILE") && r.what.endsWith("/CSR-DEMO-0001.pdf")));

check("it counts the bookings, time slots, referrals and Daily Records it would remove", Number(find(dry, "consultation bookings of the test").rows) === linked.deleted_slots
  && Number(find(dry, "consultation time slots").rows) === linked.slots - linked.deleted_slots && Number(find(dry, "consultation referrals").rows) === linked.refs && Number(find(dry, "Daily Records").rows) === linked.recs, JSON.stringify(dry.filter(r => r.step === "1. REMOVE")));

console.log("\nA person who is not a test account");
const outsider = (await q("select scholar_id_number s, window_id w from renewal_records limit 1"))[0];
const testersOfW = (await q("select testers from renewal_windows where id = $1", [outsider.w]))[0].testers;
await q("update renewal_windows set testers = $2 where id = $1", [outsider.w, testersOfW.filter(s => s !== outsider.s).concat(["TEST-0099"])]);
const stop = await attempt(REAL);
check("an application of someone who is not on the testers list stops the script, and nothing changed", !stop.ok && /do not belong to the test accounts/.test(stop.msg) && JSON.stringify(await counts()) === JSON.stringify(before), stop.msg);
await q("update renewal_windows set testers = $2 where id = $1", [outsider.w, testersOfW]);
await q("update renewal_windows set testers = null where id = $1", [outsider.w]);
check("an application in a window that is open to everyone stops it too", !(await attempt(REAL)).ok);
await q("update renewal_windows set testers = $2 where id = $1", [outsider.w, testersOfW]);

console.log("\nThe real run");
const real = await run(REAL);
const after = await counts();
check("it says it is done", real.some(r => r.step === "RESULT" && /DONE/.test(r.what)));
check("the applications and everything that hangs on them are gone", after.renewal_records === 0 && after.renewal_history === 0 && after.renewal_documents === 0 && after.renewal_inc_items === 0);
check("the certificate record and its counter are gone (the next certificate starts again at number 1)", after.csr_issued === 0 && after.csr_counters === 0);
check("the renewal notices, the 'already told' marks, the staff bell notice, the push messages and the Excel log are gone", after.renewal_notice_log === 0 && after.push_outbox === 0 && after.renewal_export_log === 0
  && (await q("select count(*)::int n from notifications where type = 'renewal'"))[0].n === 0 && (await q("select count(*)::int n from scholar_notifications where kind <> 'some_other_kind'"))[0].n === 0);
check("everything else is untouched: a normal staff notice, a non-renewal scholar notice, every scholar, the status history, the windows and their testers, availability, devices, study plan templates",
  (await q("select count(*)::int n from notifications where type = 'task'"))[0].n === 1 && (await q("select count(*)::int n from scholar_notifications where kind = 'some_other_kind'"))[0].n === 1
  && after.scholars === before.scholars && after.scholar_status_history === before.scholar_status_history && after.renewal_windows === before.renewal_windows && after.counseling_availability === before.counseling_availability
  && after.push_subscriptions === before.push_subscriptions && after.renewal_study_plan_forms === before.renewal_study_plan_forms
  && (await q("select count(*)::int n from renewal_windows where testers is not null"))[0].n === before.renewal_windows);
check("the bookings, referrals and Daily Records of the test applications are gone; nothing is left hanging on a renewal", (await q("select (select count(*)::int from counseling_slots where record_id is not null) a, (select count(*)::int from scholar_counseling_referrals where renewal_record_id is not null) b, (select count(*)::int from scholar_counseling_records where renewal_record_id is not null) c"))
  .every(r => r.a === 0 && r.b === 0 && r.c === 0) && after.scholar_counseling_referrals === before.scholar_counseling_referrals - linked.refs && after.scholar_counseling_records === before.scholar_counseling_records - linked.recs
  && after.counseling_slots === before.counseling_slots - linked.deleted_slots && after.counseling_availability === before.counseling_availability);

const backup = await q("select table_name, count(*)::int n from public._renewal_test_backup group by 1");
const inBackup = Object.fromEntries(backup.map(b => [b.table_name, b.n]));
check("every removed row was copied to the holding table first", inBackup.renewal_records === before.renewal_records && inBackup.scholar_notifications === before.scholar_notifications - 1 && inBackup.csr_issued === csrBefore
  && inBackup.renewal_notice_log === before.renewal_notice_log && inBackup.push_outbox === before.push_outbox && inBackup.renewal_export_log === before.renewal_export_log && inBackup.notifications === 1, JSON.stringify(inBackup));
check("the bookings, referrals and Daily Records were copied to the holding table first too", inBackup.counseling_slots === linked.slots && inBackup.scholar_counseling_referrals === linked.refs && inBackup.scholar_counseling_records === linked.recs, JSON.stringify(inBackup));

check("the copy is complete enough to put a row back (an application with its Scholar ID and stage)", (await q("select row_data ->> 'scholar_id_number' s, row_data ->> 'stage' st from public._renewal_test_backup where table_name = 'renewal_records' limit 1"))[0].s?.startsWith("TEST-"));
check("the holding table is locked: signed-in people and visitors cannot read it", await (async () => {
  for (const role of ["authenticated", "anon"]) {
    try { await db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query("select count(*) from public._renewal_test_backup"); }); return false; } catch { /* refused, as it should be */ }
  }
  return true;
})());
const again = await run(REAL);
check("running it a second time is harmless: nothing left to remove, nothing new copied", Number(find(again, "applications").rows) === 0 && (await q("select count(*)::int n from public._renewal_test_backup"))[0].n === backup.reduce((a, b) => a + b.n, 0));
await db.exec(fs.readFileSync("sql_oneoff/renewal_test_data_drop_backup.sql", "utf8"));
check("the second file drops the holding table", (await q("select to_regclass('public._renewal_test_backup') t"))[0].t === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
