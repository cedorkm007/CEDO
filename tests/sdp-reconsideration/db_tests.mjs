// tests/sdp-reconsideration/db_tests.mjs — SDP reconsideration with the renewal application (supabase_migration_sdp_reconsideration_a / b / c)
// Run:  node tests/sdp-reconsideration/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILES = ["supabase_migration_sdp_reconsideration_a_tables.sql", "supabase_migration_sdp_reconsideration_b_sdp_rules.sql", "supabase_migration_sdp_reconsideration_c_renewal.sql", "supabase_migration_sdp_reconsideration_d_lists.sql"];
const UNDOS = ["undo_sdp_reconsideration_d.sql", "undo_sdp_reconsideration_c.sql", "undo_sdp_reconsideration_b.sql", "undo_sdp_reconsideration_a.sql"];
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

const EVALUATOR = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), PLAIN = seedId("staff:demo.plain"), ITADMIN = seedId("staff:it.admin1"), SEAD = seedId("staff:demo.sead");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null where id = $1", [win.id]).catch(async () => q("update renewal_windows set testers = null where id = $1", [win.id]));
await q("update renewal_windows set opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]);
const Y = win.school_year, T = win.term;

// ── before the files: the answers every screen gets today, to compare with afterwards ──
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const snapshot = async () => JSON.stringify((await q("select scholar_id_number s, community_service a, community_volunteerism b, formation_program c, applicable ap, complied co, missing m from public._sdp_compliance($1, $2) order by 1", [basis.basis_school_year, basis.basis_term])));
const before = await snapshot();
const totalsBefore = JSON.stringify(await q("select scholar_id_number s, category c, total t from public._sdp_period_totals($1, $2) order by 1, 2", [basis.basis_school_year, basis.basis_term]));

for (const f of FILES) await db.exec(read(f));
for (const f of FILES) await db.exec(read(f));     // twice: safe

console.log("\nThe SDP counting rules (file B)");
check("the files run twice without a problem, and nobody who has no reconsideration sees a different answer (compliance and totals are the same as before)", (await snapshot()) === before
  && JSON.stringify(await q("select scholar_id_number s, category c, total t from public._sdp_period_totals($1, $2) order by 1, 2", [basis.basis_school_year, basis.basis_term])) === totalsBefore);
check("the semester after: 1st -> 2nd of the same year; 2nd -> 1st of the next year", JSON.stringify(await q("select * from public._sdp_next_semester('2026-2027','1st Semester') union all select * from public._sdp_next_semester('2026-2027','2nd Semester')"))
  === JSON.stringify([{ school_year: "2026-2027", semester: "2nd Semester" }, { school_year: "2027-2028", semester: "1st Semester" }]));

// a scholar who is fully complied in a made-up school year, and a debt for the semester after
const Z = "TEST-0041", ZY = "2031-2032";
const acts = {};
for (const [cat, cr] of [["community_service", 1], ["community_volunteerism", 1], ["formation_program", 1]]) {
  acts[cat] = (await q("insert into sdp_activities(category, credits, all_year_levels) values ($1, $2, true) returning id", [cat, cr]))[0].id;
}
const credit = (cat, sem, occ, n = 1) => q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) select $1, $2, current_date, g, $3, $4 from generate_series($5::int, $6::int) g", [acts[cat], Z, ZY, sem, occ, occ + n - 1]);
await credit("community_service", "1st Semester", 1, 5); await credit("community_volunteerism", "1st Semester", 1, 3); await credit("formation_program", "1st Semester", 1, 3);
const comp1 = async sem => (await q("select * from public._sdp_compliance($1, $2, $3)", [ZY, sem, Z]))[0];
check("a scholar with 5 / 3 / 3 credits in the 1st Semester is complied, and 2 Institutional Volunteerism credits carry on to the 2nd Semester", (await comp1("1st Semester")).complied === true
  && Number((await q("select total from public._sdp_period_totals($1, '2nd Semester', $2) where category = 'community_service'", [ZY, Z]))[0]?.total) === 2);
// an approved request of the 1st Semester with 2 owed for the 1st Semester itself is not the point here: owe 2 for the 1st Semester (as if approved in the semester before)
const mkReq = async (scholar, y, t, by, bt, status) => (await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term, status, lacking) values ($1, $2, $3, $4, $5, $6, '{}'::jsonb) returning id", [scholar, y, t, by, bt, status]))[0].id;
const rq0 = await mkReq(Z, "2031-2032", "1st Semester", "2030-2031", "2nd Semester", "approved");
await q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, 'community_service', 2, $3, '1st Semester')", [rq0, Z, ZY]);
const c1 = await comp1("1st Semester");
check("with 2 credits owed for that semester, the requirement is 3 + 2: 5 of 5 is still complied, and the missing text would say 'of 5'", c1.complied === true);
await q("update sdp_reconsideration_debts set amount = 3 where request_id = $1", [rq0]);
const c2 = await comp1("1st Semester");
check("owing 3 makes the requirement 6: 5 credits is NOT complied and the text says 'Institutional Volunteerism: 5 of 6'", c2.complied === false && /Institutional Volunteerism: 5 of 6/.test(c2.missing), c2.missing);
await q("update sdp_reconsideration_debts set amount = 2 where request_id = $1", [rq0]);
check("credit used to pay what is owed is NOT carried on: 5 credits with 2 owed carries 0 (not 2) to the next semester",
  (await q("select total from public._sdp_period_totals($1, '2nd Semester', $2) where category = 'community_service'", [ZY, Z])).length === 0
  && (await q("select total from public._sdp_period_totals_ids($1, '2nd Semester', array[$2]) where category = 'community_service'", [ZY, Z])).length === 0);
check("the list versions and the saved-totals version give the same answer as the single scholar's", await (async () => {
  await q("select public._sdp_saved_totals_ensure($1, '1st Semester')", [ZY]);
  const a = (await q("select complied, missing from public._sdp_compliance($1, '1st Semester', $2)", [ZY, Z]))[0], b = (await q("select complied, missing from public._sdp_compliance_ids($1, '1st Semester', array[$2])", [ZY, Z]))[0],
    c = (await q("select complied, missing from public._sdp_compliance_saved($1, '1st Semester') where scholar_id_number = $2", [ZY, Z]))[0];
  return JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c);
})());
await q("update sdp_reconsideration_requests set status = 'pending' where id = $1", [rq0]);
check("an approval counts for the semester it was about: a scholar lacking credits is complied once approved, not before", await (async () => {
  const lackSem = (await q("select * from public._sdp_compliance('2030-2031', '2nd Semester', $1)", [Z]))[0];
  const rq = await mkReq(Z, "2031-2032", "2nd Semester", "2030-2031", "2nd Semester", "pending");
  const pendingNo = (await q("select complied from public._sdp_compliance('2030-2031', '2nd Semester', $1)", [Z]))[0].complied === false;
  await q("update sdp_reconsideration_requests set status = 'approved' where id = $1", [rq]);
  const approvedYes = (await q("select complied from public._sdp_compliance('2030-2031', '2nd Semester', $1)", [Z]))[0].complied === true;
  await q("delete from sdp_reconsideration_requests where id = $1", [rq]);
  return lackSem.complied === false && pendingNo && approvedYes;
})());
const fp1 = (await q("select public._sdp_data_fingerprint() f"))[0].f;
await q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, 'formation_program', 1, $3, '2nd Semester')", [rq0, Z, ZY]);
check("the saved-totals fingerprint changes when credits are owed (so saved totals are worked out again)", (await q("select public._sdp_data_fingerprint() f"))[0].f !== fp1);
await q("delete from sdp_reconsideration_debts where request_id = $1", [rq0]); await q("delete from sdp_reconsideration_requests where id = $1", [rq0]);
await q("delete from sdp_attendance where scholar_id_number = $1 and school_year = $2", [Z, ZY]);

console.log("\nThe scholar's own requirement (file B)");
await q("update grading_period_settings set current_school_year = $1, current_semester = $2 where id = true", [ZY, "1st Semester"]);
const rqS = await mkReq(Z, ZY, "1st Semester", "2030-2031", "2nd Semester", "approved");
await q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, 'formation_program', 2, $3, '1st Semester')", [rqS, Z, ZY]);
const req = Object.fromEntries((await rows(uidOf(Z), "select * from public.fetch_scholar_sdp_requirements()")).map(r => [r.category, Number(r.required)]));
check("the scholar's SDP tab asks for 3, 3 and 3 + 2 = 5 for the current semester", req.community_service === 3 && req.community_volunteerism === 3 && req.formation_program === 5, JSON.stringify(req));
check("a staff account (not a scholar) cannot call it", !(await attempt(EVALUATOR, "select * from public.fetch_scholar_sdp_requirements()")).ok && !(await attempt(null, "select * from public.fetch_scholar_sdp_requirements()", [], "anon")).ok);
await q("delete from sdp_reconsideration_requests where id = $1", [rqS]);

console.log("\nApplying with the choice (file C)");
const evalOf = async s => (await q("select public._renewal_evaluate($1, $2, $3) e", [s, Y, T]))[0].e;
const cand = (await q("select s.scholar_id_number s from scholars s where s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $1 and r.term = $2) order by 1", [Y, T])).map(r => r.s);
const lacking = [], fine = [];
for (const s of cand) { const e = await evalOf(s); if (e.sdp?.applicable && e.sdp.complied === false) lacking.push([s, e]); else if (e.sdp?.complied === true) fine.push(s); }
check("the demo has scholars who lack SDP credits and have not applied, and some who are complied", lacking.length >= 3 && fine.length >= 1, `${lacking.length}/${fine.length}`);
const [[A, evA], [B], [C]] = lacking;
check("the check now says what each category needs, what is lacking, and the semester after (where the lacking credits would be added)", evA.sdp.required && evA.sdp.lacking && evA.sdp.next_semester
  && Number(evA.sdp.lacking.community_service) + Number(evA.sdp.lacking.community_volunteerism) + Number(evA.sdp.lacking.formation_program) >= 1, JSON.stringify(evA.sdp));
const prev = (await rows(uidOf(A), "select public.renewal_my_preview($1) p", [win.id]))[0].p;
check("the scholar's preview (before applying) carries the same details, and no request yet", prev.sdp.lacking && !prev.sdp.reconsideration);
const apply6 = (s, flag) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', $2) id", [win.id, flag]);
const refusedFine = await apply6(fine[0], true);
check("a scholar whose SDP is complete cannot ask for a reconsideration, and no application is left behind", !refusedFine.ok && /nothing to reconsider/.test(refusedFine.msg)
  && (await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [fine[0], Y, T]))[0].n === 0, refusedFine.msg);
const okA = await apply6(A, true);
check("a scholar who lacks credits applies WITH the request", okA.ok, okA.msg);
const reqA = (await q("select * from sdp_reconsideration_requests where scholar_id_number = $1 and school_year = $2 and term = $3", [A, Y, T]))[0];
check("one pending request was made, with what was lacking and the semester the renewal looks at", reqA?.status === "pending" && reqA.basis_school_year === basis.basis_school_year && reqA.basis_term === basis.basis_term
  && Number(reqA.lacking.community_service) + Number(reqA.lacking.community_volunteerism) + Number(reqA.lacking.formation_program) >= 1, JSON.stringify(reqA));
const recA = (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [A, Y, T]))[0];
check("the application is on hold for SDP while the request waits, and says so", recA.stage === "sdp_on_hold" && /reconsideration was requested/.test(recA.evaluation?.rule_text ?? ""), `${recA.stage} | ${recA.evaluation?.rule_text}`);
const noteA = (await q("select kind, body from scholar_notifications where scholar_id_number = $1 and kind like 'sdp_reconsideration%' order by created_at", [A]));
check("the scholar is told what was lacking and what approval means (complied now, the lacking credits added to the next semester)", noteA.length === 1 && noteA[0].kind === "sdp_reconsideration_requested" && /Lacking:/.test(noteA[0].body)
  && /added to your SDP requirement for 2nd Semester|added to your SDP requirement for 1st Semester/.test(noteA[0].body), JSON.stringify(noteA));
const bell = await q("select user_id from notifications where type = 'renewal' and title = 'SDP reconsideration requested'");
check("it.admin1 is told (bell); the evaluator is not", bell.some(b => b.user_id === ITADMIN) && !bell.some(b => b.user_id === EVALUATOR), JSON.stringify(bell));
check("asking again, or asking after having applied, is refused", !(await apply6(A, true)).ok && /only when you first apply/.test((await apply6(A, true)).msg));
const old5 = await attempt(uidOf(B), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);
check("the older application call (without the choice) still works and makes no request", old5.ok && (await q("select count(*)::int n from sdp_reconsideration_requests where scholar_id_number = $1", [B]))[0].n === 0, old5.msg);
check("the application of a scholar who did not ask stays on hold as before", (await q("select stage from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [B, Y, T]))[0].stage === "sdp_on_hold");
check("a scholar may ask only for themselves (they read their own request, nobody else's)", (await rows(uidOf(A), "select count(*)::int n from sdp_reconsideration_requests"))[0].n === 1 && (await rows(uidOf(B), "select count(*)::int n from sdp_reconsideration_requests"))[0].n === 0);
check("a scholar cannot write to the requests or the owed credits", !(await attempt(uidOf(A), "update sdp_reconsideration_requests set status = 'approved'")).ok && !(await attempt(uidOf(A), "select count(*) from sdp_reconsideration_debts")).ok);
const okC = await apply6(C, true);
check("a second scholar applies with the request too", okC.ok, okC.msg);

console.log("\nWho can decide");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_reconsideration_approver') on conflict do nothing", [PLAIN]);
const reqId = s => q("select id from sdp_reconsideration_requests where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]).then(r => r[0].id);
const idA = await reqId(A), idC = await reqId(C);
const decide = (uid, id, approve, note = "") => attempt(uid, "select public.renewal_sdp_reconsideration_decide($1, $2, $3) r", [id, approve, note]);
check("the evaluator, consultation staff and SEAD staff can see requests but cannot decide them", (await Promise.all([EVALUATOR, COUNSELOR, SEAD].map(u => decide(u, idA, true)))).every(r => !r.ok && /Only it\.admin1 or an appointed approver/.test(r.msg)));
check("a scholar and a visitor cannot decide", !(await decide(uidOf(A), idA, true)).ok && !(await attempt(null, "select public.renewal_sdp_reconsideration_decide($1, true, '')", [idA], "anon")).ok);
const list = uid => rows(uid, "select * from public.sdp_reconsideration_list('pending')");
check("approvers (it.admin1 and the tagged account) and the evaluator can read the list; others cannot", (await list(ITADMIN)).length === 2 && (await list(PLAIN)).length === 2 && (await list(EVALUATOR)).length === 2
  && !(await attempt(SEAD, "select * from public.sdp_reconsideration_list('pending')")).ok && !(await attempt(uidOf(A), "select * from public.sdp_reconsideration_list('pending')")).ok);
const lr = (await list(ITADMIN)).find(r => r.scholar_id_number === A);
check("each row says who, what is lacking, the semester it was about, the semester after, and whether this person may decide", lr.can_decide === true && lr.lacking && lr.next_semester && lr.basis_term && (await list(EVALUATOR))[0].can_decide === false);
const cnt = (await rows(ITADMIN, "select * from public.sdp_reconsideration_counts()"))[0];
check("the counts say 2 pending, and whether the viewer may decide", Number(cnt.pending) === 2 && cnt.can_decide === true && (await rows(EVALUATOR, "select * from public.sdp_reconsideration_counts()"))[0].can_decide === false);
check("an approver (without any renewal tag) can open the scholar's credits", (await attempt(PLAIN, "select public.renewal_scholar_sdp_credits($1, $2, $3) c", [A, Y, T])).ok && !(await attempt(SEAD, "select public.renewal_scholar_sdp_credits($1, $2, $3) c", [A, Y, T])).ok);

console.log("\nDenying");
check("a denial needs a reason", !(await decide(ITADMIN, idA, false, "")).ok);
const denied = await decide(PLAIN, idA, false, "Please attend the SDP activities first.");
check("the tagged approver denies it", denied.ok && denied.rows[0].r === "denied", denied.msg);
const afterDeny = (await q("select * from sdp_reconsideration_requests where id = $1", [idA]))[0];
check("the request is denied, with who decided, when and why", afterDeny.status === "denied" && afterDeny.decided_by === PLAIN && afterDeny.decided_at && /attend/.test(afterDeny.decision_note));
check("the scholar is told, with the reason, and the renewal stays on hold for SDP", (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'sdp_reconsideration_denied' and body like '%attend the SDP%'", [A]))[0].n === 1
  && (await q("select stage from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [A, Y, T]))[0].stage === "sdp_on_hold"
  && (await evalOf(A)).sdp.complied === false && (await evalOf(A)).sdp.reconsideration.status === "denied");
check("no credits are owed after a denial, and it cannot be decided twice", (await q("select count(*)::int n from sdp_reconsideration_debts where request_id = $1", [idA]))[0].n === 0 && !(await decide(ITADMIN, idA, true)).ok);

console.log("\nApproving");
const lackC = (await evalOf(C)).sdp.lacking;
const approved = await decide(ITADMIN, idC, true, "Approved this time.");
check("it.admin1 approves the second request", approved.ok && approved.rows[0].r === "approved", approved.msg);
const rc = (await q("select * from sdp_reconsideration_requests where id = $1", [idC]))[0];
check("the request is approved, with who and when", rc.status === "approved" && rc.decided_by === ITADMIN && rc.decided_at);
const nxt = (await q("select * from public._sdp_next_semester($1, $2)", [basis.basis_school_year, basis.basis_term]))[0];
const debts = await q("select category, amount, apply_school_year y, apply_semester s from sdp_reconsideration_debts where request_id = $1 order by category", [idC]);
const sumLack = Number(lackC.community_service) + Number(lackC.community_volunteerism) + Number(lackC.formation_program);
check("the lacking credits (per category) are owed for the NEXT semester, exactly as many as were lacking", debts.length >= 1 && debts.reduce((n, d) => n + d.amount, 0) === sumLack && debts.every(d => d.y === nxt.school_year && d.s === nxt.semester)
  && debts.every(d => d.amount === Number(lackC[d.category])), JSON.stringify([debts, lackC]));
const eC = await evalOf(C);
check("the scholar now counts as complied for the semester the renewal looks at (and the check says it is by reconsideration)", eC.sdp.complied === true && eC.sdp.by_reconsideration === true && eC.sdp.reconsideration.status === "approved"
  && (await q("select complied from public._sdp_compliance($1, $2, $3)", [basis.basis_school_year, basis.basis_term, C]))[0].complied === true);
const recC = (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [C, Y, T]))[0];
check("the application is re-checked at once: it is no longer on hold for SDP", recC.stage !== "sdp_on_hold", recC.stage);
check("the scholar is told it was approved, what was lacking, and what is added to the next semester", (await q("select body from scholar_notifications where scholar_id_number = $1 and kind = 'sdp_reconsideration_approved'", [C])).some(n => /added to your SDP requirement/.test(n.body) && /Approved this time/.test(n.body)));
const reqNext = JSON.parse((await q("select public._sdp_required_map($1, $2, $3) m", [C, nxt.school_year, nxt.semester]))[0].m === undefined ? "{}" : JSON.stringify((await q("select public._sdp_required_map($1, $2, $3) m", [C, nxt.school_year, nxt.semester]))[0].m));
check("their requirement for the next semester is now 3 plus what was owed, per category", Object.entries(reqNext).every(([k, v]) => v === 3 + Number(lackC[k])), JSON.stringify(reqNext));
check("the history of the application records the request and the decision", (await q("select count(*)::int n from renewal_history where record_id = $1 and note like 'SDP reconsideration%'", [recC.id]))[0].n === 2);
check("the same scholar's earlier requests show as history in the list", (await rows(ITADMIN, "select * from public.sdp_reconsideration_list('all')")).every(r => Array.isArray(r.previous)));
check("the list can be filtered by status and searched by Scholar ID", (await rows(ITADMIN, "select * from public.sdp_reconsideration_list('approved')")).length === 1 && (await rows(ITADMIN, "select * from public.sdp_reconsideration_list('all', $1)", [A])).length === 1
  && (await rows(ITADMIN, "select * from public.sdp_reconsideration_list('denied')")).length === 1);

console.log("\nCredits that come in before the decision");
const D = lacking[3]?.[0];
if (D) {
  check("a scholar applies with a request", (await apply6(D, true)).ok);
  const idD = await reqId(D);
  // give the scholar all the credits that were lacking, in the semester the renewal looks at
  const lackD = (await evalOf(D)).sdp.lacking;
  for (const cat of Object.keys(lackD)) if (Number(lackD[cat]) > 0) await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, occurrence_number, school_year, semester) select $1, $2, current_date, 100 + g, $3, $4 from generate_series(1, $5::int) g",
    [acts[cat], D, basis.basis_school_year, basis.basis_term, Number(lackD[cat])]);
  const closed = await decide(ITADMIN, idD, true, "");
  check("approving when the credits are complete by then closes the request as 'not needed' and owes nothing", closed.ok && closed.rows[0].r === "not_needed"
    && (await q("select status from sdp_reconsideration_requests where id = $1", [idD]))[0].status === "not_needed" && (await q("select count(*)::int n from sdp_reconsideration_debts where request_id = $1", [idD]))[0].n === 0, closed.msg);
} else check("(not enough lacking scholars in the demo for this case)", true);

console.log("\nThe Scholar List and the rest stay in step");
check("the renewal evaluator's list-eligibility of an approved scholar is no longer 'For SDP reconsideration' once the list is checked again", await (async () => {
  const e = await evalOf(C);
  const lab = (await q("select public._renewal_list_eligibility($1::jsonb) l", [JSON.stringify(e)]))[0].l;
  return !lab.includes("sdp_reconsideration");
})());

console.log("\nThe Scholar List and SDP Monitoring (file D)");
{
  const since = null;
  let step = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 300)", [Y, T, since]))[0], guard = 0;
  while (Number(step.remaining) > 0 && guard++ < 100) step = (await rows(EVALUATOR, "select * from public.renewal_scholar_list_refresh($1, $2, $3, 300)", [Y, T, step.since]))[0];
  const list = await rows(EVALUATOR, "select * from public.renewal_scholar_list($1, $2, null, null, null, null, null, 200, 0)", [Y, T]);
  const rowOf = s => list.find(r => r.scholar_id_number === s);
  check("the Scholar List says which scholars have asked, were approved or were denied (and nothing for those who did not ask)", rowOf(C)?.sdp_reconsideration === "approved" && rowOf(A)?.sdp_reconsideration === "denied" && rowOf(B)?.sdp_reconsideration === null, JSON.stringify([rowOf(C)?.sdp_reconsideration, rowOf(A)?.sdp_reconsideration, rowOf(B)?.sdp_reconsideration]));
  check("an approved scholar shows SDP complied in the list and is not 'For SDP reconsideration'; the denied one still is", rowOf(C).sdp_complied === true && !rowOf(C).eligibility.includes("sdp_reconsideration") && rowOf(A).sdp_complied === false && rowOf(A).eligibility.includes("sdp_reconsideration"));
  const owedRows = await rows(PLAIN, "select * from public.scholars_sdp_extra_required($1, $2)", [nxt.school_year, nxt.semester]);
  check("SDP Monitoring can ask who owes extra credits for the semester after: exactly the approved scholar, with the credits owed", owedRows.length === 1 && owedRows[0].scholar_id_number === C
    && owedRows[0].community_service + owedRows[0].community_volunteerism + owedRows[0].formation_program === sumLack, JSON.stringify(owedRows));
  check("it is for SDP Monitoring staff, the evaluator and the approvers; not for a scholar or a visitor", (await attempt(SEAD, "select * from public.scholars_sdp_extra_required($1, $2)", [nxt.school_year, nxt.semester])).ok
    && (await attempt(EVALUATOR, "select * from public.scholars_sdp_extra_required($1, $2)", [nxt.school_year, nxt.semester])).ok && !(await attempt(uidOf(A), "select * from public.scholars_sdp_extra_required($1, $2)", [nxt.school_year, nxt.semester])).ok
    && !(await attempt(null, "select * from public.scholars_sdp_extra_required($1, $2)", [nxt.school_year, nxt.semester], "anon")).ok);
  check("a semester nobody owes anything for gives an empty answer", (await rows(PLAIN, "select * from public.scholars_sdp_extra_required('2020-2021', '1st Semester')")).length === 0);
}

console.log("\nRunning again, the undo and putting it back");
for (const f of FILES) await db.exec(read(f));
check("running the files again keeps every request and decision", (await q("select count(*)::int n from sdp_reconsideration_requests"))[0].n >= 3);
await q("delete from sdp_attendance where occurrence_number >= 100");     // the credits this test added for one scholar, so the before / after comparison is fair
for (const f of UNDOS) await db.exec(read(f));
check("after the undo the Scholar List page has its original columns again", (await attempt(EVALUATOR, "select * from public.renewal_scholar_list($1, $2, null, null, null, null, null, 5, 0)", [Y, T])).rows.every(r => !("sdp_reconsideration" in r)));
check("after the undo the tables and the new functions are gone, and the renewal check is the old one (no reconsideration in its answer)", (await q("select to_regclass('public.sdp_reconsideration_requests') t"))[0].t === null
  && (await q("select count(*)::int n from pg_proc where proname in ('renewal_sdp_reconsideration_decide', 'sdp_reconsideration_list', '_sdp_required_map', 'fetch_scholar_sdp_requirements', 'can_decide_sdp_reconsideration', 'scholars_sdp_extra_required')"))[0].n === 0
  && !("reconsideration" in ((await q("select public._renewal_evaluate($1, $2, $3) e", [A, Y, T]))[0].e.sdp)));
check("after the undo the SDP answers are the same as before the files were ever run, and the older application call works", (await snapshot()) === before
  && (await attempt(uidOf(fine[0]), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id])).ok);
for (const f of FILES) await db.exec(read(f));
check("it can be put back after the undo", (await q("select to_regclass('public.sdp_reconsideration_requests') t"))[0].t !== null);
const text = FILES.map(f => read(f).replace(/--.*$/gm, "")).join("\n");
check("the files change no existing table and delete nothing", !/alter table public\.(?!sdp_reconsideration_)/i.test(text) && !/\b(delete from|truncate|drop table)\b/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
