// tests/renewal-documents-after-approval/db_tests.mjs — the consultation route (a failed subject / DRP): NO document before the decision; after the evaluator approves Probationary or Reconsidered the scholar sends the study plan
// and the clearance (and the letter from the dean only with an INC), the consultation staff approve them, then the scholar is renewed; Regular and Removed need no document (5 checks, short on purpose)
// Run:  node tests/renewal-documents-after-approval/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_documents_after_approval.sql", UNDO = "undo_renewal_documents_after_approval.sql";
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
const free = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 4", [LETTERS, Y, T])).map(r => r.s);
const [A, B, C] = free;
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((g, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: g }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const approveGrades = async s => { const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id; await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]); };
const addDoc = async (s, k) => { const r = await rec(s); return q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1, $2, $3, $4, $5, 'application/pdf', 10) returning id", [r.id, s, k, `${s}/${r.id}/${k}/x.pdf`, `${k}.pdf`]); };
const tryDoc = async (s, k) => { try { return { ok: true, id: (await addDoc(s, k))[0].id }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const status = async s => (await q("select status from scholars where scholar_id_number = $1", [s]))[0].status;
const kinds = r => (r.evaluation?.required_documents ?? []).map(d => d.kind).sort().join(",");
const consulted = async s => { const r = await rec(s); await q("update renewal_records set consultation_done_at = now() where id = $1", [r.id]); await q("select public._renewal_recheck($1)", [r.id]); return rec(s); };
const endorse = (s, st, id) => attempt(COUNSELOR, "select public.renewal_endorse_status($1, $2, 'Reason for this status')", [id, st]);
const approve = id => attempt(EVAL, "select public.renewal_approve_endorsement($1, 'ok')", [id]);

// 1. NO document before the decision: after the grades the case needs only the consultation; once it is attended the case is ready for the consultation staff (no document uploaded or approved)
await apply(A, ["F", "A"]); await approveGrades(A);
const a0 = await rec(A);
const a1 = await consulted(A);
const early = await endorse(A, "Probationary", a1.id);
check("1 a scholar with a failed subject is asked for NO document before the decision: the case needs only the consultation, and as soon as it is attended it is ready for the consultation staff to endorse (no document uploaded or approved)",
  a0.stage === "needs_study_plan_consultation" && kinds(a0) === "" && a1.stage === "ready_for_endorsement" && kinds(a1) === "" && early.ok, `${a0.stage} [${kinds(a0)}] ${a1.stage} ${early.msg}`);

// 2. Removed needs no document: the scholarship ends as soon as the evaluator approves
await apply(C, ["F", "F"]); await approveGrades(C); const c1 = await consulted(C);
await endorse(C, "Removed", c1.id);
const ac = await approve(c1.id);
const c2 = await rec(C);
check("2 Removed ends the scholarship as soon as the evaluator approves, with no document (the scholar is Removed)",
  ac.ok && c2.stage === "removed" && c2.result === "removed" && (await status(C)) === "Removed", `${ac.msg} ${c2.stage}`);

// 3. Probationary: after the evaluator approves, the case waits for the documents: the study plan and the clearance only (no letter without an INC); the status does not change yet
const aApproved = await approve(a1.id);
const a2 = await rec(A);
const letter = await tryDoc(A, "inc_letter"), study = await tryDoc(A, "study_plan"), clearance = await tryDoc(A, "clearance");
check("3 approved as Probationary, the case waits for the documents: the study plan and the clearance only (the letter from the dean is refused: no INC); the scholar's status does not change yet",
  aApproved.ok && a2.stage === "awaiting_documents" && kinds(a2) === "clearance,study_plan" && !letter.ok && /not needed/i.test(letter.msg) && study.ok && clearance.ok && (await status(A)) !== "Probationary", `${aApproved.msg} ${a2.stage} [${kinds(a2)}] ${letter.msg} ${study.msg} ${clearance.msg}`);

// 4. only the consultation staff approve the documents; the scholar is renewed with the approved status when the LAST one is approved (an INC adds the letter from the dean)
const byEval = await attempt(EVAL, "select public.renewal_review_document($1, true, '')", [study.id]);
const first = await attempt(COUNSELOR, "select public.renewal_review_document($1, true, '')", [study.id]);
const mid = await rec(A), statusMid = await status(A);
const last = await attempt(COUNSELOR, "select public.renewal_review_document($1, true, '')", [clearance.id]);
const a3 = await rec(A);
await apply(B, ["F", "INC"]); await approveGrades(B); const b1 = await consulted(B);
await endorse(B, "Reconsidered", b1.id); await approve(b1.id);
const b2 = await rec(B);
check("4 only the consultation staff approve the documents; the scholar is renewed as Probationary only when the last one is approved (not before); a scholar who also has an INC must send the letter from the dean as well (3 documents)",
  !byEval.ok && first.ok && mid.stage === "awaiting_documents" && statusMid !== "Probationary" && last.ok && a3.stage === "renewed" && a3.result === "renewed_probationary" && (await status(A)) === "Probationary"
  && b2.stage === "awaiting_documents" && kinds(b2) === "clearance,inc_letter,study_plan", `${byEval.msg} ${first.msg} ${mid.stage} ${a3.stage} ${a3.result} ${b2.stage} [${kinds(b2)}]`);

// 5. the undo: a case waiting for its documents goes back to 'endorsed' for the evaluator, the stage list and the old rules come back, nothing is deleted
const docs = Number((await q("select count(*)::int n from renewal_documents"))[0].n), recs = Number((await q("select count(*)::int n from renewal_records"))[0].n);
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const c3 = await rec(B);
const gone = (await q("select to_regprocedure('public._renewal_finish_endorsed(uuid)') f"))[0].f;
const stageTitle = (await q("select public._renewal_stage_title('awaiting_documents') t"))[0].t;
check("5 after the undo the case that waited for its documents is back to 'endorsed - waiting for the evaluator', the new function is gone, the old rules are back (documents first again) and no record or document is deleted",
  c3.stage === "endorsed_for_approval" && gone === null && stageTitle === "awaiting_documents" && Number((await q("select count(*)::int n from renewal_documents"))[0].n) === docs && Number((await q("select count(*)::int n from renewal_records"))[0].n) === recs, `${c3.stage} ${gone} ${stageTitle}`);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
