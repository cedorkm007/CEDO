// tests/documents-after-grades/db_tests.mjs — scholars with a failed subject / INC / DRP: the three documents are required AFTER the grades are approved, not with the application (5 checks, short on purpose)
// Run:  node tests/documents-after-grades/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_documents_after_grades.sql", UNDO = "undo_documents_after_grades.sql";
await db.exec(read("undo_entered_grades_e.sql"));
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
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
const mk = (grade, s) => [JSON.stringify([{ code: "S1", subject: "One", units: 3, grade }]), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])];
const apply = (s, grade, docs = "[]") => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, $4::jsonb) id", [win.id, ...mk(grade, s), docs]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const kinds = async s => ((await rec(s)).evaluation?.required_documents ?? []).map(d => d.kind).sort().join();

console.log("Documents after the grades are approved");
const a1 = await apply(A, "F");
check("1 a scholar with a failed grade can apply WITHOUT the three documents (it used to be refused)", a1.ok && !!(await rec(A)), a1.msg);
check("2 right after applying, with the grades waiting for the Grades Approver, no document is asked for yet", (await rec(A)).stage === "waiting_grades" && (await kinds(A)) === "", `${(await rec(A)).stage} ${await kinds(A)}`);
const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(A)).id]))[0].id;
await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]);
const up = await attempt(uidOf(A), "insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'study_plan', $3, 'plan.pdf', 'application/pdf', 10) returning id", [(await rec(A)).id, A, `${A}/${(await rec(A)).id}/study_plan/plan.pdf`]);
check("3 once the grades are approved the documents are required (one failed subject: the study plan and the clearance, no letter), the scholar is told, and the scholar can upload them from the Renewal tile",
  (await kinds(A)) === "clearance,study_plan" && Number((await q("select count(*) n from scholar_notifications where scholar_id_number = $1 and kind = 'document_required'", [A]))[0].n) >= 1 && up.ok, `${await kinds(A)} ${up.msg}`);
const clean = "TEST-0001";      // everything passed in the school's own grades, no INC
const b1 = await attempt(uidOf(clean), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, '[]'::jsonb, '[]'::jsonb, false, $2::jsonb) id", [win.id, JSON.stringify(["inc_letter"].map(k => ({ kind: k, path: `${clean}/${win.id}/inc-docs/${k}/x.pdf`, name: "x.pdf", mime: "application/pdf", size: 10 })))]);
check("4 documents sent by a scholar who has no INC and no failed subject are still refused", !b1.ok && /No INC or failed subject was found/.test(b1.msg), b1.msg);
await db.exec(read(UNDO));
const c1 = await apply(C, "F");
check("5 after the undo the old rule is back: an application with a failed grade is refused without the three documents", !c1.ok && /You have a failed subject.*letter from your dean/.test(c1.msg), c1.msg);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
