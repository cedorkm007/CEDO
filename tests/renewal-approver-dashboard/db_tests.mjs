// tests/renewal-approver-dashboard/db_tests.mjs — the SDP Reconsideration Approver can read the renewal Dashboard (numbers only; not the Excel export)
//   (supabase_migration_renewal_dashboard_for_sdp_approver.sql)      Run:  node tests/renewal-approver-dashboard/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_dashboard_for_sdp_approver.sql", UNDO = "undo_renewal_dashboard_for_sdp_approver.sql";
async function as(uid, fn) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: (await as(uid, async tx => (await tx.query(sql, params)).rows)) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

// as on the real project: the multi-windows files first, then this one
for (const f of ["supabase_migration_renewal_multi_windows_a_constraint.sql", "supabase_migration_renewal_multi_windows_b_functions.sql", FILE]) await db.exec(read(f));
const EVAL = seedId("staff:demo.evaluator"), PLAIN = seedId("staff:demo.plain"), COUNSELOR = seedId("staff:demo.counselor"), SEADHEAD = seedId("staff:demo.seadhead"), ITADMIN = seedId("staff:it.admin1");
const Y = "2026-2027", T = "1st Semester";
const dash = uid => attempt(uid, "select public.renewal_dashboard($1, $2) d", [Y, T]);
const exp = uid => attempt(uid, "select count(*)::int n from public.renewal_export_data($1, $2)", [Y, T]);

check("a staff member with no tag cannot read the dashboard", !(await dash(PLAIN)).ok);
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'sdp_reconsideration_approver') on conflict do nothing", [PLAIN]);
const mine = await dash(PLAIN);
check("tagged as SDP Reconsideration Approver, the same person can read it", mine.ok, mine.msg);
const theirs = await dash(EVAL);
const strip = d => { const x = JSON.parse(JSON.stringify(d)); delete x.generated_at; return JSON.stringify(x); };
check("they see exactly the same numbers as the evaluator", mine.ok && theirs.ok && strip(mine.rows[0].d) === strip(theirs.rows[0].d));
check("it.admin1 (who also decides SDP reconsiderations) can read it too", (await dash(ITADMIN)).ok);
check("the evaluator and the heads of SEAD keep reading it (no change for them)", theirs.ok && (await dash(SEADHEAD)).ok);
const ex = await exp(PLAIN);
check("the Excel export stays closed to the approver (it holds every scholar's details)", !ex.ok && /Not authorized to export/.test(ex.msg), ex.msg);
check("the evaluator can still export", (await exp(EVAL)).ok);
check("a scholar cannot read the dashboard", !(await dash(seedId("scholar:1"))).ok);
check("the approver can read the term's windows (the page needs them to choose a term)", (await attempt(PLAIN, "select count(*)::int n from renewal_windows")).rows?.[0]?.n >= 1);

await db.exec(read(UNDO));
check("the undo takes the dashboard away from the approver again, and leaves it to the others", !(await dash(PLAIN)).ok && (await dash(EVAL)).ok && !(await q("select 1 from pg_proc where proname = 'can_view_renewal_dashboard'")).length);
await db.exec(read(FILE)); await db.exec(read(FILE));
check("it can be put back after the undo, twice is safe", (await dash(PLAIN)).ok);
check("the file replaces functions only (no table is changed, nothing is deleted) and needs the multi-windows file first", !/alter table|drop table|delete from|truncate/i.test(read(FILE)) && /run supabase_migration_renewal_multi_windows_b_functions\.sql first/.test(read(FILE)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
