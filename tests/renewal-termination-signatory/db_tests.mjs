// tests/renewal-termination-signatory/db_tests.mjs — a Removed endorsement approved by the evaluator: who signs the termination form is chosen from a list, and the form's data and list (5 checks, short on purpose)
// Run:  node tests/renewal-termination-signatory/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_renewal_termination_signatory.sql", UNDO = "undo_renewal_termination_signatory.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const EVAL = seedId("staff:demo.evaluator"), COUNSELOR = seedId("staff:demo.counselor"), DH = seedId("staff:demo.divhead"), PLAIN = seedId("staff:demo.plain");
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const LETTERS = (await q("select id from schools where name like '%Letter-Grade%'"))[0].id;
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions where school_id = $1", [LETTERS]);
const [A, B, C] = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status not in ('Removed', 'On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 3", [LETTERS, Y, T])).map(r => r.s);
const apply = s => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify([{ code: "S1", subject: "Subject One", units: 3, grade: "F" }, { code: "S2", subject: "Subject Two", units: 3, grade: "F" }]), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const readyToApprove = async s => { await apply(s); const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id; await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]); const r = await rec(s); await q("update renewal_records set consultation_done_at = now() where id = $1", [r.id]); await q("select public._renewal_recheck($1)", [r.id]); const r2 = await rec(s); await attempt(COUNSELOR, "select public.renewal_endorse_status($1, 'Removed', 'Two failed subjects; the scholar did not improve')", [r2.id]); return rec(s); };
const approve = (id, key) => attempt(EVAL, "select public.renewal_approve_endorsement($1, 'ok', null, $2)", [id, key]);
const status = async s => (await q("select status from scholars where scholar_id_number = $1", [s]))[0].status;
const optionsOf = async uid => attempt(uid, "select * from public.renewal_termination_signatories()");

// 1. the list: the Division Head by name, the City Education and Development Officer by name, then every staff member tagged for the Scholar Renewal; only the evaluator sees it
const opts = await optionsOf(EVAL), denied = await optionsOf(PLAIN);
const keys = (opts.rows ?? []).map(o => o.key);
check("1 the evaluator gets the list of who can sign: 'Division Head: <name>' first, then 'City Education and Development Officer: <name>' (from the Certificate settings), then the staff tagged Scholar Renewal Evaluator; other staff are refused",
  opts.ok && /^Division Head: /.test(opts.rows[0].label) && opts.rows[0].key.startsWith("division_head:") && keys.indexOf("officer") === keys.filter(k => k.startsWith("division_head:")).length && /^City Education and Development Officer: /.test(opts.rows[keys.indexOf("officer")].label)
  && keys.includes(`staff:${EVAL}`) && keys.includes(`division_head:${DH}`) && !denied.ok, JSON.stringify(opts.rows?.map(o => o.label) ?? opts.msg));

// 2. a Removed endorsement cannot be approved without choosing who signs (the scholar stays); with a name from the list it is approved and the choice is kept and written to the history
const a1 = await readyToApprove(A);
const none = await approve(a1.id, null), bad = await approve(a1.id, "staff:00000000-0000-0000-0000-000000000000"), stillThere = await status(A);
const ok = await approve(a1.id, "officer"); const a2 = await rec(A);
check("2 approving a Removed endorsement without choosing who signs (or with someone not on the list) is refused and nothing changes; with 'officer' chosen the scholar is Removed, the choice is kept (name and title) and the history says who signs",
  !none.ok && /who signs/i.test(none.msg) && !bad.ok && stillThere !== "Removed" && ok.ok && a2.stage === "removed" && a2.termination_signatory_kind === "officer" && /Richel/.test(a2.termination_signatory_name) && (await status(A)) === "Removed"
  && Number((await q("select count(*)::int n from renewal_history where record_id = $1 and note like '%The termination form is signed by%'", [a1.id]))[0].n) === 1, `${none.msg} ${bad.msg} ${ok.msg} ${a2.stage}`);

// 3. the form's data: who may read it, what is on it; for the Officer only one signature block (no 'Noted by' person), for the Division Head or a staff member that person is the one who notes it
const b1 = await readyToApprove(B); await approve(b1.id, `division_head:${DH}`);
const c1 = await readyToApprove(C); await approve(c1.id, `staff:${EVAL}`);
const fA = await attempt(EVAL, "select public.renewal_removal_form_data($1) d", [a1.id]), fB = await attempt(COUNSELOR, "select public.renewal_removal_form_data($1) d", [b1.id]), fC = await attempt(EVAL, "select public.renewal_removal_form_data($1) d", [c1.id]);
const other = await attempt(PLAIN, "select public.renewal_removal_form_data($1) d", [a1.id]);
const dA = fA.rows?.[0]?.d, dB = fB.rows?.[0]?.d, dC = fC.rows?.[0]?.d;
check("3 the form's data is for the evaluator and the consultation staff member who endorsed it (other staff are refused): it has the scholar, the failed subjects with their names, the issue date and the chosen signatory (Officer: only the Officer's block; Division Head and staff: that person's name and title in the 'Noted by' block)",
  fA.ok && fB.ok && fC.ok && !other.ok && dA.division_head === null && dA.signatory_kind === "officer" && /Richel/.test(dA.officer.name) && dA.failed.length === 2 && dA.failed[0].subject === "Subject One" && !!dA.issued_on
  && dB.division_head.name.length > 3 && dB.division_head.title.startsWith("Head, Scholarships") && dC.division_head.title === "Scholar Renewal Evaluator" && dC.division_head.name.length > 3, `${fA.msg} ${fB.msg} ${fC.msg} ${JSON.stringify(dB?.division_head)}`);

// 4. the consultation staff member's list of termination forms also has these removals (form_kind 'record', state 'done') next to the Division Head ones ('referral')
const list = await attempt(COUNSELOR, "select * from public.consult_removal_forms()");
const recs = (list.rows ?? []).filter(r => r.form_kind === "record");
check("4 the consultation staff member's list of termination forms also shows the removals they endorsed (kind 'record', state 'done'), and the list still works for the Division Head forms",
  list.ok && recs.length === 3 && recs.every(r => r.state === "done") && recs.some(r => r.scholar_id_number === A) && (list.rows ?? []).every(r => ["record", "referral"].includes(r.form_kind)), JSON.stringify(list.rows?.map(r => r.form_kind) ?? list.msg));

// 5. the undo: the old approval and the old list come back (no signatory, no 'form_kind'); no record is deleted
const records = Number((await q("select count(*)::int n from renewal_records"))[0].n);
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const sigs = (await q("select to_regprocedure('public.renewal_approve_endorsement(uuid,text,text,text)') n, to_regprocedure('public.renewal_approve_endorsement(uuid,text,text)') o, to_regprocedure('public.renewal_removal_form_data(uuid)') f"))[0];
const list2 = await attempt(COUNSELOR, "select * from public.consult_removal_forms()");
check("5 after the undo the approval is back to its earlier form, the new functions are gone, the list has no 'form_kind' again, and no record is deleted",
  sigs.n === null && sigs.o !== null && sigs.f === null && list2.ok && !(list2.rows ?? []).some(r => "form_kind" in r) && Number((await q("select count(*)::int n from renewal_records"))[0].n) === records, JSON.stringify(sigs));
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
