// tests/grading-program-marks/db_tests.mjs — Grading setup: a passing mark for a specific program of a school (5 checks, short on purpose)
// Run:  node tests/grading-program-marks/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const A = "supabase_migration_grading_program_marks.sql", UA = "undo_grading_program_marks.sql", B = "supabase_migration_grading_program_marks_renewal_link.sql", UB = "undo_grading_program_marks_renewal_link.sql";
async function as(uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: "authenticated" })]);
    return (await tx.query(sql, params)).rows;
  });
}
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await as(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const sys = async (sql, params = []) => { try { return { ok: true, rows: await q(sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const file = async text => { try { await db.exec(text); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
await db.exec(read(A)); await db.exec(read(A));      // twice: safe
const monitor = seedId("staff:demo.admin"), PLAIN = seedId("staff:demo.plain");
await q("insert into staff_account_tags (staff_id, tag_key) values ($1, 'scholars_grades_monitoring') on conflict do nothing", [monitor]);
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const NOPASS = (await q("select id from schools where name like '%No-Passing-Mark%'"))[0].id;
const cfg = { scale_min: 1, scale_max: 5, direction: "lower_is_better", passing_mark: 3, uses_letter_grades: false };
const save = (uid, school, programMarks, c = cfg) => attempt(uid, "select public.grading_setup_save($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb, 'test')", [school, JSON.stringify({ ...c, program_marks: programMarks })]);
await q("update scholars set course = 'BS Nursing' where scholar_id_number = 'TEST-0001'");
await q("update scholars set course = 'BS Nursing' where scholar_id_number = 'TEST-0002'");

// 1. staff save program marks (on the school's scale); the screen reads them back with the school's programs to pick from; wrong input and other people are refused
const ok1 = await save(monitor, LOWER, [{ program: "  BS Nursing ", passing_mark: "2.5" }]);
const get = await attempt(monitor, "select public.grading_setup_get($1) g", [LOWER]);
const G = get.rows?.[0]?.g;
const list = await attempt(monitor, "select program_marks from public.grading_setup_schools() where school_id = $1", [LOWER]);
const outOfScale = await save(monitor, LOWER, [{ program: "BS Nursing", passing_mark: 7 }]), dup = await save(monitor, LOWER, [{ program: "BS Nursing", passing_mark: 2 }, { program: " bs nursing", passing_mark: 3 }]);
const noName = await save(monitor, LOWER, [{ program: " ", passing_mark: 2 }]), nan = await save(monitor, LOWER, [{ program: "X", passing_mark: "abc" }]), notList = await save(monitor, LOWER, "nope");
const plain = await save(PLAIN, LOWER, []), readPlain = await attempt(PLAIN, "select public.grading_setup_get($1)", [LOWER]);
check("1 staff save a passing mark for a program (spaces trimmed, same scale as the school's); reading it back gives the marks and the school's programs with how many scholars each; a mark off the scale, a program listed twice (any case), no name, a non-number, a bad list and anybody else are refused",
  ok1.ok && G.config.program_marks.length === 1 && G.config.program_marks[0].program === "BS Nursing" && Number(G.config.program_marks[0].passing_mark) === 2.5 && G.config.set_by_staff === true
  && G.programs.some(p => p.program === "BS Nursing" && p.scholars === 2) && G.programs.some(p => p.program === "BS Test Studies") && Number(list.rows[0].program_marks) === 1
  && !outOfScale.ok && /scale/.test(outOfScale.msg) && !dup.ok && /twice/.test(dup.msg) && !noName.ok && /name/.test(noName.msg) && !nan.ok && /number/.test(nan.msg) && !notList.ok && !plain.ok && !readPlain.ok,
  `${ok1.msg} ${JSON.stringify(G?.config)} ${JSON.stringify(G?.programs)} ${outOfScale.msg} ${dup.msg}`);

// 2. the rule: the program's mark for that program (any case), the school's mark for every other program and when no program is known; only while the setup is the staff's; the old two-argument answers are unchanged
const o = async (grade, course) => (await q("select public._grade_outcome($1, $2, $3) o", [LOWER, grade, course]))[0].o;
const o2 = async grade => (await q("select public._grade_outcome($1, $2) o", [LOWER, grade]))[0].o;
const r1 = [await o("2.75", "BS Nursing"), await o("2.5", "bs NURSING "), await o("2.75", "BS Test Studies"), await o("2.75", null), await o("2.75", ""), await o("INC", "BS Nursing"), await o("DRP", "BS Nursing"), await o("", "BS Nursing")];
await q("update school_grading_configs set set_by_staff = false where school_id = $1", [LOWER]);      // the school saved its own grading system
const r2 = [await o("2.75", "BS Nursing")];
await q("update school_grading_configs set set_by_staff = true where school_id = $1", [LOWER]);
const same = []; for (const g of ["1.0", "2.75", "3.0", "3.25", "5", "INC", "drp", "F", "", "W"]) same.push([await o2(g), await o(g, null)]);
// what the scholar's and the staff's grade screens are given: the marks, and for the scholar the passing mark that applies to that scholar
const mineNursing = await attempt((await q("select id from scholars where scholar_id_number = 'TEST-0001'"))[0].id, "select * from public.get_scholar_grading_program_marks()");
const mineOther = await attempt((await q("select id from scholars where scholar_id_number = 'TEST-0003'"))[0].id, "select * from public.get_scholar_grading_program_marks()");
const forStaff = await attempt(monitor, "select * from public.get_scholar_grading_program_marks_for_staff('TEST-0001')"), forPlain = await attempt(PLAIN, "select * from public.get_scholar_grading_program_marks_for_staff('TEST-0001')");
const screens = mineNursing.ok && Number(mineNursing.rows[0].passing_mark) === 2.5 && mineNursing.rows[0].set_by_staff === true && mineNursing.rows[0].program_marks.length === 1
  && mineOther.ok && Number(mineOther.rows[0].passing_mark) === 3 && forStaff.ok && forStaff.rows[0].program_marks.length === 1 && forPlain.ok && forPlain.rows.length === 0;
check("2 a grade is judged by the program's own mark for that program (2.75 fails Nursing's 2.5, 2.5 passes; any case and spaces), by the school's mark for other programs and when no program is known, INC / DRP / no grade as always; once the school saves its own grading system the program marks are no longer used; the old two-argument rule answers exactly like the new one without a program; the scholar's and the staff's screens are given the marks, and the scholar the passing mark that applies to that scholar",
  JSON.stringify(r1) === JSON.stringify(["failed", "passed", "passed", "passed", "passed", "inc", "drp", "ungraded"]) && JSON.stringify(r2) === JSON.stringify(["passed"]) && same.every(([a, b]) => a === b) && screens, `${JSON.stringify(mineNursing)} ${JSON.stringify(mineOther)} ${JSON.stringify(forStaff)} ${JSON.stringify(r1)} ${JSON.stringify(r2)} ${JSON.stringify(same)}`);

// 3. a school with a conversion table of its own is judged by that table (the program marks of the staff setup do not apply); a school without one by the rule above
const sem = ["2025-2026", "2nd Semester"];
const at = async (grade, course) => (await q("select public._grade_outcome_at($1, $2, null, $3, $4, $5) o", [LOWER, grade, ...sem, course]))[0].o;
const beforeTable = [await at("2.75", "BS Nursing"), await at("2.75", "BS Test Studies")];
const ver = (await q("insert into school_grading_versions (school_id, version_no, effective_year, effective_term, entry_mode, passing_mark_pct) values ($1, 1, '2025-2026', '1st Semester', 'grade', 75) returning id", [LOWER]).catch(async e => { console.log("   (version insert: " + e.message + ")"); return []; }))[0]?.id;
let withTable = [];
if (ver) {
  await q("insert into school_grade_bands (version_id, sort_no, pct_from, pct_to, equivalent_grade, equivalent_value, remarks, result) values ($1, 1, 95, 100, '1.0', 1.0, 'Excellent', 'passed'), ($1, 2, 75, 94.99, '2.75', 2.75, 'Fair', 'passed'), ($1, 3, 0, 74.99, '5.0', 5.0, 'Failed', 'failed')", [ver]).catch(e => console.log("   (bands insert: " + e.message + ")"));
  withTable = [await at("2.75", "BS Nursing"), await at("5.0", "BS Nursing")];
}
check("3 in the semester judged, a program's staff mark is used when the school has no conversion table, and the school's own conversion table decides (and the program marks are not used) when it has one", JSON.stringify(beforeTable) === JSON.stringify(["failed", "passed"]) && JSON.stringify(withTable) === JSON.stringify(["passed", "failed"]), `${JSON.stringify(beforeTable)} ${JSON.stringify(withTable)}`);
if (ver) { await q("delete from school_grade_bands where version_id = $1", [ver]); await q("delete from school_grading_versions where id = $1", [ver]); }

// 4. renewal: file 2 (the link) applies to the live functions, twice is safe, and then a scholar's failed subjects follow the program; its undo puts the school-wide judging back
const failedOf = async () => { const r = (await q("select public._renewal_evaluate('TEST-0001', '2026-2027', '1st Semester') e"))[0].e; return (r.grades?.failed_subjects ?? []).map(x => x.subject_code ?? x.subject).sort(); };
await q("update scholars set course = 'BS Nursing' where scholar_id_number = 'TEST-0001'");
await save(monitor, LOWER, [{ program: "BS Nursing", passing_mark: 2 }]);      // 2.25 is worse than 2.0
await file(read(UB));      // the demo database is built with part 2 already in: take it out to see the school-wide judging first
const before = await failedOf();
const b1 = await file(read(B)), b2 = await file(read(B));
const after = b1.ok ? await failedOf() : [];
const link = (await q("select position('_grade_outcome_at(' in pg_get_functiondef('public._renewal_evaluate(text,text,text)'::regprocedure)) > 0 e, position('_grade_outcome_at(' in pg_get_functiondef('public._renewal_recheck(uuid)'::regprocedure)) > 0 r"))[0];
const ub = await file(read(UB)), ub2 = await file(read(UB));
const undone = ub.ok ? await failedOf() : [];
await file(read(B));
check("4 part 2 links the renewal decisions to the program (it can be run twice; before it the school's mark judged, after it the scholar's failed subjects follow the program's mark; its undo brings the old judging back, and it can be run again)",
  b1.ok && b2.ok && link.e && link.r && before.length === 0 && after.length === 1 && ub.ok && ub2.ok && undone.length === 0, `${b1.msg} ${JSON.stringify({ before, after, undone, link })}`);

// 5. the undo of part 1 gives the old rule and the old screens back, keeps the column and the marks; it can be run again
await file(read(UB));
const u1 = await file(read(UA)), u2 = await file(read(UA));
const gone = (await q("select to_regprocedure('public._grade_outcome(uuid,text,text)') a, to_regprocedure('public.get_scholar_grading_program_marks()') b, to_regprocedure('public.get_scholar_grading_program_marks_for_staff(text)') c"))[0];
const oldSame = await o2("2.75"), oldInc = await o2("INC");
const kept = (await q("select jsonb_array_length(staff_program_marks) n from school_grading_configs where school_id = $1", [LOWER]))[0].n;
const oldList = await attempt(monitor, "select * from public.grading_setup_schools() where school_id = $1", [LOWER]);
const re = await file(read(A));
const back = await attempt(monitor, "select public.grading_setup_get($1) g", [LOWER]);
check("5 the undo of part 1 puts the old pass/fail rule and the old setup list back (no program column), removes the three-argument rule and the two small functions, keeps the saved program marks; the update can be run again and finds them",
  u1.ok && u2.ok && !gone.a && !gone.b && !gone.c && oldSame === "passed" && oldInc === "inc" && kept === 1 && oldList.ok && !("program_marks" in oldList.rows[0]) && re.ok && back.rows[0].g.config.program_marks.length === 1, `${u1.msg} ${u2.msg} ${JSON.stringify(gone)} ${kept} ${re.msg}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
