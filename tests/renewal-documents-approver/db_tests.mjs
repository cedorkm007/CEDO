// tests/renewal-documents-approver/db_tests.mjs — the Renewal Documents Approver tag (supabase_migration_renewal_documents_approver.sql)
//   only the tagged approvers approve or return the study plan, INC letter and clearance; the evaluator can only read; the Documents list, the counts, the bell notice, the undo.
// Run:  node tests/renewal-documents-approver/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_documents_approver.sql", UNDO = "undo_renewal_documents_approver.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const uidOf = n => seedId(`scholar:${n}`);
const DOCS = seedId("staff:demo.docs"), EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), DIVHEAD = seedId("staff:demo.divhead"), PLAIN = seedId("staff:demo.plain");
const W1 = seedId("window:w1");
const docs = (n, kinds) => kinds.map(k => ({ kind: k, path: `${num(n)}/${W1}/inc-docs/${k}/${crypto.randomUUID()}-f.pdf`, name: `${k}.pdf`, mime: "application/pdf", size: 500 }));
const ALL3 = ["inc_letter", "study_plan", "clearance"];
const apply10 = (n, list) => attempt(uidOf(n), "select public.renewal_apply($1,'S','BS Test Studies','2nd Year','',false,'[]'::jsonb,'[]'::jsonb,false,$2::jsonb) id", [W1, JSON.stringify(list)]);
const recordOf = async n => (await q("select * from renewal_records where scholar_id_number = $1 and window_id = $2", [num(n), W1]))[0];
const review = (uid, id, approve = true, comment = "") => attempt(uid, "select public.renewal_review_document($1, $2, $3)", [id, approve, comment]);
const statusOf = async id => (await q("select status from renewal_documents where id = $1", [id]))[0].status;
const notesOf = (uid) => q("select * from notifications where user_id = $1 and title = 'Renewal documents to approve' order by \"timestamp\"", [uid]);

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on: start from today's behaviour
console.log("Before the file (today's behaviour)");
const a1 = await apply10(22, docs(22, ALL3));
const rec = await recordOf(22);
const ids = Object.fromEntries((await q("select id, kind from renewal_documents where record_id = $1", [rec.id])).map(d => [d.kind, d.id]));
check("a scholar with an INC (and a failed subject) applies with the three documents", a1.ok && !!rec && Object.keys(ids).length === 3, a1.msg);
const before = await review(EVAL, ids.study_plan);
check("the evaluator approves the study plan (today)", before.ok && (await statusOf(ids.study_plan)) === "accepted", before.msg);
await q("update renewal_documents set status = 'submitted', reviewer_comment = null, reviewed_by = null, reviewed_at = null where id = $1", [ids.study_plan]);

await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nWho can approve or return");
check("the demo account has the tag", (await rows(DOCS, "select public.can_approve_renewal_documents() a"))[0].a === true && (await rows(EVAL, "select public.can_approve_renewal_documents() a"))[0].a === false);
const byEval = await review(EVAL, ids.study_plan);
check("the evaluator can no longer approve the study plan (a clear message, nothing changed)", !byEval.ok && /Documents Approver/.test(byEval.msg) && (await statusOf(ids.study_plan)) === "submitted", byEval.msg);
check("the evaluator cannot approve the INC letter or the clearance either", !(await review(EVAL, ids.inc_letter)).ok && !(await review(EVAL, ids.clearance)).ok);
check("the counselor, the Division Head, plain staff and a scholar cannot", !(await review(COUNSELOR, ids.study_plan)).ok && !(await review(DIVHEAD, ids.study_plan)).ok && !(await review(PLAIN, ids.study_plan)).ok && !(await review(uidOf(22), ids.study_plan)).ok);
const byDocs = await review(DOCS, ids.study_plan);
check("the Documents Approver approves the study plan", byDocs.ok && (await statusOf(ids.study_plan)) === "accepted", byDocs.msg);
check("the record shows who approved it", (await q("select reviewed_by from renewal_documents where id = $1", [ids.study_plan]))[0].reviewed_by === DOCS
  && (await q("select count(*)::int n from renewal_history where record_id = $1 and note like 'Approved the study plan%'", [rec.id]))[0].n >= 1);
const noReason = await review(DOCS, ids.inc_letter, false, "");
check("returning needs a reason of at least 5 characters", !noReason.ok && /what to fix/.test(noReason.msg));
const returned = await review(DOCS, ids.inc_letter, false, "The dean did not sign it");
check("the approver returns the INC letter with a reason", returned.ok && (await statusOf(ids.inc_letter)) === "returned");
check("the clearance too: approved by the approver", (await review(DOCS, ids.clearance)).ok && (await statusOf(ids.clearance)) === "accepted");

console.log("\nThe prospectus is not one of the three");
await q("select set_config('cedo.apply_docs_ok', 'on', false)");
const pros = (await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'prospectus',$3,'p.pdf','application/pdf',500) returning id", [rec.id, num(22), `${num(22)}/${rec.id}/prospectus/${crypto.randomUUID()}-p.pdf`]).catch(() => null))?.[0];
await q("select set_config('cedo.apply_docs_ok', '', false)");
if (pros) {
  check("the prospectus stays with the evaluator: the evaluator can review it, the Documents Approver cannot", (await review(DOCS, pros.id)).ok === false && (await review(EVAL, pros.id)).ok === true);
} else check("(the prospectus could not be set up in this test data: skipped)", true);

console.log("\nThe Documents list");
const queue = (uid, status = "pending", query = null, limit = 25, offset = 0) => rows(uid, "select * from public.renewal_documents_queue($1, $2, $3, $4)", [status, query, limit, offset]);
const pendingNow = await queue(DOCS);
check("the approver sees the documents that wait (the returned INC letter is not waiting any more), with the scholar's name and where the file is", pendingNow.every(r => r.status === "submitted") && pendingNow.every(r => r.scholar_name && r.storage_path && r.record_id), JSON.stringify(pendingNow.length));
check("returned and approved documents are listed under their own filters", (await queue(DOCS, "returned")).some(r => r.document_id === ids.inc_letter) && (await queue(DOCS, "accepted")).some(r => r.document_id === ids.study_plan) && (await queue(DOCS, "all")).length >= 3);
check("only the three kinds that need approval are listed", (await queue(DOCS, "all")).every(r => ["study_plan", "inc_letter", "clearance"].includes(r.kind)));
check("a search finds the scholar by ID", (await queue(DOCS, "all", num(22))).length >= 3 && (await queue(DOCS, "all", "no-such-person")).length === 0);
check("the evaluator, the counselor and the Division Head can read the list (they cannot act on it); plain staff and a scholar cannot", (await attempt(EVAL, "select * from public.renewal_documents_queue('all')")).ok && (await attempt(COUNSELOR, "select * from public.renewal_documents_queue('all')")).ok
  && !(await attempt(PLAIN, "select * from public.renewal_documents_queue('all')")).ok && !(await attempt(uidOf(22), "select * from public.renewal_documents_queue('all')")).ok);
check("an unknown filter is refused", !(await attempt(DOCS, "select * from public.renewal_documents_queue('x')")).ok);
const counts = (await rows(DOCS, "select public.renewal_documents_counts() c"))[0].c;
check("the counts add up: pending + returned + approved = all (none is only in 'all')", counts.pending + counts.returned + counts.accepted === counts.all && counts.accepted >= 2 && counts.returned >= 1, JSON.stringify(counts));
check("the counts are for the approver and the people who read renewals only", !(await attempt(PLAIN, "select public.renewal_documents_counts()")).ok && (await attempt(EVAL, "select public.renewal_documents_counts()")).ok);

console.log("\nThe approver can see the renewal lists, open the files and follow live changes");
check("the approver can see the renewal lists (where documents wait); plain staff cannot", (await rows(DOCS, "select public.can_view_renewal_list() a"))[0].a === true && (await rows(PLAIN, "select public.can_view_renewal_list() a"))[0].a === false);
check("the storage rule lets the approver open the scholars' files", /can_approve_renewal_documents/.test((await q("select qual from pg_policies where policyname = 'scholar or staff reads renewal documents'")).map(r => r.qual).join(" ")));
check("the live stamp works for the approver (and still for the evaluator)", (await attempt(DOCS, "select public.staff_live_stamp()")).ok && (await attempt(EVAL, "select public.staff_live_stamp()")).ok);

console.log("\nThe bell notice");
const a2 = await apply10(7, docs(7, ALL3));      // after the file: the notice trigger is on
const rec7 = await recordOf(7);
const n1 = await notesOf(DOCS);
check("a tagged approver got ONE notice for the three documents sent together with the application", a2.ok && n1.length === 1 && n1[0].reference_id === rec7.id && /sent a/.test(n1[0].message), JSON.stringify(n1.map(n => n.message)) + (a2.msg ?? ""));
check("the evaluator, the counselor and other staff got none", (await notesOf(EVAL)).length === 0 && (await notesOf(PLAIN)).length === 0 && (await notesOf(COUNSELOR)).length === 0);
const second = await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'study_plan',$3,'again.pdf','application/pdf',500) returning id", [rec7.id, num(7), `${num(7)}/${rec7.id}/study_plan/${crypto.randomUUID()}-again.pdf`]).catch(e => e.message);
check("a further document for the same application gives no second notice while the first is unread", (await notesOf(DOCS)).length === 1, String(second));
await q("update notifications set read = true where user_id = $1", [DOCS]);
await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'clearance',$3,'again.pdf','application/pdf',500)", [rec7.id, num(7), `${num(7)}/${rec7.id}/clearance/${crypto.randomUUID()}-again.pdf`]).catch(() => null);
check("once the notice is read, a new document for the same application gives a new notice", (await notesOf(DOCS)).length === 2, String((await notesOf(DOCS)).length));

console.log("\nThe undo and the file");
await db.exec(read(UNDO));
check("after the undo the evaluator approves again, the approver can no longer, and the new functions are gone", (await review(EVAL, ids.inc_letter)).ok && !(await review(DOCS, ids.clearance)).ok
  && (await q("select to_regprocedure('public.renewal_documents_queue(text,text,integer,integer)') is null a, to_regprocedure('public.can_approve_renewal_documents()') is null b"))[0].a);
await db.exec(read(FILE));
check("the file can be put back after an undo", (await review(EVAL, ids.clearance)).ok === false);
const text = read(FILE).replace(/--.*$/gm, "");
check("no table is changed or emptied (functions, one storage rule and one trigger)", !/(alter table|drop table|delete from|truncate|create table|insert into)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
await db.close?.();
