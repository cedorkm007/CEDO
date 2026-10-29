// tests/renewal-actions/db_tests.mjs — Scholar List: "Action needed" and "Renewal status" columns
//   (supabase_migration_renewal_actions_needed.sql, after the Scholar List, SDP reconsideration and entered grades files)
// Run:  node tests/renewal-actions/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_actions_needed.sql", UNDO = "undo_renewal_actions_needed.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const PLAIN = seedId("staff:demo.plain"), ITADMIN = seedId("staff:it.admin1"), EVALUATOR = seedId("staff:demo.evaluator"), DIVHEAD = seedId("staff:demo.divhead"), MONITOR = seedId("staff:demo.monitor");
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null where id = $1", [win.id]);
await q("update renewal_windows set school_ids = null where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);

console.log("Before the file");
const before = await attempt(PLAIN, "select * from public.renewal_scholar_actions($1, $2, array['x'])", [Y, T]);
check("the new function does not exist yet", !before.ok);

await db.exec(read(FILE));
await db.exec(read(FILE));      // safe to run twice
const hasFn = async n => (await q("select count(*)::int c from pg_proc where proname = $1", [n]))[0].c > 0;
check("the file adds the new function and the new check", (await hasFn("renewal_scholar_actions")) && (await hasFn("can_view_renewal_list")));

console.log("Who can read the list");
const pickFree = async n => (await q("select s.scholar_id_number s from scholars s where s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit $1", [n, Y, T])).map(r => r.s);
const free = await pickFree(8);
const [N1, N2, A1, A2, A3, A4, A5, A6] = free;
// the list needs saved results: the evaluator checks everybody once
await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, null, 300)", [Y, T]);
const list = who => attempt(who, "select * from public.renewal_scholar_list($1, $2, null, null, null, null, null, 5, 0)", [Y, T]);
const matrix = who => attempt(who, "select * from public.renewal_scholar_list_matrix($1, $2)", [Y, T]);
const options = who => attempt(who, "select public.renewal_scholar_list_options($1, $2) o", [Y, T]);
const credits = who => attempt(who, "select public.renewal_scholar_sdp_credits($1, $2, $3) c", [N1, Y, T]);
const acts = (who, ids) => attempt(who, "select * from public.renewal_scholar_actions($1, $2, $3::text[])", [Y, T, ids]);
for (const [label, fn] of [["the list", list], ["the count table", matrix], ["the filter values", options], ["the SDP credits view", credits], ["the action facts", ids => acts(PLAIN, [N1])]]) {
  const r = await (label === "the action facts" ? acts(PLAIN, [N1]) : fn(PLAIN));
  check(`a staff member with no tag cannot read ${label}`, !r.ok && /Not authorized/.test(r.msg), r.msg);
}
const scholarTry = await attempt(uidOf(N1), "select * from public.renewal_scholar_actions($1, $2, array[$3])", [Y, T, N1]);
check("a scholar cannot read the action facts", !scholarTry.ok, scholarTry.msg);

await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_grades_approver') on conflict do nothing", [PLAIN]);
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_reconsideration_approver') on conflict do nothing", [MONITOR]);
for (const [who, name] of [[PLAIN, "the Grades Approver"], [MONITOR, "the SDP Reconsideration Approver"], [EVALUATOR, "the evaluator"], [DIVHEAD, "the Division Head"], [ITADMIN, "it.admin1"]]) {
  const ok = (await list(who)).ok && (await matrix(who)).ok && (await options(who)).ok && (await credits(who)).ok && (await acts(who, [N1])).ok;
  check(`${name} can read the list, the count table, the filter values, the SDP credits and the action facts`, ok);
}
const lst = await list(PLAIN);
check("the Grades Approver sees the same list the evaluator sees", lst.ok && lst.rows.length === 5 && JSON.stringify(lst.rows.map(r => r.scholar_id_number)) === JSON.stringify((await list(EVALUATOR)).rows.map(r => r.scholar_id_number)));
const refresh = await attempt(PLAIN, "select * from public.renewal_scholar_list_refresh($1, $2, null, 10)", [Y, T]);
check("refreshing the check stays with the evaluator", !refresh.ok && /Only the Scholar Renewal Evaluator/.test(refresh.msg), refresh.msg);

console.log("Where each scholar stands");
const insRec = (s, stage, extra = {}) => q("insert into renewal_records (scholar_id_number, school_year, term, window_id, stage, applied_at, is_late, consultation_required, consultation_done_at) values ($1, $2, $3, $4, $5, now(), $6, $7, $8) returning id",
  [s, Y, T, win.id, stage, extra.late ?? false, extra.consult ?? false, extra.done ?? null]).then(r => r[0].id);
const pending = (s, rec) => q("insert into renewal_self_grade_submissions (record_id, scholar_id_number, school_year, term, basis_school_year, basis_term, version, status, acknowledged_at) values ($1, $2, $3, $4, $5, $6, 1, 'pending', now())", [rec, s, Y, T, basis.basis_school_year, basis.basis_term]);

// no school has uploaded its grades for the semester the renewal looks at, except the school of A1 (so the five answers can be told apart)
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
const PERIOD = (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
await q("delete from school_period_submissions where period_id = $1", [PERIOD]);
await q("update scholars set school_id = (select id from schools order by name limit 1) where scholar_id_number in ($1, $2, $3, $4, $5)", [N1, A2, A3, A4, A5]);
await q("update scholars set school_id = (select id from schools order by name desc limit 1) where scholar_id_number = $1", [A1]);
await q("insert into school_period_submissions (school_id, period_id, status, submitted_at) select school_id, $2, 'submitted', now() from scholars where scholar_id_number = $1", [A1, PERIOD]);
// N1: has not applied; N2: has not applied and was referred for a consultation
await q("insert into scholar_counseling_referrals (scholar_id_number, referred_by, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, status) values ($1, $2, 'Regular', '[]', '[]', 'Renewal', 'awaiting_booking')", [N2, EVALUATOR]).catch(async () =>
  q("insert into scholar_counseling_referrals (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, status) values ($1, $2, $3, 'Regular', '[]', '[]', 'Renewal', 'pending')", [N2, EVALUATOR, EVALUATOR]));
// A1: applied, ready to confirm; A2: applied with entered grades waiting; A3: with the Division Head; A4: has two documents waiting; A5: booked a consultation; A6: late
const r1 = await insRec(A1, "ready_for_confirmation");
const r2 = await insRec(A2, "waiting_grades"); await pending(A2, r2);
const r3 = await insRec(A3, "needs_consultation_division_head", { consult: true });
await q("insert into scholar_counseling_referrals (scholar_id_number, referred_by, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, status, renewal_record_id) values ($1, $2, 'Regular', '[]', '[]', 'Removal', 'forwarded_to_division_head', $3)", [A3, EVALUATOR, r3]);
const r4 = await insRec(A4, "needs_study_plan_consultation", { consult: true });
await q("set session_replication_role = replica");      // the documents rule (a document must be needed) is not what is tested here
for (const k of ["study_plan", "inc_letter"]) await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type) values ($1, $2, $3, $4, 'f.pdf', 'application/pdf')", [r4, A4, k, `${A4}/${r4}/${k}/f.pdf`]);
await q("set session_replication_role = origin");
const r5 = await insRec(A5, "needs_study_plan_consultation", { consult: true });
const r6 = await insRec(A6, "late_pending", { late: true });

const ids = [N1, N2, A1, A2, A3, A4, A5, A6];
const facts = await acts(EVALUATOR, ids);
const by = s => facts.rows?.find(r => r.scholar_id_number === s);
check("one row for each scholar asked about", facts.ok && facts.rows.length === ids.length, facts.msg);
check("a scholar who has not applied has no application, no documents, no booking", by(N1)?.record_id === null && by(N1)?.stage === null && by(N1)?.docs_to_review === 0 && by(N1)?.next_consultation === null && by(N1)?.is_late === false);
check("a scholar with no grades entered or uploaded shows 'none'", by(N1)?.grades_status === "none");
check("the open consultation referral of a scholar who has not applied is reported", by(N2)?.referral_status != null && by(N2)?.record_id === null, JSON.stringify(by(N2)));
check("grades the school uploaded show 'school'", by(A1)?.grades_status === 'school');
check("an application shows its stage and its record", by(A1)?.record_id === r1 && by(A1)?.stage === "ready_for_confirmation");
check("entered grades waiting for approval show 'pending'", by(A2)?.grades_status === "pending");
check("a case with the Division Head shows the referral and its status", by(A3)?.dh_status === "forwarded_to_division_head" && by(A3)?.dh_referral_id != null && by(A3)?.consultation_required === true);
check("an application with no Division Head referral has none", by(A1)?.dh_referral_id === null && by(A1)?.dh_status === null);
check("documents waiting for review are counted", by(A4)?.docs_to_review === 2);
check("a late application is marked late", by(A6)?.is_late === true && by(A6)?.stage === "late_pending");

// a booked consultation and a done one
const slot = (await q("select id from counseling_slots where state = 'open' order by starts_at limit 1"))[0];
if (slot) {
  await q("update counseling_slots set state = 'booked', record_id = $1 where id = $2", [r5, slot.id]).catch(() => {});
  const f5 = (await acts(EVALUATOR, [A5])).rows[0];
  check("a booked consultation shows its time", f5?.next_consultation != null);
} else check("a booked consultation shows its time (no open slot in the demo: skipped)", true);
await q("update renewal_records set consultation_done_at = now() where id = $1", [r3]);
check("a consultation that took place shows when", (await acts(EVALUATOR, [A3])).rows[0]?.consultation_done_at != null);

check("the Grades Approver and the SDP approver get the same facts as the evaluator", JSON.stringify((await acts(PLAIN, ids)).rows) === JSON.stringify((await acts(MONITOR, ids)).rows));
check("an empty list of scholars gives nothing", (await acts(EVALUATOR, [])).rows.length === 0);
check("scholars that do not exist give nothing", (await acts(EVALUATOR, ["NO-SUCH-1"])).rows.length === 0);
check("the action facts change nothing (no record, no notice was added)", (await q("select count(*)::int n from renewal_records where school_year = $1 and term = $2", [Y, T]))[0].n >= 6);

console.log("The undo");
await db.exec(read(UNDO));
check("after the undo the new function and check are gone", !(await hasFn("renewal_scholar_actions")) && !(await hasFn("can_view_renewal_list")));
const afterG = await list(PLAIN);
check("after the undo the Grades Approver can no longer read the list, the evaluator still can", !afterG.ok && (await list(EVALUATOR)).ok && (await matrix(EVALUATOR)).ok && (await options(EVALUATOR)).ok && (await credits(EVALUATOR)).ok);
check("after the undo the SDP approver can no longer read the count table", !(await matrix(MONITOR)).ok);
await db.exec(read(FILE));
check("the file can be put on again after the undo", (await acts(PLAIN, [N1])).ok && (await list(PLAIN)).ok);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
