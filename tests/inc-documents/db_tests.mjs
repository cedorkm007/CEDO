// tests/inc-documents/db_tests.mjs — a scholar with an INC sends three documents with the application; the INC deadline is a date in the consultation form
//   (supabase_migration_inc_docs_a_clearance_kind.sql, then supabase_migration_inc_docs_b_functions.sql)
// Run:  node tests/inc-documents/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { useLegacySlots } from "../renewal/db/legacy_slots.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await useLegacySlots(db);      // the Daily Record part is checked on the original booking model, like the older renewal tests
const read = f => fs.readFileSync(f, "utf8");
const FILE_A = "supabase_migration_inc_docs_a_clearance_kind.sql", UNDO_A = "undo_inc_docs_a.sql", FILE_B = "supabase_migration_inc_docs_b_functions.sql", UNDO_B = "undo_inc_docs_b.sql";

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const uidOf = n => seedId(`scholar:${n}`);
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), DOCS = seedId("staff:demo.docs");
const W1 = seedId("window:w1");
const T = "2026-2027", S1 = "1st Semester";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const recordOf = async n => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [num(n), T, S1]))[0];
const stateOf = async n => (await rows(uidOf(n), "select public.renewal_my_overview() o"))[0].o.windows.find(w => w.window.term === S1 && w.window.school_year === T).consult_state;
const notes = async (n, kind) => q("select * from scholar_notifications where scholar_id_number = $1 and kind = $2 order by created_at", [num(n), kind]);
const docs = (n, kinds) => kinds.map(k => ({ kind: k, path: `${num(n)}/${W1}/inc-docs/${k}/${crypto.randomUUID()}-f.pdf`, name: `${k}.pdf`, mime: "application/pdf", size: 500 }));
const ALL3 = ["inc_letter", "study_plan", "clearance"];
const apply10 = (n, list) => attempt(uidOf(n), "select public.renewal_apply($1,'S','BS Test Studies','2nd Year','',false,'[]'::jsonb,'[]'::jsonb,false,$2::jsonb) id", [W1, JSON.stringify(list)]);
const exists = sig => q("select to_regprocedure($1) is not null as e", [sig]).then(r => r[0].e);
const SIG10 = "public.renewal_apply(uuid,text,text,text,text,boolean,jsonb,jsonb,boolean,jsonb)";
const DAILY10 = "public.counseling_save_daily_record(uuid,text,text,date,text,text,text,text,integer,boolean)", DAILY11 = "public.counseling_save_daily_record(uuid,text,text,date,text,text,text,text,integer,boolean,date)";
const iso = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

await db.exec(read(UNDO_B)).catch(() => {});      // the harness may already have put the files on: start from the earlier behaviour
await db.exec(read(UNDO_A)).catch(() => {});
console.log("Before the files");
check("the application with the documents does not exist and 'clearance' is not an allowed kind", !(await exists(SIG10)) && !(await exists(DAILY11))
  && await q("insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) select id, scholar_id_number, 'clearance', 'x/y/z', 'a', 'application/pdf', 1 from renewal_records limit 1").then(() => false, () => true));
await db.exec(read(FILE_A)); await db.exec(read(FILE_A));      // safe to run twice
await db.exec(read(FILE_B)); await db.exec(read(FILE_B));
await db.exec(read("supabase_migration_renewal_documents_approver.sql"));      // the file B on its own gives the approval back to the evaluator; the approver file (a later file) puts it with the tag

console.log("\nThe application with an INC");
const before7 = await apply10(7, []);
check("a scholar with an INC cannot submit without the documents", !before7.ok && /You have an INC/.test(before7.msg) && !(await recordOf(7)), before7.msg);
const two = await apply10(7, docs(7, ["inc_letter", "study_plan"]));
check("two of the three documents are not enough (the clearance is missing)", !two.ok && /You have an INC/.test(two.msg) && !(await recordOf(7)), two.msg);
const bad = await apply10(7, [...docs(7, ["inc_letter", "study_plan"]), { ...docs(7, ["clearance"])[0], path: `${num(7)}/other-folder/clearance/f.pdf` }]);
check("a document stored outside the scholar's own folder is refused and nothing is saved", !bad.ok && /not stored in your folder/.test(bad.msg) && !(await recordOf(7)), bad.msg);
const other = await apply10(7, [...docs(7, ["inc_letter", "study_plan"]), { ...docs(7, ["clearance"])[0], path: `${num(8)}/${W1}/inc-docs/clearance/f.pdf` }]);
check("a document in another scholar's folder is refused", !other.ok && !(await recordOf(7)), other.msg);
const ok7 = await apply10(7, docs(7, ALL3));
const r7 = await recordOf(7);
check("with the three documents the application is taken", ok7.ok && !!r7 && r7.stage === "needs_inc_letter_consultation" && r7.rule_code === "D", ok7.msg ?? r7?.stage);
const d7 = await q("select kind, status from renewal_documents where record_id = $1 order by kind", [r7.id]);
check("the three documents are saved with the application, waiting for the evaluator", d7.map(d => d.kind).join() === "clearance,inc_letter,study_plan" && d7.every(d => d.status === "submitted"));
const req7 = r7.evaluation.required_documents;
check("the case lists the INC letter, the study plan and the clearance as needed; all uploaded, none approved yet", req7.map(d => d.kind).sort().join() === "clearance,inc_letter,study_plan" && req7.every(d => d.satisfied === true && d.approved === false), JSON.stringify(req7));
check("the scholar cannot book yet: the evaluator has not approved", ["study_plan_pending", "inc_letter_pending", "clearance_pending"].includes(await stateOf(7)), await stateOf(7));
check("the history says the documents were sent with the application", (await q("select count(*)::int n from renewal_history where record_id = $1 and note like '%INC letter, study plan and clearance%'", [r7.id]))[0].n === 1);

console.log("\nThe evaluator approves; booking opens only when all three are approved");
const byKind = Object.fromEntries((await q("select id, kind from renewal_documents where record_id = $1", [r7.id])).map(d => [d.kind, d.id]));
await rows(DOCS, "select public.renewal_review_document($1, true, '')", [byKind.study_plan]);
await rows(DOCS, "select public.renewal_review_document($1, true, '')", [byKind.inc_letter]);
check("study plan and INC letter approved, the clearance still waits: still cannot book", await stateOf(7) === "clearance_pending", await stateOf(7));
await rows(DOCS, "select public.renewal_review_document($1, true, '')", [byKind.clearance]);
check("all three approved: the scholar can book, and is told so", await stateOf(7) === "ok" && (await notes(7, "document_approved")).some(n => /clearance was approved/.test(n.title) && /book your consultation/.test(n.body)));

console.log("\nA returned clearance");
const ok22 = await apply10(22, docs(22, ALL3));
const r22 = await recordOf(22);
check("a scholar with a failed subject AND an INC also sends the three documents", ok22.ok && r22.rule_code === "B+D" && r22.evaluation.required_documents.map(d => d.kind).sort().join() === "clearance,inc_letter,study_plan", ok22.msg);
const doc22 = (await q("select id from renewal_documents where record_id = $1 and kind = 'clearance'", [r22.id]))[0].id;
const retNoReason = await attempt(DOCS, "select public.renewal_review_document($1, false, '')", [doc22]);
check("returning a clearance needs a reason", !retNoReason.ok && /what to fix/.test(retNoReason.msg));
await rows(DOCS, "select public.renewal_review_document($1, false, 'The clearance is not signed')", [doc22]);
check("a returned clearance sends the scholar to upload a new one before booking", await stateOf(22) === "study_plan_pending" || await stateOf(22) === "inc_letter_pending" || await stateOf(22) === "clearance_missing", await stateOf(22));
for (const kind of ["study_plan", "inc_letter"]) await rows(DOCS, "select public.renewal_review_document($1, true, '')", [(await q("select id from renewal_documents where record_id = $1 and kind = $2", [r22.id, kind]))[0].id]);
const refusal = await db.query("select public._renewal_require_can_book($1)", [r22.id]).then(() => "", e => String(e.message));
check("with the other two approved, booking is refused until a new clearance is uploaded, and says so", await stateOf(22) === "clearance_missing" && /upload your clearance first/.test(refusal), refusal);
check("the scholar is told what to fix", (await notes(22, "document_returned")).some(n => /clearance was returned/.test(n.title) && /not signed/.test(n.body)));

console.log("\nScholars without an INC");
const noInc = await apply10(1, docs(1, ALL3));
check("documents sent by a scholar who has no INC are refused, nothing is saved", !noInc.ok && /No INC was found/.test(noInc.msg) && !(await recordOf(1)), noInc.msg);
const plain = await apply10(1, []);
check("a scholar without an INC applies as before, with no documents", plain.ok && (await recordOf(1)).stage === "ready_for_confirmation", plain.msg);
const old = await attempt(uidOf(3), "select public.renewal_apply($1, 'S', 'BS Test Studies', '2nd Year', '') id", [W1]);
check("the earlier forms of the application still work for a scholar without an INC", old.ok && !!(await recordOf(3)), old.msg);
const direct = await attempt(uidOf(1), "insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'clearance',$3,'c.pdf','application/pdf',500)",
  [(await recordOf(1)).id, num(1), `${num(1)}/${(await recordOf(1)).id}/clearance/x-c.pdf`]);
check("outside the application a clearance is added only when the case needs it", !direct.ok && /not needed/.test(direct.msg), direct.msg);
const viaFolder = await attempt(uidOf(1), "insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'inc_letter',$3,'c.pdf','application/pdf',500)",
  [(await recordOf(1)).id, num(1), `${num(1)}/${W1}/inc-docs/inc_letter/x-c.pdf`]);
check("the window folder for the documents works only inside the application", !viaFolder.ok, viaFolder.msg);

console.log("\nThe INC deadline is a date in the Daily Record");
{
  const mkSlot = async (record, scholar) => {
    const start = new Date(Date.now() - 30 * 60000), end = new Date(start.getTime() + 10 * 60000);
    const av = (await q("insert into counseling_availability (staff_id, starts_at, ends_at) values ($1,$2,$3) returning id", [COUNSELOR, start.toISOString(), end.toISOString()]))[0].id;
    return (await q(`insert into counseling_slots (availability_id, staff_id, starts_at, ends_at, state, record_id, scholar_id_number, booked_at) values ($1,$2,$3,$4,'booked',$5,$6,now()) returning *`,
      [av, COUNSELOR, start.toISOString(), end.toISOString(), record, scholar]))[0];
  };
  const slot = await mkSlot(r7.id, num(7));
  await rows(COUNSELOR, "select public.counseling_mark_slot($1,'attended')", [slot.id]);
  const save = (deadline, days = null) => attempt(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Probationary',current_date,'INC in Math','Will complete','Finish by deadline','Office',$3,null,$4) id", [slot.id, num(7), days, deadline]);
  const none = await save(null);
  check("the form needs the deadline (INC)", !none.ok && /INC deadline/.test(none.msg), none.msg);
  const today = await save((await q("select current_date::text d"))[0].d);
  check("a deadline that is not after the consultation date is refused", !today.ok && /INC deadline/.test(today.msg), today.msg);
  const day = (await q("select (current_date + 15)::text d"))[0].d;
  const good = await save(day);
  check("a deadline date is accepted", good.ok, good.msg);
  const item = (await q("select * from renewal_inc_items where record_id = $1", [r7.id]))[0];
  check("the deadline is exactly the date that was chosen (the days given are worked out: 15)", iso(item.deadline) === day && item.days_given === 15, `${iso(item.deadline)} ${item.days_given}`);
  check("the case waits for INC compliance and the scholar is told the deadline", (await recordOf(7)).stage === "inc_waiting_compliance" && (await notes(7, "inc_deadline_set")).length === 1);
  const dr = (await q("select * from scholar_counseling_records where id = $1", [good.rows[0].id]))[0];
  check("the Daily Record keeps the findings, the recommendations and the days given", dr.findings === "Will complete" && dr.staff_recommendations === "Finish by deadline" && dr.days_given === 15);
  const again = await attempt(COUNSELOR, "select public.counseling_save_daily_record($1,$2,'Probationary',current_date,'','','','Office',5,null) id", [slot.id, num(7)]);
  check("the earlier way of calling the form (days given, no deadline) still works and is not mistaken for another function", !again.ok && /already saved/.test(again.msg), again.msg);
}

console.log("\nThe undo");
await db.exec(read(UNDO_B));
check("after the undo of file B the application with documents and the deadline form are gone and the earlier ones are back", !(await exists(SIG10)) && !(await exists(DAILY11)) && (await exists(DAILY10)));
await db.exec(read(UNDO_A));
await db.exec(read(FILE_A)); await db.exec(read(FILE_B));
check("the files can be put back", (await exists(SIG10)) && (await exists(DAILY11)) && !(await exists(DAILY10)));
const text = (read(FILE_A) + read(FILE_B)).replace(/--.*$/gm, "");
check("nothing is deleted from a table; one table is altered (renewal_documents) and only in file A", !/(drop table|delete from|truncate)/i.test(text) && !/alter table/i.test(read(FILE_B).replace(/--.*$/gm, "")) && (read(FILE_A).match(/alter table/gi) ?? []).length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
