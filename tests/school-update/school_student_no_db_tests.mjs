// tests/school-update/school_student_no_db_tests.mjs — School Portal: the School ID (Student No.) of each scholar, supabase_migration_school_student_no.sql
//   who can set it, one per scholar, no two the same inside a school, the batch used by the upload, the undo.
// Run:  node tests/school-update/school_student_no_db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_school_student_no.sql", UNDO = "undo_school_student_no.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = []) => { try { return { ok: true, rows: await rows(uid, sql, params) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

const lower = (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like '%Lower-Is-Better%'"))[0];
const higher = (await q("select a.id as uid, a.school_id from school_accounts a join schools s on s.id = a.school_id where s.name like '%Higher-Is-Better%'"))[0];
const mine = (await q("select scholar_id_number from scholars where school_id = $1 order by scholar_id_number limit 3", [lower.school_id])).map(r => r.scholar_id_number);
const theirs = (await q("select scholar_id_number from scholars where school_id = $1 order by scholar_id_number limit 1", [higher.school_id]))[0].scholar_id_number;
const noOf = async id => (await q("select school_student_no n from scholars where scholar_id_number = $1", [id]))[0].n;
const set = (uid, id, v) => attempt(uid, "select public.school_set_student_no($1, $2)", [id, v]);
const link = (uid, links) => attempt(uid, "select * from public.school_link_student_nos($1::jsonb)", [JSON.stringify(links)]);

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on: start from the earlier state
console.log("Before the file");
check("there is no School ID column and no function yet", (await q("select count(*)::int n from information_schema.columns where table_name = 'scholars' and column_name = 'school_student_no'"))[0].n === 0
  && (await q("select to_regprocedure('public.school_set_student_no(text,text)') is null as g"))[0].g);
await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nA school sets the School ID of its own scholars");
check("every scholar starts with no School ID", (await q("select count(*)::int n from scholars where school_student_no is not null"))[0].n === 0);
const a = await set(lower.uid, mine[0], "  2022-00123 ");
check("a school sets the School ID of its scholar (spaces at the ends are dropped)", a.ok && (await noOf(mine[0])) === "2022-00123", a.msg);
const dup = await set(lower.uid, mine[1], "2022-00123");
check("a second scholar of the same school cannot have the same School ID", !dup.ok && /already has the School ID/.test(dup.msg) && (await noOf(mine[1])) === null, dup.msg);
const dupCase = await set(lower.uid, mine[1], "2022-00123 ".toUpperCase());
check("capital letters do not make an ID different", !dupCase.ok, dupCase.msg);
const other = await set(higher.uid, theirs, "2022-00123");
check("another school may use the same number for its own scholar", other.ok && (await noOf(theirs)) === "2022-00123", other.msg);
const cross = await set(lower.uid, theirs, "999");
check("a school cannot set the School ID of another school's scholar", !cross.ok && /not one of your school/.test(cross.msg) && (await noOf(theirs)) === "2022-00123", cross.msg);
const clear = await set(lower.uid, mine[0], "   ");
check("a blank clears the School ID", clear.ok && (await noOf(mine[0])) === null, clear.msg);
const tooLong = await set(lower.uid, mine[0], "x".repeat(41));
check("more than 40 characters is refused", !tooLong.ok && /at most 40/.test(tooLong.msg), tooLong.msg);
const scholarTry = await set(seedId("scholar:1"), mine[0], "5");
check("a scholar cannot set a School ID", !scholarTry.ok && /Only a school account/.test(scholarTry.msg), scholarTry.msg);
const staffTry = await set(seedId("staff:demo.evaluator"), mine[0], "5");
check("staff go through the table, not through the school function", !staffTry.ok && /Only a school account/.test(staffTry.msg), staffTry.msg);

console.log("\nThe links a school confirmed on an upload");
const batch = await link(lower.uid, [
  { scholarIdNumber: mine[0], studentNo: "A-1" },
  { scholarIdNumber: mine[1], studentNo: "A-2" },
  { scholarIdNumber: mine[2], studentNo: "a-1" },          // the same number as the first, only in small letters
  { scholarIdNumber: theirs, studentNo: "A-9" },          // another school's scholar
  { scholarIdNumber: mine[1], studentNo: "" },            // blank
]);
const res = batch.rows ?? [];
check("each link is judged on its own: the good ones are saved, the others report why", batch.ok && res.length === 5 && res[0].ok && res[1].ok && !res[2].ok && !res[3].ok && !res[4].ok, batch.msg ?? JSON.stringify(res));
check("the reasons are readable", /already has the School ID/.test(res[2].error) && /not one of your school/.test(res[3].error) && /blank/.test(res[4].error), JSON.stringify(res.map(r => r.error)));
check("only the good links were saved", (await noOf(mine[0])) === "A-1" && (await noOf(mine[1])) === "A-2" && (await noOf(mine[2])) === null && (await noOf(theirs)) === "2022-00123");
const again = await link(lower.uid, [{ scholarIdNumber: mine[0], studentNo: "a-1" }]);
check("the same ID again counts as done", again.ok && again.rows[0].ok, again.msg);
const over = await link(lower.uid, [{ scholarIdNumber: mine[0], studentNo: "ZZZ" }]);
check("a link never overwrites a School ID that is already there", over.ok && !over.rows[0].ok && /already has the School ID A-1/.test(over.rows[0].error) && (await noOf(mine[0])) === "A-1", over.msg ?? JSON.stringify(over.rows));
const notList = await link(lower.uid, [{ scholarIdNumber: mine[2], studentNo: "A-3" }]);
const bad = await attempt(lower.uid, "select * from public.school_link_student_nos($1::jsonb)", ['{"a":1}']);
check("a list that is not a list is refused", !bad.ok && /list/.test(bad.msg) && notList.ok && notList.rows[0].ok, bad.msg);

console.log("\nWho can read it");
const seen = await rows(lower.uid, "select scholar_id_number, school_student_no from scholars where scholar_id_number = any($1)", [[mine[0], theirs]]);
check("a school reads the School ID of its own scholars and sees no scholar of another school", seen.length === 1 && seen[0].school_student_no === "A-1", JSON.stringify(seen));

console.log("\nThe undo");
await db.exec(read(UNDO));
check("after the undo the column and both functions are gone", (await q("select count(*)::int n from information_schema.columns where table_name = 'scholars' and column_name = 'school_student_no'"))[0].n === 0
  && (await q("select to_regprocedure('public.school_set_student_no(text,text)') is null a, to_regprocedure('public.school_link_student_nos(jsonb)') is null b"))[0].a);
await db.exec(read(FILE));
const text = read(FILE).replace(/--.*$/gm, "");
check("the file adds one column and two functions; nothing is dropped or emptied", !/(drop table|delete from|truncate|drop column)/i.test(text) && (text.match(/add column/gi) ?? []).length === 1 && (text.match(/create or replace function/gi) ?? []).length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
await db.close?.();
