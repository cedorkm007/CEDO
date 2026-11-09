// tests/renewal-tagged/db_tests.mjs — scholars tagged for AUTOMATIC RENEWAL (supabase_migration_renewal_tagged_scholars.sql) (5 checks, short on purpose)
// Run:  node tests/renewal-tagged/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_tagged_scholars.sql", UNDO = "undo_renewal_tagged_scholars.sql";
// (the demo database already has the tagging file and the files after it: the later auto-approve file changes the tag functions, so this test does not run the tagging file again)
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const ITADMIN = seedId("staff:it.admin1"), PLAIN = seedId("staff:demo.plain"), EVAL = seedId("staff:demo.evaluator");
// a scholar whose grades and SDP are clean (the renewal check says "ready for confirmation"): the demo's late applicant, made a normal submitted application
await q("update renewal_records set stage = 'submitted', is_late = false, late_decision = null where scholar_id_number = 'TEST-0029'");
const ready = (await q("select r.id, r.scholar_id_number s, r.school_year y, r.term t, r.stage, (select status from scholars where scholar_id_number = r.scholar_id_number) st from renewal_records r where r.scholar_id_number = 'TEST-0029'"))[0];
const usual = (await q("select r.id, r.scholar_id_number s, r.school_year y, r.term t, r.stage from renewal_records r where r.stage in ('needs_study_plan_consultation', 'ready_to_endorse', 'needs_consultation_division_head', 'inc_waiting_compliance', 'needs_inc_letter_consultation') and r.term <> 'Summer' limit 1"))[0];
if (!ready || !usual) throw new Error("the demo needs a ready record and a record with a failed or INC subject: " + JSON.stringify({ ready, usual }));
const tag = (uid, r, ids) => attempt(uid, "select public.renewal_tag_scholars($1, $2, $3::text[]) r", [r.y, r.t, ids]);
const stage = async r => (await q("select stage, result, confirmed_by, evaluator_comment from renewal_records where id = $1", [r.id]))[0];

console.log("Who may tag");
const denied = await tag(PLAIN, ready, [ready.s]), evalDenied = await tag(EVAL, ready, [ready.s]);
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'renewal_scholar_tagger') on conflict do nothing", [PLAIN]);
const tagger = await attempt(PLAIN, "select public.can_tag_renewed_scholars() c"), itAdmin = await attempt(ITADMIN, "select public.can_tag_renewed_scholars() c");
check("1 an account without the tag (even the evaluator) is refused; the tagged account and it.admin1 may tag", !denied.ok && !evalDenied.ok && tagger.rows[0].c === true && itAdmin.rows[0].c === true, denied.msg ?? "");

console.log("\nAutomatic renewal");
const before = ready.st;
const res = await tag(ITADMIN, ready, [ready.s.toLowerCase(), "NOT-A-SCHOLAR-1", ready.s]);
const after = await stage(ready);
check("2 tagging a scholar who is ready renews them at once, by the system, with the status unchanged; unknown IDs are reported, a repeated ID counts once", res.ok && res.rows[0].r.tagged === 1 && res.rows[0].r.not_found.length === 1 && after.stage === "renewed" && after.result === "renewed" && after.confirmed_by === null && /automatically/.test(after.evaluator_comment)
  && (await q("select status from scholars where scholar_id_number = $1", [ready.s]))[0].status === before, JSON.stringify(res.rows ?? res.msg));
const res2 = await tag(ITADMIN, usual, [usual.s]);
check("3 a tagged scholar with a failed or INC subject is NOT renewed automatically: the usual process stays (stage unchanged)", res2.ok && res2.rows[0].r.tagged === 1 && (await stage(usual)).stage === usual.stage, JSON.stringify(res2.rows ?? res2.msg));

console.log("\nOne term, the list and the undo");
const other = await attempt(ITADMIN, "select * from public.renewal_tagged_list($1, '1st Semester', null, 25, 0)", ["1999-2000"]);
const mine = await attempt(EVAL, "select * from public.renewal_tagged_list($1, $2, null, 25, 0)", [ready.y, ready.t]);
const gone = await attempt(ITADMIN, "select public.renewal_untag_scholars($1, $2, $3::text[]) n", [usual.y, usual.t, [usual.s]]);
check("4 a tag counts for its own term only; the evaluator can read the list; removing a tag works (and a stranger cannot remove)", other.ok && other.rows.length === 0 && mine.ok && mine.rows.some(r => r.scholar_id_number === ready.s && r.renewed === true) && gone.ok && gone.rows[0].n === 1
  && !(await attempt(EVAL, "select public.renewal_untag_scholars($1, $2, $3::text[])", [usual.y, usual.t, [ready.s]])).ok);
await db.exec(read("undo_renewal_tag_auto_approve.sql"));      // the later file is undone first
await db.exec(read(UNDO));
const stillThere = (await q("select to_regclass('public.renewal_tagged_scholars') t"))[0].t;
check("5 the undo removes the tagging (the table is gone) and the re-check works as before", stillThere === null && (await q("select public._renewal_recheck($1)", [usual.id])).length === 1);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
