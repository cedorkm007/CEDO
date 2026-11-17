// tests/sdp-reconsideration-note/db_tests.mjs — which scholars on a Checklist page have an approved SDP reconsideration (supabase_migration_sdp_checklist_reconsideration_note.sql), 4 checks
// Run:  node tests/sdp-reconsideration-note/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_checklist_reconsideration_note.sql", UNDO = "undo_sdp_checklist_reconsideration_note.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(FILE)); await db.exec(read(FILE));      // twice: safe
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain");
const num = n => `TEST-${String(n).padStart(4, "0")}`;
const BY = "2031-2032", BT = "1st Semester";           // the semester whose SDP was lacking (the 'basis'), made-up years
const mk = (n, status, basisYear = BY, basisTerm = BT) => q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term, status, lacking) values ($1, '2031-2032', $2, $3, $4, $5, '{}'::jsonb) on conflict (scholar_id_number, school_year, term) do update set status = excluded.status, basis_school_year = excluded.basis_school_year, basis_term = excluded.basis_term", [num(n), `req-${n}`, basisYear, basisTerm, status]);
await mk(1, "approved"); await mk(2, "approved"); await mk(3, "pending"); await mk(4, "denied"); await mk(5, "approved", "2031-2032", "2nd Semester");   // 5 is approved for ANOTHER semester
const ids = [1, 2, 3, 4, 5, 6].map(num);
const ask = (uid, year, term, list) => attempt(uid, "select * from public.scholars_sdp_reconsidered($1, $2, $3)", [year, term, list]);

const plain = await ask(PLAIN, BY, BT, ids);
check("1 only SDP Monitoring staff can ask", !plain.ok && /Not authorized/.test(plain.msg), plain.msg);
const r = await ask(SEAD, BY, BT, ids);
check("2 it names only the scholars on the page whose reconsideration for THIS semester is approved (not pending, not denied, not approved for another semester, not someone without a request)",
  r.ok && r.rows.map(x => x.scholar_id_number).sort().join() === [num(1), num(2)].join(), JSON.stringify(r.rows ?? r.msg));
const part = await ask(SEAD, BY, BT, [num(2), num(6)]), other = await ask(SEAD, BY, "2nd Semester", ids), empty = await ask(SEAD, BY, BT, []);
check("3 only the scholars it is asked about are looked at (page by page); another semester gives another answer; an empty page gives nothing",
  part.rows.map(x => x.scholar_id_number).join() === num(2) && other.rows.map(x => x.scholar_id_number).join() === num(5) && empty.rows.length === 0);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public.scholars_sdp_reconsidered(text,text,text[])') f"))[0].f;
check("4 after the undo the function is gone and the reconsiderations are untouched", gone === null && Number((await q("select count(*)::int n from sdp_reconsideration_requests where status = 'approved' and basis_school_year = $1", [BY]))[0].n) === 3);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
