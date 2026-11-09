// tests/renewal-tag-auto-approve/db_tests.mjs — scholars tagged WITH auto-approve: the entered grades and the SDP reconsideration request are approved by the system (5 checks, short on purpose)
// Run:  node tests/renewal-tag-auto-approve/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
await db.exec(read("undo_entered_grades_e.sql"));      // the later "grades must be in before applying" rule has its own test
await db.exec(read("supabase_migration_renewal_tag_auto_approve.sql")); await db.exec(read("supabase_migration_renewal_tag_auto_approve.sql"));      // twice: safe
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const ITADMIN = seedId("staff:it.admin1");
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
const PERIOD = (await q("select id from academic_periods where school_year = $1 and term = $2", [basis.basis_school_year, basis.basis_term]))[0].id;
await q("delete from school_period_submissions where school_id = $1 and period_id = $2", [LETTERS, PERIOD]);
const ready = [];
for (const s of (await q("select scholar_id_number s from scholars where school_id = $1 and status not in ('Removed', 'On leave') order by 1", [LETTERS])).map(r => r.s)) {
  if ((await q("select count(*)::int n from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0].n === 0) { const r = await attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '') id", [win.id]); if (!r.ok) continue; }
  ready.push(s);
}
if (ready.length < 3) throw new Error("the demo has too few scholars to test with");
const [A, B, C] = ready;
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const files = (s, r) => JSON.stringify([{ path: `${s}/${r.id}/grade-entries/0-shot.png`, name: "shot0.png", mime: "image/png", size: 12345 }]);
const submit = async s => { const r = await rec(s); return attempt(uidOf(s), "select public.renewal_self_grades_submit($1, $2::jsonb, $3::jsonb, true) id", [r.id, JSON.stringify([{ code: "SUBJ1", subject: "Subject 1", units: 3, grade: "A" }]), files(s, r)]); };
const sub = async s => (await q("select status, decided_by_label from renewal_self_grade_submissions where record_id = $1 order by version desc limit 1", [(await rec(s)).id]))[0];
const tag = (ids, auto) => attempt(ITADMIN, "select public.renewal_tag_scholars($1, $2, $3::text[], $4) r", [Y, T, ids, auto]);
// everybody's SDP credits for the semester the renewal looks at are complete except B's (B lacks credits)
await q("delete from sdp_attendance where scholar_id_number = $1 and school_year = $2 and semester = $3", [B, basis.basis_school_year, basis.basis_term]);

console.log("Tagged with auto-approve");
check("1 tagged WITHOUT auto-approve, the entered grades keep waiting for the Grades Approver", (await submit(A)).ok && (await tag([A], false)).ok && (await sub(A)).status === "pending");
const r2 = await tag([A], true);
check("2 tagging the same scholar again WITH auto-approve ('updated') approves the waiting grades by the system", r2.ok && r2.rows[0].r.updated === 1 && (await sub(A)).status === "approved" && (await sub(A)).decided_by_label === "System (auto-approve)", JSON.stringify(r2.rows ?? r2.msg));
await submit(B);
const reqB = (await q("select public._renewal_sdp_request_create($1) id", [(await rec(B)).id]))[0].id;
await tag([B], true);
const stB = (await q("select status, decided_by_label from sdp_reconsideration_requests where id = $1", [reqB]))[0];
check("3 a waiting SDP reconsideration request is approved by the system too (the lacking credits are added to the next semester)", stB.status === "approved" && stB.decided_by_label === "System (auto-approve)" && (await q("select count(*)::int n from sdp_reconsideration_debts where request_id = $1", [reqB]))[0].n >= 1, JSON.stringify(stB));
check("4 the scholars are then renewed automatically (grades approved, SDP approved, nothing failed)", (await rec(A)).stage === "renewed" && (await rec(B)).stage === "renewed", `${(await rec(A)).stage} ${(await rec(B)).stage}`);
await tag([C], true);
await submit(C);
check("5 a scholar tagged BEFORE entering grades: the grades are approved the moment they are sent (and the approvers are not asked)", (await sub(C)).status === "approved" && (await q("select count(*)::int n from scholar_notifications where scholar_id_number = $1 and kind = 'grades_entry_approved'", [C]))[0].n >= 1);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
