// tests/inc-documents/lock_db_tests.mjs — an approved study plan, INC letter or clearance is final (supabase_migration_inc_docs_c_lock_approved.sql)
// Run:  node tests/inc-documents/lock_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import { useLegacySlots } from "../renewal/db/legacy_slots.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await useLegacySlots(db);
const read = f => fs.readFileSync(f, "utf8");
const FILE_C = "supabase_migration_inc_docs_c_lock_approved.sql", UNDO_C = "undo_inc_docs_c.sql";

const num = n => `TEST-${String(n).padStart(4, "0")}`;
const uidOf = n => seedId(`scholar:${n}`);
const EVAL = seedId("staff:demo.evaluator");
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
const docs = (n, kinds) => kinds.map(k => ({ kind: k, path: `${num(n)}/${W1}/inc-docs/${k}/${crypto.randomUUID()}-f.pdf`, name: `${k}.pdf`, mime: "application/pdf", size: 500 }));
const ALL3 = ["inc_letter", "study_plan", "clearance"];
const INSERT = "insert into renewal_documents (record_id, scholar_id_number, kind, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,$4,'again.pdf','application/pdf',500)";
const addAgain = (n, rec, kind) => attempt(uidOf(n), INSERT, [rec.id, num(n), kind, `${num(n)}/${rec.id}/${kind}/${crypto.randomUUID()}-again.pdf`]);

await db.exec(read(UNDO_C)).catch(() => {});      // the harness may already have put the file on: start from the earlier behaviour
console.log("Before the file");
const apply = await attempt(uidOf(7), "select public.renewal_apply($1,'S','BS Test Studies','2nd Year','',false,'[]'::jsonb,'[]'::jsonb,false,$2::jsonb) id", [W1, JSON.stringify(docs(7, ALL3))]);
const rec = await recordOf(7);
check("a scholar with an INC applies with the three documents", apply.ok && !!rec, apply.msg);
const ids = Object.fromEntries((await q("select id, kind from renewal_documents where record_id = $1", [rec.id])).map(d => [d.kind, d.id]));
const approve = await attempt(EVAL, "select public.renewal_review_document($1, true, '')", [ids.study_plan]);
check("the evaluator approves the study plan", approve.ok && (await q("select status from renewal_documents where id = $1", [ids.study_plan]))[0].status === "accepted", approve.msg);
const before = await addAgain(7, rec, "study_plan");
check("without the new file another study plan could still be added after the approval (the case in the report)", before.ok, before.msg);
await q("delete from renewal_documents where record_id = $1 and file_name = 'again.pdf'", [rec.id]);

await db.exec(read(FILE_C)); await db.exec(read(FILE_C));      // safe to run twice
console.log("\nAfter the file");
const after = await addAgain(7, rec, "study_plan");
check("an approved study plan: no other file can be added", !after.ok && /already been approved/.test(after.msg), after.msg);
const clr = await addAgain(7, rec, "clearance");
check("a clearance that is only received (not approved) can still get another file", clr.ok, clr.msg);
const del = await attempt(uidOf(7), "delete from renewal_documents where id = $1 returning id", [ids.study_plan]);
check("the approved study plan cannot be removed either", del.ok && del.rows.length === 0 && (await q("select count(*)::int n from renewal_documents where id = $1", [ids.study_plan]))[0].n === 1, del.msg);
await attempt(EVAL, "select public.renewal_review_document($1, true, '')", [ids.inc_letter]);
const inc = await addAgain(7, rec, "inc_letter");
check("the same for an approved INC letter", !inc.ok && /already been approved/.test(inc.msg), inc.msg);
const other = await addAgain(7, rec, "prospectus");
check("a kind that needs no approval is not touched by the rule (the case does not ask for one here)", !other.ok && !/already been approved/.test(other.msg), other.msg);
const counts = await q("select kind, count(*)::int n from renewal_documents where record_id = $1 group by kind order by kind", [rec.id]);
check("nothing was added or lost by the refused tries", counts.map(c => `${c.kind}:${c.n}`).join() === "clearance:2,inc_letter:1,study_plan:1", JSON.stringify(counts));

console.log("\nThe undo and the file");
await db.exec(read(UNDO_C));
const undone = await addAgain(7, rec, "study_plan");
check("after the undo another file can be added again", undone.ok, undone.msg);
const text = read(FILE_C).replace(/--.*$/gm, "");
check("the file replaces one function only: no table is changed or emptied", !/(alter table|drop table|delete from|truncate|create table)/i.test(text) && (text.match(/create or replace function/gi) ?? []).length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
await db.close?.();
