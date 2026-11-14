// tests/academic-status/db_tests.mjs — academic status of a program, the passing GWA (Academic / Non-academic / special program), and the consultation in the renewal (5 checks, short on purpose)
// Run:  node tests/academic-status/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_status.sql", UNDO = "undo_academic_status.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe
const MANAGER = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_management') on conflict do nothing", [MANAGER]);
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions");
const four = (await q("select s.scholar_id_number s, s.course from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 3", [LOWER]));
const [A, B, C] = four.map(r => r.s);
await q("delete from renewal_records where scholar_id_number = any($1::text[]) and school_year = $2 and term = $3", [four.map(r => r.s), Y, T]);
// the three scholars share one program (to be placed by the staff); give C a different program that becomes a SPECIAL program
await q("update scholars set course = 'BS Academic Test Program' where scholar_id_number in ($1, $2)", [A, B]);
await q("update scholars set course = 'BS Special Test Program' where scholar_id_number = $1", [C]);

// 1. only Scholar Management staff; the numbers are checked
const plain = await attempt(PLAIN, "select public.academic_settings_get()");
const bad = await attempt(MANAGER, "select public.academic_settings_save(6, 3)");
const save = await attempt(MANAGER, "select public.academic_settings_save(2.00, 3.00)");
const get = await attempt(MANAGER, "select public.academic_settings_get() g");
const g = get.rows?.[0]?.g;
check("1 only Scholar Management staff can use the settings; a passing GWA must be from 1.00 to 5.00; the tab data lists the programs with their scholars and the schools that are not on the standard scale",
  !plain.ok && /Scholar Management/.test(plain.msg) && !bad.ok && save.ok && !!g && Number(g.academic_passing_gwa) === 2 && Number(g.non_academic_passing_gwa) === 3
  && g.programs.some(p => p.program === "BS Academic Test Program" && p.scholars === 2 && p.is_set === false) && Array.isArray(g.schools_not_standard), `${plain.msg} | ${bad.msg} | ${save.msg} | ${JSON.stringify(g?.programs?.length)}`);
// 2. status of a program; a program not placed counts as academic; a special program has its own passing GWA
const before = (await q("select * from public._scholar_academic($1)", [A]))[0];
await attempt(MANAGER, "select public.academic_program_save('BS Academic Test Program', 'non_academic', null)");
await attempt(MANAGER, "select public.academic_program_save('  bs   special test program ', 'academic', 3.50)");
const afterA = (await q("select * from public._scholar_academic($1)", [A]))[0], afterC = (await q("select * from public._scholar_academic($1)", [C]))[0];
check("2 a program not placed yet counts as Academic (flagged 'not set'); once set the scholar has that status and the group's passing GWA; a special program has its own passing GWA (the program is matched however it is typed)",
  before.academic_status === "academic" && before.is_set === false && Number(before.passing_gwa) === 2 && afterA.academic_status === "non_academic" && Number(afterA.passing_gwa) === 3 && afterC.special === true && Number(afterC.passing_gwa) === 3.5, JSON.stringify([before, afterA, afterC]));
// 3. the renewal: a GWA worse than the passing GWA needs a consultation (no failed subject)
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((gr, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: gr }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const approve = async s => { const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id; await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]); };
await attempt(MANAGER, "select public.academic_program_save('BS Academic Test Program', 'academic', null)");
await attempt(MANAGER, "select public.academic_settings_save(2.00, 3.00)");
await apply(A, ["2.5", "2.75"]); await approve(A);       // GWA 2.63 > the Academic passing GWA 2.00
await apply(C, ["2.5", "2.75"]); await approve(C);       // the special program: its own passing GWA 3.50 (looser), so the same GWA is fine
const ra = await rec(A), rcc = await rec(C);
check("3 a scholar with no failed subject whose GWA (2.63) is worse than the passing GWA of the group (2.00) needs a consultation; the same GWA in a special program with its own looser passing GWA (3.50) does not",
  ra.stage === "needs_gwa_consultation" && ra.consultation_required === true && ra.rule_code === "G" && rcc.stage === "ready_for_confirmation" && rcc.rule_code === "A", `${ra.stage} ${ra.rule_code} | ${rcc.stage} ${rcc.rule_code} | ${JSON.stringify(ra.evaluation?.gwa)} ${JSON.stringify(ra.evaluation?.passing_gwa)}`);
// 4. after the consultation the evaluator can confirm; the evaluator can refer while it waits; changing the setting re-checks the open renewals (in batches)
const canRefer = (await q("select public._renewal_can_refer(r) c from renewal_records r where r.id = $1", [ra.id]))[0].c;
await q("update renewal_records set consultation_done_at = now() where id = $1", [ra.id]);
await q("select public._renewal_recheck($1)", [ra.id]);
await apply(B, ["2.5", "2.75"]); await approve(B);       // Academic, passing GWA 2.00: needs the consultation
const rb1 = await rec(B).then(r => r.stage);
await attempt(MANAGER, "select public.academic_settings_save(3.50, 3.00)");      // looser: B no longer needs it, found by the batch re-check
const n = (await q("select public._academic_recheck_batch(100) n"))[0].n;
const rb2 = await rec(B).then(r => r.stage);
check("4 the evaluator can refer while the consultation is needed; after the consultation the renewal is ready for the evaluator; changing the passing GWA re-checks the open renewals in the background batch",
  canRefer === true && (await rec(A)).stage === "ready_for_confirmation" && rb1 === "needs_gwa_consultation" && n >= 1 && rb2 === "ready_for_confirmation", `${canRefer} ${(await rec(A)).stage} ${rb1} ${n} ${rb2}`);
await db.exec(read(UNDO));
const gone = (await q("select to_regprocedure('public._academic_recheck_batch(integer)') f"))[0].f;
const kept = (await q("select count(*)::int n from academic_programs"))[0].n;
check("5 after the undo the renewal rules are as before (no GWA rule, the new stage is gone, the settings and the programs are kept)", gone === null && kept >= 2 && (await q("select count(*)::int n from renewal_records where stage = 'needs_gwa_consultation'"))[0].n === 0);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
