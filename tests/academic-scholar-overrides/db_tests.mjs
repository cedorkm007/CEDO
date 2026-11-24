// tests/academic-scholar-overrides/db_tests.mjs — Grades and Academic Management: a scholar's OWN academic status (different from the program's), set in bulk from a file (5 checks, short on purpose)
// Run:  node tests/academic-scholar-overrides/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_scholar_overrides.sql", UNDO = "undo_academic_scholar_overrides.sql";
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
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const [A, B, C] = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 3", [LOWER])).map(r => r.s);
await q("update scholars set course = 'BS Bulk Academic Program' where scholar_id_number in ($1, $2)", [A, B]);
await q("update scholars set course = 'BS Bulk Non-academic Program' where scholar_id_number = $1", [C]);
await q("delete from academic_school_settings where school_id = $1", [LOWER]); await q("delete from academic_school_programs where school_id = $1", [LOWER]);
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
await attempt(MANAGER, "select public.academic_program_save($1, 'BS Bulk Academic Program', 'academic', null)", [LOWER]);
await attempt(MANAGER, "select public.academic_program_save($1, 'BS Bulk Non-academic Program', 'non_academic', null)", [LOWER]);
const school = (await q("select name from schools where id = $1", [LOWER]))[0].name;
const nameOf = async s => { const r = (await q("select first_name, last_name from scholars where scholar_id_number = $1", [s]))[0]; return `${r.first_name} ${r.last_name}`; };
const eff = async s => (await q("select * from public._scholar_academic($1)", [s]))[0];
const rows = [
  { i: 2, scholar_id: A, name: await nameOf(A), school, program: "BS Bulk Academic Program", status: "Non-academic" },          // valid: differs from the program -> set
  { i: 3, scholar_id: "NOPE-0001", name: "x", school, program: "p", status: "Academic" },                                      // error: not found
  { i: 4, scholar_id: B, name: await nameOf(B), school, program: "BS Bulk Academic Program", status: "Sort of" },             // error: status
  { i: 5, scholar_id: C, name: "Someone Else", school: "Another School", program: "BS Other", status: "Non Academic" },        // follows the program already (+ differences = warnings)
  { i: 6, scholar_id: A, name: await nameOf(A), school, program: "BS Bulk Academic Program", status: "Academic" },            // the same scholar twice
  { i: 7, scholar_id: B, name: await nameOf(B), school, program: "BS Bulk Academic Program", status: "non-academic" },         // valid -> set
];

// 1. only the Scholar Management staff
const denied = await Promise.all([attempt(PLAIN, "select public.academic_bulk_check($1::jsonb)", [JSON.stringify(rows)]), attempt(PLAIN, "select public.academic_bulk_save($1::jsonb)", [JSON.stringify(rows)]), attempt(PLAIN, "select * from public.academic_overrides_list()")]);
check("1 only the Scholar Management staff can check, save or list the scholars' own academic status", denied.every(r => !r.ok && /Scholar Management/i.test(r.msg)), JSON.stringify(denied.map(r => r.msg)));

// 2. the check saves nothing: each row valid / warning / error with its reason; the names, school and program are only compared; asking for what the scholar already follows changes nothing
const chk = await attempt(MANAGER, "select public.academic_bulk_check($1::jsonb) r", [JSON.stringify(rows)]);
const byI = chk.ok ? Object.fromEntries(chk.rows[0].r.rows.map(r => [r.i, r])) : {}, say = i => (byI[i]?.messages ?? []).join(" | ");
check("2 the check saves nothing; a different status = 'set'; not found, an unreadable status and a second row of the same scholar are errors; asking for the status the scholar already follows changes nothing (a name, school or program that differs from the record is only a warning)",
  chk.ok && byI[2].action === "set" && byI[2].state === "valid" && /not found/i.test(say(3)) && /Academic or Non-academic/.test(say(4)) && byI[5].action === "skip" && byI[5].state === "warning" && /name in the file is different/.test(say(5)) && /school in the file is different/.test(say(5)) && /program in the file is different/.test(say(5))
  && /more than once/.test(say(6)) && byI[7].action === "set" && chk.rows[0].r.will_set === 2 && Number((await q("select count(*)::int n from academic_scholar_overrides"))[0].n) === 0, `${chk.msg} ${JSON.stringify(Object.values(byI).map(r => r.i + r.action))}`);

// 3. the save: the own status wins over the program's and the passing GWA of the scholar's school for that status is used; nobody else changes; the open renewals are checked again; the audit says so
const v0 = Number((await q("select version from academic_gwa_settings where id"))[0].version);
const save = await attempt(MANAGER, "select public.academic_bulk_save($1::jsonb) r", [JSON.stringify(rows)]);
const eA = await eff(A), eB = await eff(B), eC = await eff(C);
check("3 saving sets the own status of the scholars that passed (2): their academic status and passing GWA follow it (Non-academic: 3.00 instead of the program's 2.00), the others keep their program's; the open renewals are checked again and the history of the settings says so",
  save.ok && save.rows[0].r.set === 2 && save.rows[0].r.errors === 3 && eA.academic_status === "non_academic" && Number(eA.passing_gwa) === 3 && eB.academic_status === "non_academic" && eC.academic_status === "non_academic" && Number(eC.passing_gwa) === 3
  && Number((await q("select version from academic_gwa_settings where id"))[0].version) === v0 + 1 && Number((await q("select count(*)::int n from academic_settings_audit where what like 'Bulk upload of scholars%'"))[0].n) === 1, `${save.msg} ${JSON.stringify(save.rows?.[0]?.r)} ${JSON.stringify(eA)}`);

// 4. asking for the program's own status takes the own status away; the list shows everyone who has one, with the program's status beside it
const back = await attempt(MANAGER, "select public.academic_bulk_save($1::jsonb) r", [JSON.stringify([{ i: 2, scholar_id: B, name: await nameOf(B), school, program: "BS Bulk Academic Program", status: "Academic" }])]);
const list = await attempt(MANAGER, "select * from public.academic_overrides_list()");
check("4 a row that asks for the program's own status takes the scholar's own status away (B follows Academic again); the list has the scholar who still has one (A) with the program's status beside it",
  back.ok && back.rows[0].r.reset === 1 && (await eff(B)).academic_status === "academic" && list.ok && list.rows.length === 1 && list.rows[0].scholar_id_number === A && list.rows[0].academic_status === "non_academic" && list.rows[0].program_status === "academic", `${back.msg} ${JSON.stringify(list.rows)}`);

// 5. the undo: the program decides again (the table and its data stay); the new functions are gone
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const eA2 = await eff(A);
const gone = (await q("select to_regprocedure('public.academic_bulk_save(jsonb)') a, to_regprocedure('public.academic_overrides_list()') b"))[0];
check("5 after the undo every scholar follows the program again (the scholar with an own status follows Academic: 2.00), the new functions are gone, and the table of own statuses keeps its data",
  eA2.academic_status === "academic" && Number(eA2.passing_gwa) === 2 && gone.a === null && gone.b === null && Number((await q("select count(*)::int n from academic_scholar_overrides"))[0].n) === 1, JSON.stringify([eA2, gone]));
console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
