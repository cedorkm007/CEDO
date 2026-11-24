// tests/renewal-one-failure-docs-anytime/db_tests.mjs — a REGULAR scholar with ONE failed subject can send the study plan and the clearance before or after booking the consultation (5 checks, short on purpose)
// Run:  node tests/renewal-one-failure-docs-anytime/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_one_failure_docs_anytime.sql", UNDO = "undo_renewal_one_failure_docs_anytime.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions where school_id = $1", [LETTERS]);
const free = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 3", [LETTERS, Y, T])).map(r => r.s);
const [A, B, C] = free;
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((g, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: g }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const approveGrades = async s => { const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id; await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]); };
const ready = async (s, grades) => { await apply(s, grades); await approveGrades(s); const r = await rec(s); await q("update renewal_records set consultation_done_at = now() where id = $1", [r.id]); await q("select public._renewal_recheck($1)", [r.id]); return rec(s); };
const endorse = (id, st) => attempt(COUNSELOR, "select public.renewal_endorse_status($1, $2, 'Reason for this status')", [id, st]);
const approve = (id, st = null) => attempt(EVAL, "select public.renewal_approve_endorsement($1, 'ok', $2)", [id, st]);
const status = async s => (await q("select status from scholars where scholar_id_number = $1", [s]))[0].status;
const kinds = r => (r.evaluation?.required_documents ?? []).map(d => d.kind).sort().join(",");
const addDoc = async (s, id, k) => (await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1, $2, $3, $4, $5, 'application/pdf', 10) returning id", [id, s, k, `${s}/${id}/${k}/x.pdf`, `${k}.pdf`]))[0].id;
const reviewDoc = id => attempt(COUNSELOR, "select public.renewal_review_document($1, true, '')", [id]);
// 1. ONE failed subject, before anything else: the study plan and the clearance are asked from the start; the consultation booking does not wait for them. Two failed subjects: still no document before the approval.
await apply(A, ["F", "A"]); await approveGrades(A); await q("select public._renewal_recheck($1)", [(await rec(A)).id]);
const a1 = await rec(A);
const c1 = await ready(C, ["F", "F"]);
const st = (await q("select public._renewal_consult_state($1) s", [a1.id]))[0].s;
check("1 a scholar with ONE failed subject sees the study plan and the clearance from the start (code B, stage 'needs consultation'), and the booking of the consultation does not wait for them; a scholar with two failed subjects still has no document before the approval",
  /^B/.test(a1.rule_code) && a1.stage === "needs_study_plan_consultation" && kinds(a1) === "clearance,study_plan" && st === "ok" && /before or after you book your consultation/.test(a1.rule_text ?? "") && /^C/.test(c1.rule_code) && kinds(c1) === "", `${a1.rule_code} ${a1.stage} [${kinds(a1)}] ${st} ${c1.rule_code} [${kinds(c1)}]`);

// 2. BEFORE booking: the scholar sends both, the consultation staff approve them, and the case stays where it is (not renewed: the status still has to be endorsed and approved)
const planA = await addDoc(A, a1.id, "study_plan"), clrA = await addDoc(A, a1.id, "clearance");
const r1 = await reviewDoc(planA), r2 = await reviewDoc(clrA); const a2 = await rec(A);
check("2 BEFORE the consultation: both documents can be uploaded and approved; the case stays 'needs consultation' (not renewed), the approved documents show as approved",
  r1.ok && r2.ok && a2.stage === "needs_study_plan_consultation" && (await status(A)) === "Regular" && (a2.evaluation.required_documents ?? []).every(d => d.approved === true), `${r1.msg} ${r2.msg} ${a2.stage}`);

// 3. then the consultation is done, the staff endorse Regular and the evaluator approves: the documents are already approved, so the scholar is renewed at once
await q("update renewal_records set consultation_done_at = now() where id = $1", [a1.id]); await q("select public._renewal_recheck($1)", [a1.id]);
const e = await endorse(a1.id, "Regular"); const ap = await approve(a1.id); const a3 = await rec(A);
check("3 after the consultation, the endorsement and the approval, a scholar who already sent (and had approved) the two documents is renewed at once as Regular",
  e.ok && ap.ok && a3.stage === "renewed" && a3.result === "renewed" && (await status(A)) === "Regular", `${e.msg} ${ap.msg} ${a3.stage}`);

// 4. AFTER booking / the consultation: a scholar who sent nothing yet sees the two documents while waiting for the endorsement, sends them, and is renewed when they are approved
const b1 = await ready(B, ["F", "A"]);
const planB = await addDoc(B, b1.id, "study_plan"), clrB = await addDoc(B, b1.id, "clearance");
await endorse(b1.id, "Regular"); await approve(b1.id); const mid = await rec(B);
await reviewDoc(planB); await reviewDoc(clrB); const b3 = await rec(B);
check("4 after the consultation a scholar still sees the two documents (code B, stage 'consultation done'), can send them then, and after the approval waits for their approval and is renewed when both are approved",
  /^B/.test(b1.rule_code) && kinds(b1) === "clearance,study_plan" && b1.stage === "ready_for_endorsement" && mid.stage === "awaiting_documents" && b3.stage === "renewed" && b3.result === "renewed", `${b1.stage} [${kinds(b1)}] ${mid.stage} ${b3.stage}`);

// 5. the undo: back to asking for the documents only after the approval, no record or document deleted
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const D = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 1", [LETTERS, Y, T]))[0]?.s;
let kindsD = "n/a";
if (D) { await apply(D, ["F", "A"]); await approveGrades(D); await q("select public._renewal_recheck($1)", [(await rec(D)).id]); kindsD = kinds(await rec(D)); }
check("5 after the undo a new scholar with one failed subject has no document before the approval again, and no record or document was deleted",
  (!D || kindsD === "") && Number((await q("select count(*)::int n from renewal_documents"))[0].n) >= 4, `${kindsD}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
