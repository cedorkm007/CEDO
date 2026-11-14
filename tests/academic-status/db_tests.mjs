// tests/academic-status/db_tests.mjs — the academic status of a program and the passing GWA, SET PER SCHOOL (on the school's own scale), and the consultation in the renewal (5 checks, short on purpose)
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
const FIRST = "supabase_migration_academic_status.sql", NEW = "supabase_migration_academic_per_school.sql", UNDO = "undo_academic_per_school.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const MANAGER = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholar_management') on conflict do nothing", [MANAGER]);
const uidOf = s => seedId(`scholar:${Number(s.split("-")[1])}`);
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const HIGHER = (await q("select id from schools where name like '%Higher-Is-Better%'"))[0].id;
const win = (await q(`select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1`))[0];
await q("update renewal_windows set testers = null, school_ids = null, opens_on = current_date - 3, closes_on = current_date + 20, late_allowed = true where id = $1", [win.id]).catch(() => {});
const Y = win.school_year, T = win.term;
const basis = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
await q("insert into academic_periods (school_year, term, status) values ($1, $2, 'open') on conflict (school_year, term) do nothing", [basis.basis_school_year, basis.basis_term]);
await q("delete from school_period_submissions");
const [A, B, C] = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 3", [LOWER])).map(r => r.s);
const [H1, H2] = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 2", [HIGHER])).map(r => r.s);
await q("delete from renewal_records where scholar_id_number = any($1::text[]) and school_year = $2 and term = $3", [[A, B, C, H1, H2], Y, T]);
await q("update scholars set course = 'BS Academic Test Program' where scholar_id_number in ($1, $2, $3)", [A, B, H1]);
await q("update scholars set course = 'BS Special Test Program' where scholar_id_number = $1", [C]);
await q("update scholars set course = 'BS Higher Only Program' where scholar_id_number = $1", [H2]);

// 1. what the first version saved (one passing GWA, programs without a school) is copied to the schools; running it twice is safe
await q("delete from academic_school_settings"); await q("delete from academic_school_programs");
await q("update academic_gwa_settings set academic_passing_gwa = 2.00, non_academic_passing_gwa = 3.00");
await q("insert into academic_programs (program_key, program, academic_status) values ('bs academic test program', 'BS Academic Test Program', 'non_academic') on conflict (program_key) do update set academic_status = 'non_academic'");
await q("insert into academic_programs (program_key, program, academic_status, special_passing_gwa) values ('bs special test program', 'BS Special Test Program', 'academic', 3.5) on conflict (program_key) do update set special_passing_gwa = 3.5");
await db.exec(read(NEW)); await db.exec(read(NEW));
const lowCopy = (await q("select * from academic_school_settings where school_id = $1", [LOWER]))[0];
const highCopy = (await q("select * from academic_school_settings where school_id = $1", [HIGHER]))[0];
const progCopy = await q("select school_id, program_key from academic_school_programs order by 2");
check("1 the numbers and programs of the first version are copied to the schools (the passing GWAs only to the schools on the standard scale; a program only to a school that has scholars in it), and running the update twice changes nothing more",
  Number(lowCopy?.academic_passing_gwa) === 2 && Number(lowCopy?.non_academic_passing_gwa) === 3 && !highCopy
  && progCopy.some(p => p.school_id === LOWER && p.program_key === "bs special test program") && progCopy.some(p => p.school_id === HIGHER && p.program_key === "bs academic test program") && !progCopy.some(p => p.school_id === HIGHER && p.program_key === "bs special test program") && progCopy.length === 3, JSON.stringify([lowCopy, highCopy, progCopy.length]));

// 2. the tab: only Scholar Management staff; the schools with their own scale; the programs are those of the chosen school; a passing GWA must be on the school's own scale
await q("delete from academic_school_settings"); await q("delete from academic_school_programs");
await q("insert into schools (name) values ('TEST – No Grading Setup School') on conflict do nothing");
const NOSETUP = (await q("select id from schools where name = 'TEST – No Grading Setup School'"))[0].id;
const plain = await attempt(PLAIN, "select public.academic_settings_get($1)", [LOWER]);
const gl = (await attempt(MANAGER, "select public.academic_settings_get($1) g", [LOWER])).rows?.[0]?.g, gh = (await attempt(MANAGER, "select public.academic_settings_get($1) g", [HIGHER])).rows?.[0]?.g;
const sl = gl?.schools?.find(s => s.id === LOWER), sh = gl?.schools?.find(s => s.id === HIGHER);
const badLow = await attempt(MANAGER, "select public.academic_settings_save($1, 80, null)", [LOWER]);
const badHigh = await attempt(MANAGER, "select public.academic_settings_save($1, 3, null)", [HIGHER]);
const noSetup = await attempt(MANAGER, "select public.academic_settings_save($1, 2, null)", [NOSETUP]);
const okLow = await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
const okHigh = await attempt(MANAGER, "select public.academic_settings_save($1, 90, 80)", [HIGHER]);
check("2 only Scholar Management staff can use it; each school shows its own scale (1-5 lower is better, 60-100 higher is better); the programs listed are those of the chosen school only; a passing GWA outside the school's scale or for a school with no grading setup is refused",
  !plain.ok && /Scholar Management/.test(plain.msg) && sl?.has_setup && Number(sl.scale_max) === 5 && sl.direction === "lower_is_better" && sh?.has_setup && Number(sh.scale_min) === 60 && sh.direction === "higher_is_better"
  && gl.school === LOWER && gl.programs.some(p => p.program === "BS Academic Test Program" && p.scholars === 2) && !gl.programs.some(p => p.program === "BS Higher Only Program")
  && gh.programs.some(p => p.program === "BS Higher Only Program") && !gh.programs.some(p => p.program === "BS Special Test Program")
  && !badLow.ok && !badHigh.ok && !noSetup.ok && /no grading setup/.test(noSetup.msg) && okLow.ok && okHigh.ok, `${plain.msg} | ${badLow.msg} | ${badHigh.msg} | ${noSetup.msg} | ${okLow.msg} ${okHigh.msg}`);

// 3. the same program is placed differently in two schools; a program not placed counts as Academic; a special program has its own passing GWA
const before = (await q("select * from public._scholar_academic($1)", [A]))[0];
await attempt(MANAGER, "select public.academic_program_save($1, 'BS Academic Test Program', 'non_academic', null)", [LOWER]);
await attempt(MANAGER, "select public.academic_program_save($1, 'BS Academic Test Program', 'academic', null)", [HIGHER]);
await attempt(MANAGER, "select public.academic_program_save($1, '  bs   special test program ', 'academic', 3.50)", [LOWER]);
const lowA = (await q("select * from public._scholar_academic($1)", [A]))[0], highH1 = (await q("select * from public._scholar_academic($1)", [H1]))[0], spC = (await q("select * from public._scholar_academic($1)", [C]))[0];
const map = (await attempt(MANAGER, "select * from public.academic_status_map()")).rows;
check("3 a program not placed counts as Academic (flagged 'not set'); the same program name is Non-academic in one school (its own passing GWA 3.00) and Academic in another (90.00); a special program has its own passing GWA; the Information list gets the status per school",
  before.academic_status === "academic" && before.is_set === false && Number(before.passing_gwa) === 2
  && lowA.academic_status === "non_academic" && Number(lowA.passing_gwa) === 3 && highH1.academic_status === "academic" && Number(highH1.passing_gwa) === 90 && spC.special === true && Number(spC.passing_gwa) === 3.5
  && map.some(r => /Lower-Is-Better/.test(r.school_name) && r.program_key === "bs academic test program" && r.academic_status === "non_academic") && map.some(r => /Higher-Is-Better/.test(r.school_name) && r.program_key === "bs academic test program" && r.academic_status === "academic"), JSON.stringify([before, lowA, highH1, spC]));

// 4. the renewal: a GWA worse than the passing GWA of the school (on its own scale and direction) needs a consultation; the rule is checked again when the passing GWA changes
const apply = (s, grades) => attempt(uidOf(s), "select public.renewal_apply($1, 'School', 'Program', '2nd Year', '', false, $2::jsonb, $3::jsonb, true, '[]'::jsonb) id",
  [win.id, JSON.stringify(grades.map((gr, i) => ({ code: `S${i + 1}`, subject: `Subject ${i + 1}`, units: 3, grade: gr }))), JSON.stringify([{ path: `${s}/${win.id}/grade-entries/0-s.png`, name: "s.png", mime: "image/png", size: 1234 }])]);
const rec = async s => (await q("select * from renewal_records where scholar_id_number = $1 and school_year = $2 and term = $3", [s, Y, T]))[0];
const approve = async s => { const sub = (await q("select id from renewal_self_grade_submissions where record_id = $1 and status = 'pending'", [(await rec(s)).id]))[0].id; await q("select public._eg_decide_core($1, true, 'ok', 'Test approver', null)", [sub]); };
await attempt(MANAGER, "select public.academic_program_save($1, 'BS Academic Test Program', 'academic', null)", [LOWER]);
await apply(A, ["2.5", "2.75"]); await approve(A);          // 1-5 school, Academic passing GWA 2.00: GWA 2.63 is worse (bigger)
await apply(C, ["2.5", "2.75"]); await approve(C);          // special program, own passing GWA 3.50: fine
await apply(H1, ["85", "86"]); await approve(H1);           // 60-100 school (higher is better), passing GWA 90: 85.50 is worse (smaller)
await apply(H2, ["95", "92"]); await approve(H2);           // not placed (counts as Academic, passing 90): 93.50 is fine
const [ra, rc, rh1, rh2] = [await rec(A), await rec(C), await rec(H1), await rec(H2)];
await apply(B, ["2.5", "2.75"]); await approve(B);
const rb1 = (await rec(B)).stage;
await attempt(MANAGER, "select public.academic_settings_save($1, 3.50, 3.00)", [LOWER]);   // looser: B no longer needs it, found by the background re-check
const n = (await q("select public._academic_recheck_batch(100) n"))[0].n;
const rb2 = (await rec(B)).stage;
check("4 a GWA worse than the passing GWA of the school's group needs a consultation on the school's OWN scale (2.63 vs 2.00 where lower is better; 85.50 vs 90 where higher is better), a special program uses its own passing GWA, and changing a school's passing GWA re-checks its open renewals in the background",
  ra.stage === "needs_gwa_consultation" && ra.rule_code === "G" && rc.stage === "ready_for_confirmation" && rh1.stage === "needs_gwa_consultation" && rh2.stage === "ready_for_confirmation" && rb1 === "needs_gwa_consultation" && n >= 1 && rb2 === "ready_for_confirmation",
  `${ra.stage} ${rc.stage} | ${rh1.stage} ${JSON.stringify(rh1.evaluation?.gwa)} ${JSON.stringify(rh1.evaluation?.passing_gwa)} | ${rh2.stage} ${JSON.stringify(rh2.evaluation?.gwa)} | ${rb1} ${n} ${rb2}`);

// 5. undo: back to one passing GWA for everybody; the per-school data is kept
await db.exec(read(UNDO));
const back = await q("select to_regprocedure('public.academic_settings_get()') a, to_regprocedure('public.academic_settings_get(uuid)') b, to_regprocedure('public._scholar_gwa_check(text,text,text,uuid)') c");
const kept = (await q("select count(*)::int n from academic_school_programs"))[0].n;
check("5 after the undo the first version is back (one passing GWA for everybody, programs without a school) and the per-school settings and programs are kept", back[0].a !== null && back[0].b === null && back[0].c === null && kept >= 3);
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
