// tests/sdp-owed/db_tests.mjs — the scholar sees the credits added to their SDP requirement as soon as an SDP reconsideration is approved
//   (supabase_migration_sdp_owed_for_scholar.sql, after the SDP reconsideration files)
// Run:  node tests/sdp-owed/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_sdp_owed_for_scholar.sql", UNDO = "undo_sdp_owed_for_scholar.sql";
async function as(uid, fn, role = "authenticated") {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)", [uid ?? "", role, JSON.stringify(uid ? { sub: uid, role } : { role })]);
    return fn(tx);
  });
}
const rows = (uid, sql, params = []) => as(uid, async tx => (await tx.query(sql, params)).rows);
const attempt = async (uid, sql, params = [], role) => { try { return { ok: true, rows: await as(uid, async tx => (await tx.query(sql, params)).rows, role) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
const nextSem = async (y, s) => (await q("select school_year y, semester s from public._sdp_next_semester($1, $2)", [y, s]))[0];

const gps = (await q("select * from grading_period_settings"))[0];
const Y = gps.current_school_year, S = gps.current_semester;
const N1 = await nextSem(Y, S), N2 = await nextSem(N1.y, N1.s);
const prev = { y: "2020-2021", s: "1st Semester" };
const A = "TEST-0001", B = "TEST-0002", uidA = seedId("scholar:1"), uidB = seedId("scholar:2");

await db.exec(read(UNDO));      // the harness may already have put the file on: start from the earlier behaviour
console.log("Before the file");
check("the scholar's list of added credits does not exist yet", !(await attempt(uidA, "select * from public.fetch_scholar_sdp_owed()")).ok);
await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nThe added credits, as soon as a reconsideration is approved");
check("a scholar with nothing owed sees an empty list", (await rows(uidA, "select * from public.fetch_scholar_sdp_owed()")).length === 0);
await q("delete from sdp_reconsideration_debts"); await q("delete from sdp_reconsideration_requests");
const mk = async (scholar, year, sem, status = "approved") => (await q("insert into sdp_reconsideration_requests (scholar_id_number, school_year, term, basis_school_year, basis_term, status, lacking) values ($1, $2, $3, $2, $3, $4, '{}') returning id", [scholar, year, sem, status]))[0].id;
const debt = (req, scholar, cat, n, y, s) => q("insert into sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester) values ($1, $2, $3, $4, $5, $6)", [req, scholar, cat, n, y, s]);
const r1 = await mk(A, prev.y, prev.s), r2 = await mk(A, N1.y, N1.s), r2b = await mk(A, N1.y, "Summer"), r3 = await mk(B, Y, S);      // two approved requests can add to the same semester
await debt(r1, A, "community_service", 2, prev.y, prev.s);      // long past: not shown
await debt(r2, A, "community_service", 2, N1.y, N1.s); await debt(r2b, A, "community_service", 1, N1.y, N1.s); await debt(r2, A, "formation_program", 1, N1.y, N1.s);
await debt(r2, A, "community_volunteerism", 3, N2.y, N2.s);
await debt(r3, B, "community_service", 4, N1.y, N1.s);
const listA = await rows(uidA, "select * from public.fetch_scholar_sdp_owed()");
check("the scholar sees what is added for each coming semester, per category, added up (2 + 1 = 3 community service)", listA.length === 3
  && listA[0].school_year === N1.y && listA[0].semester === N1.s && listA[0].category === "community_service" && listA[0].amount === 3
  && listA[1].category === "formation_program" && listA[1].amount === 1 && listA[2].school_year === N2.y && listA[2].category === "community_volunteerism" && listA[2].amount === 3, JSON.stringify(listA));
check("a semester that has already passed is not listed", !listA.some(r => r.school_year === prev.y));
check("the semester coming is not 'current' yet", listA.every(r => r.is_current === false));
check("a scholar sees only their own rows", (await rows(uidB, "select * from public.fetch_scholar_sdp_owed()")).length === 1 && (await rows(uidB, "select * from public.fetch_scholar_sdp_owed()"))[0].amount === 4);
check("staff and visitors cannot ask", !(await attempt(seedId("staff:demo.sead"), "select * from public.fetch_scholar_sdp_owed()")).ok && !(await attempt(null, "select * from public.fetch_scholar_sdp_owed()", [], "anon")).ok);
check("the requirement of the CURRENT semester is not changed yet (3 each)", (await rows(uidA, "select * from public.fetch_scholar_sdp_requirements()")).every(r => r.required === 3));

console.log("\nWhen the semester starts");
await q("update grading_period_settings set current_school_year = $1, current_semester = $2 where id", [N1.y, N1.s]);
const reqNow = await rows(uidA, "select * from public.fetch_scholar_sdp_requirements()");
const need = c => reqNow.find(r => r.category === c).required;
check("the requirement goes up by the credits lacking: 3 + 3 community service, 3 + 1 formation, 3 volunteerism", need("community_service") === 6 && need("formation_program") === 4 && need("community_volunteerism") === 3, JSON.stringify(reqNow));
const listNow = await rows(uidA, "select * from public.fetch_scholar_sdp_owed()");
check("that semester is now 'current' in the list, and the one after it is still coming", listNow.filter(r => r.is_current).length === 2 && listNow.filter(r => !r.is_current).length === 1);
await q("update grading_period_settings set current_school_year = $1, current_semester = $2 where id", [N2.y, N2.s]);
check("when the semester after starts, the earlier one drops off the list", (await rows(uidA, "select * from public.fetch_scholar_sdp_owed()")).every(r => r.school_year === N2.y && r.semester === N2.s));

console.log("\nThe undo");
await db.exec(read(UNDO));
check("after the undo the function is gone and the debts are untouched", !(await attempt(uidA, "select * from public.fetch_scholar_sdp_owed()")).ok && (await q("select count(*)::int n from sdp_reconsideration_debts"))[0].n === 6);
await db.exec(read(FILE));
check("the file can be put back", (await attempt(uidA, "select * from public.fetch_scholar_sdp_owed()")).ok);
const text = read(FILE).replace(/--.*$/gm, "");
check("the file adds one function only: no table is created or changed, nothing is deleted", !/(create table|alter table|drop table|delete from|truncate|insert into|update public)/i.test(text));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
