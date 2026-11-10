// tests/renewal-revert/keep_sdp_db_tests.mjs — "Revert application" with an APPROVED SDP reconsideration: allowed, the approval stays, and it attaches to the next application (5 checks, short on purpose)
// Run:  node tests/renewal-revert/keep_sdp_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_revert_keep_sdp_approval.sql", UNDO = "undo_renewal_revert_keep_sdp_approval.sql";
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const EVAL = seedId("staff:demo.evaluator");
const idOf = n => `TEST-${String(n).padStart(4, "0")}`, uidOf = n => seedId(`scholar:${n}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const rec = async n => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [idOf(n), Y, T]))[0];
const revert = id => attempt(EVAL, "select public.renewal_revert_application($1, 'Reverted to let the scholar apply again') r", [id]);

// scholar 44 (two failed): an application whose SDP reconsideration was approved (the lacking credits were added to the next semester)
const r44 = await rec(44), basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const reqId = (await q(`insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, status, lacking)
  values ($1, $2, $3, $4, $5, $6, 'approved', '{"community_service":1,"community_volunteerism":0,"formation_program":0}'::jsonb) returning id`, [idOf(44), Y, T, r44.id, basis.basis_school_year, basis.basis_term]))[0].id;
const next = (await q("select * from public._sdp_next_semester($1, $2)", [basis.basis_school_year, basis.basis_term]))[0];
await q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, 'community_service', 1, $3, $4)", [reqId, idOf(44), next.school_year, next.semester]);

console.log("Reverting with an approved SDP reconsideration");
const r = await revert(r44.id);
check("1 the revert is allowed; the application is gone and the approval stays approved with its credits (detached from the removed application)",
  r.ok && !(await rec(44)) && (await q("select status, record_id from sdp_reconsideration_requests where id = $1", [reqId]))[0].status === "approved" && (await q("select record_id from sdp_reconsideration_requests where id = $1", [reqId]))[0].record_id === null
  && Number((await q("select count(*) n from sdp_reconsideration_debts where request_id = $1", [reqId]))[0].n) === 1, r.msg);
check("2 the scholar is told to apply again and that the approved SDP reconsideration stays approved (no need to ask again)",
  Number((await q("select count(*) n from scholar_notifications where scholar_id_number = $1 and body like '%approved SDP reconsideration stays approved%'", [idOf(44)]))[0].n) >= 1 && r.rows[0].r.sdp_approval_kept === true);
const again = await attempt(uidOf(44), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]);
const newRec = again.ok ? await rec(44) : null;
check("3 when the scholar applies again the kept approval is attached to the new application, and the SDP counts as approved (nothing to ask again)",
  again.ok && !!newRec && (await q("select record_id from sdp_reconsideration_requests where id = $1", [reqId]))[0].record_id === newRec.id
  && (await q("select public._renewal_evaluate($1, $2, $3) e", [idOf(44), Y, T]))[0].e.sdp.complied === true, again.msg);

// a WAITING request is still removed with the application (as before)
const r43 = await rec(42);
const waitId = (await q(`insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, status, lacking)
  values ($1, $2, $3, $4, $5, $6, 'pending', '{"community_service":1}'::jsonb) returning id`, [idOf(42), Y, T, r43.id, basis.basis_school_year, basis.basis_term]))[0].id;
const rw = await revert(r43.id);
check("4 a waiting SDP reconsideration request is still removed with the application", rw.ok && Number((await q("select count(*) n from sdp_reconsideration_requests where id = $1", [waitId]))[0].n) === 0, rw.msg);
await db.exec(read(UNDO));
const back = await rec(44);
const refused = await revert(back.id);
check("5 after the undo an application with an approved SDP reconsideration is refused again", !refused.ok && /SDP reconsideration was approved/.test(refused.msg), refused.msg);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
