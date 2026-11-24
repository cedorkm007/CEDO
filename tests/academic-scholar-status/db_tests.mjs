// tests/academic-scholar-status/db_tests.mjs — Grades and Academic Management, PHASE 1A: the academic status belongs to the SCHOLAR (5 checks, short on purpose)
// Run:  node tests/academic-scholar-status/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_academic_scholar_status.sql", UNDO = "undo_academic_scholar_status.sql";
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
const LOWER = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
const sc = (await q("select s.scholar_id_number s from scholars s where s.school_id = $1 and s.status = 'Regular' order by 1 limit 6", [LOWER])).map(r => r.s);
const [A, B, C, D, E, F] = sc;
await q("update scholars set course = 'BS Placed' where scholar_id_number in ($1, $2)", [B, C]);
await q("update scholars set course = 'BS Not Placed' where scholar_id_number = $1", [D]);
await q("update scholars set course = 'BS Placed', status = 'Removed' where scholar_id_number = $1", [E]);
await q("update scholars set course = 'BS Own' where scholar_id_number in ($1, $2)", [A, F]);
await q("delete from academic_school_settings where school_id = $1", [LOWER]); await q("delete from academic_school_programs where school_id = $1", [LOWER]);
await attempt(MANAGER, "select public.academic_settings_save($1, 2.00, 3.00)", [LOWER]);
await attempt(MANAGER, "select public.academic_program_save($1, 'BS Placed', 'non_academic', 2.5)", [LOWER]);
await q("insert into academic_scholar_overrides (scholar_id_number, academic_status) values ($1, 'non_academic') on conflict do nothing", [A]);
await q("delete from scholar_academic_status"); await q("delete from academic_status_history");
const eff = async s => (await q("select * from public._scholar_academic($1)", [s]))[0];

// 1. the move: own status first, then the program (with its special GWA as the custom GWA), the rest NOT SET, Removed left out, history written; running it again changes nothing
await db.exec(read(NEW)); await db.exec(read(NEW));
const rowOf = async s => (await q("select * from scholar_academic_status where scholar_id_number = $1", [s]))[0];
const [rA, rB, rC, rD, rE] = [await rowOf(A), await rowOf(B), await rowOf(C), await rowOf(D), await rowOf(E)];
const hist = Number((await q("select count(*)::int n from academic_status_history where how = 'migration'"))[0].n);
check("1 the move gives each scholar the status that applies today (own status; else the program's with its special passing GWA as the scholar's custom GWA); a scholar whose program is not placed stays Not set; a Removed scholar is left out; the history says 'migration'; running it twice adds nothing",
  rA?.academic_status === "non_academic" && rA.source === "own" && rA.custom_passing_gwa === null && rB?.academic_status === "non_academic" && Number(rB.custom_passing_gwa) === 2.5 && rB.source === "program" && rC?.academic_status === "non_academic" && !rD && !rE && hist === 3
  && Number((await q("select count(*)::int n from scholar_academic_status"))[0].n) === 3, JSON.stringify({ rA, rB, rD, rE, hist }));

// 2. the renewal reads the scholar's status: the number used does not change (own: the school's Non-academic 3.00; program special: 2.50; not placed: counted as Academic 2.00 but flagged as not set)
const [eA, eB, eD] = [await eff(A), await eff(B), await eff(D)];
check("2 the renewal reads the scholar's status: the own-status scholar uses the school's Non-academic number (3.00), the special-program scholar keeps 2.50, and a scholar with no status is checked as Academic (2.00) and flagged 'not set'",
  eA.academic_status === "non_academic" && Number(eA.passing_gwa) === 3 && Number(eB.passing_gwa) === 2.5 && eB.special === true && eD.academic_status === "academic" && eD.is_set === false && Number(eD.passing_gwa) === 2, JSON.stringify({ eA, eB, eD }));

// 3. the warnings: only the Scholar Management staff; the count per school, the school's GWA rule on/off, and the list of the scholars to fix (not the Removed, not those with a status)
const denied = await Promise.all([attempt(PLAIN, "select * from public.academic_not_set_summary()"), attempt(PLAIN, "select * from public.academic_not_set_list(null, 10, 0)")]);
const sum = await attempt(MANAGER, "select * from public.academic_not_set_summary() where school_id = $1", [LOWER]);
const lst = await attempt(MANAGER, "select scholar_id_number, rule_on from public.academic_not_set_list($1, 1000, 0)", [LOWER]);
const expectNot = Number((await q("select count(*)::int n from scholars s where s.school_id = $1 and s.status <> 'Removed' and not exists (select 1 from scholar_academic_status t where t.scholar_id_number = s.scholar_id_number)", [LOWER]))[0].n);
const ids = lst.ok ? lst.rows.map(r => r.scholar_id_number) : [];
check("3 only the Scholar Management staff can read the warnings; the school's 'no status' count matches the list (which has D, not the scholars with a status and not the Removed one) and shows the school's GWA rule is on",
  denied.every(r => !r.ok && /Scholar Management/i.test(r.msg)) && sum.ok && Number(sum.rows[0].not_set) === expectNot && sum.rows[0].rule_on === true && ids.length === expectNot && ids.includes(D) && !ids.includes(A) && !ids.includes(B) && !ids.includes(E), `${sum.msg} ${lst.msg} ${expectNot} ${ids.length}`);

// 4. "set by file" now sets the scholar's status: the renewal follows it, the history keeps old/new, the open renewals are checked again; the same status again changes nothing
const v0 = Number((await q("select version from academic_gwa_settings where id"))[0].version);
const rows = [{ i: 2, scholar_id: D, name: "", school: "", program: "", status: "Non-academic" }, { i: 3, scholar_id: A, name: "", school: "", program: "", status: "Academic" }, { i: 4, scholar_id: B, name: "", school: "", program: "", status: "Non-academic" }];
const save = await attempt(MANAGER, "select public.academic_bulk_save($1::jsonb) r", [JSON.stringify(rows)]);
const [fD, fA, fB] = [await eff(D), await eff(A), await eff(B)];
const hD = (await q("select * from academic_status_history where scholar_id_number = $1 and how = 'file'", [D]))[0], hA = (await q("select * from academic_status_history where scholar_id_number = $1 and how = 'file'", [A]))[0];
check("4 'set by file' sets the scholar's status: Not set -> Non-academic (3.00), Own Non-academic -> Academic (2.00); the one who already had it is left alone; the history keeps the old and the new status; the open renewals are checked again",
  save.ok && save.rows[0].r.set === 2 && save.rows[0].r.skipped === 1 && fD.academic_status === "non_academic" && fD.is_set === true && Number(fD.passing_gwa) === 3 && fA.academic_status === "academic" && Number(fA.passing_gwa) === 2 && Number(fB.passing_gwa) === 2.5
  && hD && hD.old_status === null && hD.new_status === "non_academic" && hA.old_status === "non_academic" && hA.new_status === "academic" && Number((await q("select version from academic_gwa_settings where id"))[0].version) === v0 + 1, `${save.msg} ${JSON.stringify(save.rows?.[0])}`);

// 5. the undo: back to the program as the decider (what was set by file is copied to the old own-status table; nothing is deleted); the new migration can be run again
await db.exec(read(UNDO)); await db.exec(read(UNDO));
const uA = await eff(A), uD = await eff(D), uB = await eff(B);
const keep = Number((await q("select count(*)::int n from scholar_academic_status"))[0].n);
await db.exec(read(NEW));
check("5 the undo puts the program back as the decider (a status set by file is kept as the scholar's own status in the old table; the special program keeps 2.50; nothing is deleted from the new tables) and the migration can be run again",
  uA.academic_status === "academic" && uD.academic_status === "non_academic" && Number(uB.passing_gwa) === 2.5 && keep === 4 && Number((await q("select count(*)::int n from academic_scholar_overrides where scholar_id_number in ($1, $2)", [A, D]))[0].n) === 2, JSON.stringify({ uA, uD, uB, keep }));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
