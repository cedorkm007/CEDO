// tests/renewal-revert/db_tests.mjs — "Revert application" (supabase_migration_renewal_revert_application.sql)
// Run:  node tests/renewal-revert/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_renewal_revert_application.sql", UNDO = "undo_renewal_revert_application.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const run = async sql => { try { await db.exec(sql); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

await db.exec(read(FILE)); await db.exec(read(FILE));      // twice is safe
await db.exec(read("supabase_migration_renewal_revert_keep_sdp_approval.sql"));      // the later file: an approved SDP reconsideration no longer blocks the revert
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), DH = seedId("staff:demo.divhead");
const idOf = n => `TEST-${String(n).padStart(4, "0")}`, uidOf = n => seedId(`scholar:${n}`);
const rec = async (n, year = "2026-2027", term = "1st Semester") => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [idOf(n), year, term]))[0];
const count = async (sql, p = []) => Number((await q(sql, p))[0].n);
const revert = (uid, id, reason = "Confirmed by mistake") => attempt(uid, "select public.renewal_revert_application($1, $2) r", [id, reason]);

console.log("Who can revert, and what it asks");
const r46 = await rec(46);
check("the demo has a confirmed (renewed) application", r46?.stage === "renewed");
check("a scholar, the counselor and the Division Head cannot revert", !(await revert(uidOf(46), r46.id)).ok && !(await revert(COUNSELOR, r46.id)).ok && !(await revert(DH, r46.id)).ok);
check("a reason of at least 5 characters is needed", /at least 5 characters/.test((await revert(EVAL, r46.id, "no")).msg ?? "") && !!(await rec(46)));
check("a record that does not exist says so", /not found/.test((await revert(EVAL, "00000000-0000-0000-0000-000000000000")).msg ?? ""));

console.log("\nReverting a confirmed application");
// give it company: a certificate record, a booked consultation time, a notice
await q("insert into csr_issued (csr_number, version, record_id, scholar_id_number, school_year, term, snapshot, storage_path) values ('CSR-TEST-1', 1, $1, $2, '2026-2027', '1st Semester', '{}'::jsonb, 'x.pdf')", [r46.id, idOf(46)]);
const slot = (await q("select id from counseling_slots where state = 'open' limit 1"))[0];
if (slot) await q("update counseling_slots set state = 'booked', record_id = $2, scholar_id_number = $3, booked_at = now() where id = $1", [slot.id, r46.id, idOf(46)]);
const statusBefore = (await q("select status from scholars where scholar_id_number = $1", [idOf(46)]))[0].status;
const credits = await count("select count(*) n from sdp_attendance where scholar_id_number = $1", [idOf(46)]);
const others = await count("select count(*) n from renewal_records where scholar_id_number <> $1", [idOf(46)]);
const done = await revert(EVAL, r46.id, "Confirmed by mistake");
check("the evaluator reverts it", done.ok, done.msg);
check("the application is gone, so the scholar can apply again", !(await rec(46)));
check("its history, documents, notices and certificate records went with it", await count("select count(*) n from renewal_history where record_id = $1", [r46.id]) === 0 && await count("select count(*) n from csr_issued where record_id = $1", [r46.id]) === 0 && await count("select count(*) n from scholar_notifications where record_id = $1", [r46.id]) === 0);
check("a booked consultation time is free again", !slot || (await q("select state from counseling_slots where id = $1", [slot.id]))[0].state === "open");
check("nothing else changed: the status, the SDP credits and every other renewal are as they were", (await q("select status from scholars where scholar_id_number = $1", [idOf(46)]))[0].status === statusBefore
  && await count("select count(*) n from sdp_attendance where scholar_id_number = $1", [idOf(46)]) === credits && await count("select count(*) n from renewal_records where scholar_id_number <> $1", [idOf(46)]) === others);
check("the scholar is told to apply again", (await q("select title from scholar_notifications where scholar_id_number = $1 order by created_at desc limit 1", [idOf(46)]))[0]?.title === "Your renewal was reset");
const log = (await q("select * from renewal_reverts"))[0];
check("a log line says who, when, which scholar and term, the stage it was in and why (and keeps no copy of the application)", log && log.scholar_id_number === idOf(46) && log.previous_stage === "renewed" && log.reason === "Confirmed by mistake" && /Evaluator/.test(log.by_name) && Number(log.certificates_removed) === 1
  && !Object.keys(log).some(k => /data|snapshot|json/.test(k)));
check("the log can be read by renewal staff but not by a scholar", (await rows(EVAL, "select count(*)::int n from renewal_reverts"))[0].n === 1 && (await rows(uidOf(1), "select count(*)::int n from renewal_reverts"))[0].n === 0);
check("reverting the same application again says it was not found", /not found/.test((await revert(EVAL, r46.id)).msg ?? ""));
const canApply = await attempt(uidOf(46), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') r", [r46.window_id]);
check("the scholar can apply again (from nothing)", canApply.ok && (await rec(46))?.stage !== undefined, canApply.msg);

console.log("\nCases it refuses (nothing changes)");
const r39 = await rec(39);          // a study plan waiting for approval: still in progress
check("a case in progress can be reverted too (an application made by mistake)", r39 && (await revert(EVAL, r39.id, "Applied by mistake")).ok && !(await rec(39)));
const r45 = await rec(45);        // reconsidered by the Division Head
if (r45) { const x = await revert(EVAL, r45.id); check("a case the Division Head decided is refused", !x.ok && /Division Head/.test(x.msg), x.msg); }
const r43 = await rec(43);
await q("insert into scholar_status_history (scholar_id_number, status, previous_status, school_year, term, source) values ($1, 'Probationary', 'Regular', '2026-2027', '1st Semester', 'renewal')", [idOf(43)]);
const st = await revert(EVAL, r43.id);
check("a renewal that changed the scholar's status is refused, with the reason", !st.ok && /changed the scholar's scholarship status/.test(st.msg) && !!(await rec(43)), st.msg);
const r44 = await rec(44);
await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, status, lacking) values ($1, '2026-2027', '1st Semester', $2, '2025-2026', '2nd Semester', 'approved', '{\"community_service\":1}'::jsonb) on conflict do nothing", [idOf(44), r44.id]);
const rc = await revert(EVAL, r44.id);
check("a renewal with an APPROVED SDP reconsideration CAN be reverted now: the application is removed and the approval stays (detached, still approved)", rc.ok && !(await rec(44)) && (await count("select count(*) n from sdp_reconsideration_requests where scholar_id_number = $1 and status = 'approved' and record_id is null", [idOf(44)])) === 1, rc.msg);
await q("update scholars set status = 'Removed' where scholar_id_number = $1", [idOf(41)]);
const r41 = await rec(41);
check("a removed scholar's renewal is refused", r41 && !(await revert(EVAL, r41.id)).ok && !!(await rec(41)));

console.log("\nThe files");
check("nothing in the migration alters an existing table, and nothing is backed up", !/alter table public.(?!renewal_reverts)/i.test(read(FILE)) && !/backup/i.test(read(FILE).replace(/--.*$/gm, "")));
await db.exec(read(UNDO));
check("the undo removes the functions and the log", !(await q("select 1 from pg_proc where proname in ('renewal_revert_application', '_renewal_revert_record')")).length && !(await q("select to_regclass('public.renewal_reverts') t"))[0].t);
await db.exec(read(FILE));
check("they can be put back after the undo", (await q("select 1 from pg_proc where proname = 'renewal_revert_application'")).length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
