// tests/renewal/db/run_p7_tests.mjs — Phase 7 database checks: the dashboard numbers (checked against the raw tables), the export rows, the export log,
// and who may read them.
//
// Same setup as the earlier suites: every real migration file in memory + the demo's TEST data, run as signed-in people with the real
// `authenticated` role.  Run:  node tests/renewal/db/run_p7_tests.mjs
import { buildDb } from "../../../localdemo/build.mjs";
import { seedDb, seedId } from "../../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };

const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const scholarUid = n => seedId(`scholar:${n}`);
const staffUid = name => seedId(`staff:${name}`);
const EVAL = staffUid("demo.evaluator"), COUNSELOR = staffUid("demo.counselor"), SEAD = staffUid("demo.sead"), DH = staffUid("demo.divhead"), ADMIN = staffUid("demo.admin"), SEADHEAD = staffUid("demo.seadhead");
const SY = "2026-2027", TERM = "1st Semester";

async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify({ sub: uid, role })]);
    return fn(tx);
  });
}
const rpc = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const fails = async (uid, sql, params, pattern, role) => { try { await (role ? as(uid, async tx => (await tx.query(sql, params)).rows, role) : rpc(uid, sql, params)); return false; } catch (e) { return pattern ? pattern.test(String(e.message)) : true; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const finalize = async rec => { const f = (await q("select id, referred_to from scholar_counseling_referrals where renewal_record_id = $1 and status = 'division_head_approved'", [rec]))[0]; if (f) await rpc(f.referred_to, "select public.consult_finalize_decision($1)", [f.id]); };   // the consulting staff member makes the final decision after the Division Head signs
const dash = async (uid = EVAL, sy = SY, term = TERM) => (await rpc(uid, "select public.renewal_dashboard($1, $2) d", [sy, term]))[0].d;
const count = async (sql, params = []) => Number((await q(sql, params))[0].n);

console.log("\nWho can read the reports");
check("the heads of SEAD (a SEAD division admin) and a super admin can read the dashboard and export, without any renewal tag", (await dash(SEADHEAD)).totals.applied > 10 && (await dash(ADMIN)).totals.applied > 10
  && (await q("select 1 from staff_account_tags where staff_id = $1", [SEADHEAD])).length === 0 && (await rpc(SEADHEAD, "select public.renewal_export_data($1, $2) e", [SY, TERM]))[0].e.applications.length > 10);
check("a division admin of ANOTHER division cannot", await (async () => {
  await q("update users set division = 'LITM' where id = $1", [SEADHEAD]);
  const refused = await fails(SEADHEAD, "select public.renewal_dashboard($1, $2)", [SY, TERM], /Not authorized/);
  await q("update users set division = 'SEAD' where id = $1", [SEADHEAD]);
  return refused;
})());
check("the evaluator, the consultation staff and the Division Head can", (await dash(EVAL)).term_label === "1st Semester 2026-2027" && (await dash(COUNSELOR)).totals !== undefined && (await dash(DH)).totals !== undefined);
check("scholars, ordinary SEAD staff and visitors cannot (dashboard or export)", await fails(scholarUid(1), "select public.renewal_dashboard($1, $2)", [SY, TERM], /Not authorized/) && await fails(SEAD, "select public.renewal_dashboard($1, $2)", [SY, TERM], /Not authorized/)
  && await fails(scholarUid(1), "select public.renewal_export_data($1, $2)", [SY, TERM], /Not authorized/) && await fails(SEAD, "select public.renewal_export_data($1, $2)", [SY, TERM], /Not authorized/)
  && await fails(null, "select public.renewal_dashboard($1, $2)", [SY, TERM], undefined, "anon") && await fails(null, "select public.renewal_export_data($1, $2)", [SY, TERM], undefined, "anon"));

console.log("\nThe dashboard numbers match the raw tables");
const d = await dash();
const recs = await q("select * from renewal_records where school_year = $1 and term = $2", [SY, TERM]);
const applied = recs.filter(r => r.stage !== "not_required");
const notApplied = await count("select count(*) n from scholars s where s.status not in ('Removed','On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $1 and r.term = $2)", [SY, TERM]);
check("applied, not applied, can renew", d.totals.applied === applied.length && d.totals.not_applied === notApplied && d.totals.can_renew === applied.length + notApplied && applied.length > 10 && notApplied > 5);
check("the same 'not applied' number the evaluator's Not applied list shows", (await rpc(EVAL, "select * from public.renewal_not_applied($1, $2)", [SY, TERM])).length === d.totals.not_applied);
check("by stage adds up to every record, and each stage's number is right", Object.values(d.by_stage).reduce((a, b) => a + Number(b), 0) === recs.length && Object.entries(d.by_stage).every(([st, n]) => recs.filter(r => r.stage === st).length === Number(n)));
check("by rule adds up to the records that have a rule; by school adds up to everyone", Object.values(d.by_rule).reduce((a, b) => a + Number(b), 0) === applied.filter(r => r.rule_code).length
  && d.by_school.reduce((a, s) => a + Number(s.applied) + Number(s.not_applied), 0) === d.totals.can_renew && d.by_school.length >= 3);
check("by school: each school's applied / renewed / pending / not applied are right (lower-is-better school)", await (async () => {
  const lower = d.by_school.find(s => /Lower-Is-Better/.test(s.school));
  const rows = await q("select r.stage from renewal_records r join scholars s on s.scholar_id_number = r.scholar_id_number where s.school like '%Lower-Is-Better%' and r.school_year = $1 and r.term = $2 and r.stage <> 'not_required'", [SY, TERM]);
  const na = await count("select count(*) n from scholars s where s.school like '%Lower-Is-Better%' and s.status not in ('Removed','On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $1 and r.term = $2)", [SY, TERM]);
  return Number(lower.applied) === rows.length && Number(lower.not_applied) === na && Number(lower.renewed) === rows.filter(r => r.stage === "renewed").length
    && Number(lower.pending) === rows.filter(r => !["renewed", "removed", "late_declined"].includes(r.stage)).length;
})());
check("the window: dates, days left, open", d.window && d.window.is_open === true && d.window.days_left >= 0);
check("INC numbers match the INC items of the term", await (async () => {
  const items = await q("select i.* from renewal_inc_items i join renewal_records r on r.id = i.record_id where r.school_year = $1 and r.term = $2", [SY, TERM]);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const open = items.filter(i => i.state === "open");
  const ds = i => (i.deadline instanceof Date ? i.deadline.toISOString() : String(i.deadline)).slice(0, 10);
  return d.inc.open === open.length && d.inc.no_deadline === open.filter(i => !i.deadline).length && d.inc.overdue === open.filter(i => i.deadline && ds(i) < today).length && open.length >= 3;
})());
check("consultation numbers match the slots", d.consultations.booked_upcoming === await count("select count(*) n from counseling_slots x join renewal_records r on r.id = x.record_id where x.state = 'booked' and x.starts_at > now() and r.school_year = $1 and r.term = $2", [SY, TERM])
  && d.consultations.required === applied.filter(r => r.consultation_required && !["late_declined"].includes(r.stage)).length && d.consultations.done === recs.filter(r => r.consultation_done_at).length);
check("documents waiting for review, and the Division Head's queue", d.documents.waiting_review === await count("select count(*) n from renewal_documents d join renewal_records r on r.id = d.record_id where d.status = 'submitted' and d.kind in ('study_plan','inc_letter') and r.school_year = $1 and r.term = $2", [SY, TERM])
  && d.division_head.waiting === 2 && d.division_head.reconsidered === 1);
check("applications per day: today's count is right", (() => { const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); const t = d.per_day.find(x => x.day === today); return !!t && t.applied === applied.filter(r => r.applied_at && new Date(new Date(r.applied_at).getTime() + 8 * 3600000).toISOString().slice(0, 10) === today).length; })());

console.log("\nThe numbers move when the work moves");
const before = await dash();
const recDh = (await q("select id from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(43), SY, TERM]))[0].id;
await rpc(DH, "select public.renewal_division_head_decide($1, 'approve_probationary', 'sig.png', '')", [recDh]);
await finalize(recDh);
const mid = await dash();
check("a Division Head approval: one less waiting, one more approved; not Renewed yet", mid.division_head.waiting === before.division_head.waiting - 1 && mid.division_head.approved_probationary === before.division_head.approved_probationary + 1 && mid.totals.renewed === before.totals.renewed);
await rpc(EVAL, "select public.renewal_confirm_decision($1, 'ok')", [recDh]);
const after = await dash();
check("the evaluator's confirmation: Renewed + 1, split by result (probationary), and an average days-to-renew appears", after.totals.renewed === before.totals.renewed + 1 && after.totals.renewed_probationary === before.totals.renewed_probationary + 1 && after.totals.avg_days_to_renew !== null);
check("Removed counts too", await (async () => {
  const rec41 = (await q("select id from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(41), SY, TERM]))[0].id;
  await rpc(DH, "select public.renewal_division_head_decide($1, 'removed', 'sig.png', '')", [rec41]);
  await finalize(rec41);
  const x = await dash();
  return x.totals.removed === after.totals.removed + 1 && x.division_head.removed === after.division_head.removed + 1;
})());
check("a term with no records and no window gives zeros and no error", await (async () => {
  const z = await dash(EVAL, "2030-2031", "Summer");
  return z.window === null && z.totals.applied === 0 && z.totals.not_applied > 0 && z.by_school.every(s => Number(s.applied) === 0) && Object.keys(z.by_stage).length === 0;
})());

console.log("\nThe export rows and the export log");
await q("delete from renewal_export_log");      // count from here (the access checks above exported too)
const ex = (await rpc(EVAL, "select public.renewal_export_data($1, $2) e", [SY, TERM]))[0].e;
const nowRecs = await q("select * from renewal_records where school_year = $1 and term = $2", [SY, TERM]);
check("one row per application and one per scholar who has not applied", ex.applications.length === nowRecs.length && ex.not_applied.length === (await dash()).totals.not_applied);
const a41 = ex.applications.find(r => r.scholar_id_number === num(41)), a45 = ex.applications.find(r => r.scholar_id_number === num(45));
check("a row carries the case: stage, rule, failed subjects, consultation, Division Head decision, result", a41.stage === "removed" && a41.rule_code === "C2" && a41.failed_count === 2 && a41.division_head_decision === "removed" && a41.consultation_done_at
  && a45.stage === "reconsidered" && a45.division_head_decision === "reconsidered" && a45.scholar_status === "Reconsidered");
check("documents, SDP, basis semester and notes are in the row", await (async () => {
  const r39 = ex.applications.find(r => r.scholar_id_number === num(39));
  const r10 = ex.applications.find(r => r.scholar_id_number === num(10));
  return r39 && r39.study_plan === "submitted" && /2nd Semester 2025-2026/.test(r39.basis) && (r10 ? r10.sdp_complied === false : true);
})());
check("INC and consultation lists are filled", ex.inc.length >= 3 && ex.inc.every(i => i.subject && i.state) && ex.consultations.length >= 3 && ex.consultations.every(c => c.staff && c.starts_at));
check("no secrets in an export row (only the listed fields)", await (async () => {
  const allowed = new Set(["scholar_id_number", "name", "school", "program", "year_level", "scholar_status", "stage", "rule_code", "basis", "failed_count", "inc_open", "previous_probation", "sdp_applicable", "sdp_complied", "sdp_missing", "study_plan", "inc_letter", "prospectus", "consultation_required", "consultation_done_at", "next_consultation", "no_shows", "late", "late_decision", "division_head_decision", "division_head_decided_at", "result", "applied_at", "confirmed_at", "evaluator_note", "scholar_note", "not_required_reason"]);
  return ex.applications.every(r => Object.keys(r).every(k => allowed.has(k)));
})());
const log = await q("select * from renewal_export_log order by at desc");
check("the export was logged: who, which term, how many rows", log.length === 1 && log[0].exported_by === EVAL && log[0].school_year === SY && log[0].term === TERM && log[0].row_count === ex.applications.length + ex.not_applied.length && /Renewal Evaluator/.test(log[0].by_label));
await rpc(DH, "select public.renewal_export_data($1, $2)", [SY, TERM]);
check("every export is logged (the Division Head's too); the evaluator can read the log, the counselor and scholars cannot", (await q("select count(*)::int n from renewal_export_log"))[0].n === 2
  && (await as(EVAL, async tx => (await tx.query("select count(*)::int n from public.renewal_export_log")).rows[0].n)) === 2
  && (await as(COUNSELOR, async tx => (await tx.query("select count(*)::int n from public.renewal_export_log")).rows[0].n)) === 0
  && (await as(scholarUid(1), async tx => (await tx.query("select count(*)::int n from public.renewal_export_log")).rows[0].n)) === 0);
check("the log cannot be changed by signed-in users", await (async () => { try { await rpc(EVAL, "delete from public.renewal_export_log"); } catch { /* refused */ } try { await rpc(EVAL, "update public.renewal_export_log set row_count = 0"); } catch { /* refused */ } return (await q("select count(*)::int n from renewal_export_log where row_count > 0"))[0].n === 2; })());

console.log("\nFiltering before the export");
const opts = (await dash()).filter_options;
check("the dashboard lists what can be filtered (schools, year levels, programs)", opts.schools.length >= 4 && opts.schools.every(x => typeof x === "string") && opts.year_levels.includes("2nd Year") && opts.programs.includes("BS Test Studies"));
const lowerName = opts.schools.find(x => /Lower-Is-Better/.test(x)), higherName = opts.schools.find(x => /Higher-Is-Better/.test(x));
const exLower = (await rpc(EVAL, "select public.renewal_export_data($1, $2, $3::text[]) e", [SY, TERM, [lowerName]]))[0].e;
const lowerApplied = await count("select count(*) n from renewal_records r join scholars s on s.scholar_id_number = r.scholar_id_number where r.school_year = $1 and r.term = $2 and s.school = $3", [SY, TERM, lowerName]);
check("one school only: just its applications, its scholars who have not applied, its INC and consultations", exLower.applications.length === lowerApplied && exLower.applications.every(r => r.school === lowerName) && exLower.not_applied.every(r => r.school === lowerName)
  && exLower.inc.every(r => r.school === lowerName) && exLower.consultations.length > 0 && exLower.filter === `School: ${lowerName}`);
const exHigher = (await rpc(EVAL, "select public.renewal_export_data($1, $2, $3::text[]) e", [SY, TERM, [higherName]]))[0].e;
check("another school: nobody of the first school is in it", exHigher.applications.every(r => r.school === higherName) && exHigher.not_applied.length >= 2 && exHigher.inc.length === 0 && exHigher.consultations.length === 0);
const exStage = (await rpc(EVAL, "select public.renewal_export_data($1, $2, null, null, null, $3::text[]) e", [SY, TERM, ["renewed", "removed"]]))[0].e;
check("by status: only records in those stages, and nobody who has not applied", exStage.applications.length > 0 && exStage.applications.every(r => ["renewed", "removed"].includes(r.stage)) && exStage.not_applied.length === 0);
const exNa = (await rpc(EVAL, "select public.renewal_export_data($1, $2, null, null, null, $3::text[]) e", [SY, TERM, ["not_applied"]]))[0].e;
check("'not_applied' as the status gives only the scholars who have not applied", exNa.applications.length === 0 && exNa.not_applied.length === (await dash()).totals.not_applied);
const exYear = (await rpc(EVAL, "select public.renewal_export_data($1, $2, null, $3::text[], $4::text[]) e", [SY, TERM, ["2nd Year"], ["BS Test Studies"]]))[0].e;
check("year level and program filters work together; an empty list means everything", exYear.applications.every(r => r.year_level === "2nd Year" && r.program === "BS Test Studies") && (await rpc(EVAL, "select public.renewal_export_data($1, $2, '{}'::text[]) e", [SY, TERM]))[0].e.applications.length === (await q("select count(*)::int n from renewal_records where school_year = $1 and term = $2", [SY, TERM]))[0].n);
check("a filter that matches nobody gives empty lists, not an error", (await rpc(EVAL, "select public.renewal_export_data($1, $2, $3::text[]) e", [SY, TERM, ["No such school"]]))[0].e.applications.length === 0);
const flog = await q("select * from renewal_export_log where filter_text <> '' order by at desc limit 1");
check("the export log says which filter was used and how many rows left the database", flog.length === 1 && flog[0].filter_text === "School: No such school" && flog[0].row_count === 0
  && (await q("select 1 from renewal_export_log where filter_text like $1 and row_count = $2", [`School: ${lowerName}`, exLower.applications.length + exLower.not_applied.length])).length === 1);

console.log("\nSafety");
check("the migration can be run twice", await (async () => { try { await db.exec(fs.readFileSync(new URL("../../../supabase_migration_renewal_p7_reports.sql", import.meta.url), "utf8")); return true; } catch (e) { console.log("   ", e.message); return false; } })());

console.log(`\n${failed === 0 ? "ALL PHASE 7 DATABASE CHECKS PASSED" : "SOME CHECKS FAILED"} — ${passed} passed, ${failed} failed`);
await db.close();
process.exit(failed === 0 ? 0 : 1);
