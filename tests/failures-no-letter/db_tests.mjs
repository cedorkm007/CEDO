// tests/failures-no-letter/db_tests.mjs — failed subjects (one or two): the study plan and the clearance only (no letter from the dean); an INC still needs all three (5 checks, short on purpose)
// Run:  node tests/failures-no-letter/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_failures_no_letter.sql", UNDO = "undo_failures_no_letter.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const COUNSELOR = seedId("staff:demo.counselor");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions");
const two = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 3", [LETTERS])).map(r => r.s);
await q("delete from renewal_records where scholar_id_number = any($1::text[]) and school_year = $2 and term = $3", [two, Y, T]);
const [A, B, C] = two;
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((g, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: g }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const approve = async s => { const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id; await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]); };
const kinds = async s => ((await rec(s)).evaluation?.required_documents ?? []).map(d => d.kind).sort().join();

await apply(A, ["F", "A"]); await approve(A);
await apply(B, ["F", "F"]); await approve(B);
await apply(C, ["F", "INC"]); await approve(C);
check("1 ONE failed subject: the study plan and the clearance only (no letter from the dean)", (await kinds(A)) === "clearance,study_plan", await kinds(A));
check("2 TWO failed subjects: also only the study plan and the clearance; a failed subject together with an INC still needs all three (the INC letter)", (await kinds(B)) === "clearance,study_plan" && (await kinds(C)) === "clearance,inc_letter,study_plan", `${await kinds(B)} | ${await kinds(C)}`);
const ra = await rec(A);
for (const k of ["study_plan", "clearance"]) await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes, status) values ($1, $2, $3, $4, $5, 'application/pdf', 10, 'accepted')", [ra.id, A, k, `${A}/${ra.id}/${k}/x.pdf`, `${k}.pdf`]);
await q("update renewal_records set consultation_done_at = now() where id = $1", [ra.id]);
await q("select public._renewal_recheck($1)", [ra.id]);
check("3 with the study plan and the clearance approved and the consultation attended, the case with one failed subject is ready for the consultation staff (the letter is not waited for)", (await rec(A)).stage === "ready_for_endorsement", (await rec(A)).stage);
const textA = (await rec(A)).rule_text;
check("4 the explanation of the rule names only the study plan and the clearance for failed subjects, and all three for a case with an INC", /the study plan and the clearance/.test(textA) && !/letter from your dean/.test(textA) && /letter from your dean/.test((await rec(C)).rule_text) && !/letter from your dean/.test((await rec(B)).rule_text), `${textA}`);
await db.exec(read(UNDO));
await q("select public._renewal_recheck($1)", [(await rec(B)).id]);
check("5 after the undo two failed subjects need the letter again (one failed subject still does not)", (await q("select public._renewal_evaluate($1, $2, $3) e", [B, Y, T]))[0].e.required_documents.map(d => d.kind).sort().join() === "clearance,inc_letter,study_plan" && (await q("select public._renewal_evaluate($1, $2, $3) e", [A, Y, T]))[0].e.required_documents.map(d => d.kind).sort().join() === "clearance,study_plan");
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
