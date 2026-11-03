// tests/school-renewal-tab/db_tests.mjs — School Portal: the Renewal tab (supabase_migration_school_renewal_tab.sql)
//   a school sees only its own scholars, the group each is in (applied / renewed / removed / not applied / not required), probation, the grade result, the numbers for the progress bar.
// Run:  node tests/school-renewal-tab/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const FILE = "supabase_migration_school_renewal_tab.sql", UNDO = "undo_school_renewal_tab.sql";
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
const win = (await q("select w.* from renewal_windows w order by (select count(*) from renewal_records r where r.window_id = w.id) desc limit 1"))[0];
await q("update renewal_windows set testers = null, school_ids = null where id = $1", [win.id]).catch(async () => q("update renewal_windows set testers = null where id = $1", [win.id]));
const Y = win.school_year, T = win.term;
const list = (uid, y = Y, t = T) => rows(uid, "select * from public.school_renewal_list($1, $2)", [y, t]);
const summary = async (uid, y = Y, t = T) => (await rows(uid, "select public.school_renewal_summary($1, $2) s", [y, t]))[0].s;

await db.exec(read(UNDO)).catch(() => {});      // the harness may already have put the file on: start from before it
console.log("Before the file");
check("the functions do not exist yet", (await q("select to_regprocedure('public.school_renewal_list(text,text)') is null as g"))[0].g);
await db.exec(read(FILE)); await db.exec(read(FILE));      // safe to run twice

console.log("\nWho can ask, and what they get");
const mine = await list(lower.uid);
check("a school gets a list", mine.length > 0, String(mine.length));
check("every row is a scholar of that school, and no scholar of another school is there", (await q("select count(*)::int n from scholars where school_id = $1 and scholar_id_number = any($2)", [lower.school_id, mine.map(r => r.scholar_id_number)]))[0].n === mine.length
  && !mine.some(r => r.scholar_id_number === (higher && "none")));
const other = await list(higher.uid);
check("another school gets its own list, with none of the first school's scholars", other.length > 0 && !other.some(r => mine.some(m => m.scholar_id_number === r.scholar_id_number)));
check("the rows carry only: who, status, where the renewal is, the grade result (no SDP, no staff notes)", JSON.stringify(Object.keys(mine[0]).sort())
  === JSON.stringify(["failed", "first_name", "grades_state", "grp", "inc", "is_late", "last_name", "middle_name", "probation", "program", "review", "scholar_id_number", "scholar_status", "school_student_no", "stage", "year_level"]));
check("a scholar cannot ask", !(await attempt(seedId("scholar:1"), "select * from public.school_renewal_list($1, $2)", [Y, T])).ok);
check("staff cannot ask through these (they have their own lists)", !(await attempt(seedId("staff:demo.evaluator"), "select * from public.school_renewal_list($1, $2)", [Y, T])).ok && !(await attempt(seedId("staff:demo.evaluator"), "select * from public.school_renewal_summary($1, $2)", [Y, T])).ok);
check("nobody who is not signed in can ask", !(await attempt(null, "select * from public.school_renewal_list($1, $2)", [Y, T])).ok);

console.log("\nThe group of each scholar");
const expected = new Map((await q(`
  select s.scholar_id_number sid,
    case when s.status = 'Removed' or r.stage = 'removed' then 'removed' when r.stage = 'renewed' then 'renewed' when r.stage in ('late_declined', 'not_required') then 'not_required'
         when r.id is not null then 'in_process' else 'not_applied' end g
  from scholars s left join renewal_records r on r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3
  where s.school_id = $1 and (s.status not in ('Removed', 'On leave') or r.id is not null)`, [lower.school_id, Y, T])).map(r => [r.sid, r.g]));
check("every scholar is in the group the stage says (checked scholar by scholar against a separate query)", mine.length === expected.size && mine.every(r => expected.get(r.scholar_id_number) === r.grp), JSON.stringify(mine.filter(r => expected.get(r.scholar_id_number) !== r.grp).slice(0, 3)));
check("each stage that exists in the data shows up in a group (the data has applied and not-applied scholars at least)", mine.some(r => r.grp === "in_process") && mine.some(r => r.grp === "not_applied"), JSON.stringify([...new Set(mine.map(r => r.grp))]));
check("scholars on leave or removed with no application are not in the list", !mine.some(r => ["On leave"].includes(r.scholar_status)) && !mine.some(r => r.scholar_status === "Removed" && r.stage === null));

// make the cases we need, with made-up records on scholars of the first school that have none
const free = (await q("select s.scholar_id_number sid from scholars s where s.school_id = $1 and s.status not in ('Removed','On leave') and not exists (select 1 from renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = $2 and r.term = $3) order by 1 limit 5", [lower.school_id, Y, T])).map(r => r.sid);
await q("insert into renewal_records (scholar_id_number, school_year, term, stage) values ($1, $4, $5, 'renewed'), ($2, $4, $5, 'removed'), ($3, $4, $5, 'not_required')", [free[0], free[1], free[2], Y, T]);
await q("update scholars set status = 'Probationary' where scholar_id_number = $1", [free[0]]);
const after = await list(lower.uid);
const g = id => after.find(r => r.scholar_id_number === id);
check("renewed, removed and not required records go to their groups; a probationary scholar is flagged", g(free[0]).grp === "renewed" && g(free[0]).probation === true && g(free[1]).grp === "removed" && g(free[2]).grp === "not_required");
check("a scholar with no application is 'not applied'", g(free[3]).grp === "not_applied" && g(free[3]).stage === null);
const status4 = (await q("select status from scholars where scholar_id_number = $1", [free[4]]))[0].status;
await q("update scholars set status = 'Removed' where scholar_id_number = $1", [free[4]]);
check("a removed scholar with no application for this renewal is not listed (only the ones removed in it)", !(await list(lower.uid)).some(r => r.scholar_id_number === free[4]));
await q("update scholars set status = $2 where scholar_id_number = $1", [free[4], status4]);

console.log("\nThe grade result");
const inc = after.filter(r => r.inc > 0), failedRows = after.filter(r => r.failed > 0);
check("INC and failed counts come from the renewal check (the seed has scholars with an INC and with failed subjects)", inc.length > 0 && failedRows.length > 0, `${inc.length} ${failedRows.length}`);

const basisRow = (await q("select * from public._renewal_basis($1, $2)", [Y, T]))[0];
const independent = async id => (await q(`select count(*) filter (where o in ('failed', 'drp'))::int failed, count(*) filter (where o = 'inc')::int inc, count(*)::int total, count(*) filter (where o = 'ungraded')::int ungraded
  from (select public._grade_outcome(s.school_id, g.grade) o from scholars s join scholar_subjects_grades g on g.scholar_id_number = s.scholar_id_number where s.scholar_id_number = $1 and g.school_year = $2 and g.semester = $3) x`, [id, basisRow.basis_school_year, basisRow.basis_term]))[0];
const unchecked = after.filter(r => r.grp === "not_applied");      // no application and (in this data) no saved check: the school's own grades are used
const sameAsOwnGrades = await (async () => { for (const r of unchecked) { const i = await independent(r.scholar_id_number); if (r.failed !== i.failed || r.inc !== i.inc) return r.scholar_id_number + " " + JSON.stringify([r.failed, r.inc, i]); } return true; })();
check("a scholar CEDO has not checked yet gets the result from the school's own grades for the judged semester (every such scholar matches a separate count of the grades)", sameAsOwnGrades === true && unchecked.length > 5, String(sameAsOwnGrades));
check("…and that includes scholars with an INC, with a failed subject and with everything passed (not 'not checked yet')", unchecked.some(r => r.inc > 0) && unchecked.some(r => r.failed > 0) && unchecked.some(r => r.failed === 0 && r.inc === 0 && r.grades_state === "ready") && unchecked.every(r => r.grades_state !== null));
check("a scholar whose grades are not all in yet is 'waiting'; one with no grades at all is 'no_grades'", await (async () => { for (const r of unchecked) { const i = await independent(r.scholar_id_number); if (i.total === 0 && r.grades_state !== "no_grades") return false; if (i.total > 0 && i.ungraded > 0 && r.grades_state !== "waiting") return false; } return true; })());
check("once CEDO has checked a scholar (saved check) the saved result is used, not the school's grades", await (async () => {
  await q("insert into renewal_scholar_list_cache (school_year, term, scholar_id_number, grades_state, graded, total, failed, drp, inc, review) values ($1, $2, 'TEST-0001', 'ready', 3, 3, 2, 0, 0, 0)", [Y, T]);
  const r = (await list(lower.uid)).find(x => x.scholar_id_number === "TEST-0001");
  await q("delete from renewal_scholar_list_cache where scholar_id_number = 'TEST-0001' and school_year = $1 and term = $2", [Y, T]);
  return r.failed === 2 && r.grades_state === "ready";
})());

console.log("\nThe numbers for the progress bar");
const s = await summary(lower.uid);
const count = grp => after.filter(r => r.grp === grp).length;
check("the summary adds up to the list: total, applied, renewed, removed, not applied, not required", s.total === after.length && s.applied === count("in_process") && s.renewed === count("renewed") && s.removed === count("removed") && s.not_applied === count("not_applied") && s.not_required === count("not_required")
  && s.applied + s.renewed + s.removed + s.not_applied + s.not_required === s.total, JSON.stringify(s));
check("probation and 'with an INC or failed grade' (not counting the removed) are counted", s.probation === after.filter(r => r.probation).length && s.with_inc_or_failed === after.filter(r => (r.failed > 0 || r.inc > 0) && r.grp !== "removed").length, JSON.stringify(s));
check("the summary says which semester the grades are judged for", typeof s.basis_school_year === "string" && typeof s.basis_term === "string");
check("a window nobody applied in gives every scholar 'not applied' and 0 processed", await (async () => { const o = await list(lower.uid, "2099-2100", "1st Semester"); return o.length > 0 && o.every(r => r.grp === "not_applied"); })());

console.log("\nThe windows");
const wins = await rows(lower.uid, "select * from public.school_renewal_windows()");
check("the school sees the windows that apply to it", wins.some(w => w.school_year === Y && w.term === T));
await q("update renewal_windows set school_ids = array[$2::uuid] where id = $1", [win.id, higher.school_id]);
check("a window for other schools only is not shown to this school, and is shown to the other one", !(await rows(lower.uid, "select * from public.school_renewal_windows()")).some(w => w.school_year === Y && w.term === T)
  && (await rows(higher.uid, "select * from public.school_renewal_windows()")).some(w => w.school_year === Y && w.term === T));
await q("update renewal_windows set school_ids = null where id = $1", [win.id]);
await q("update renewal_windows set testers = array['TEST-0001'] where id = $1", [win.id]);
check("a testers-only window is hidden from a school that has none of the testers", !(await rows(higher.uid, "select * from public.school_renewal_windows()")).some(w => w.school_year === Y && w.term === T));
await q("update renewal_windows set testers = null where id = $1", [win.id]);
check("a scholar cannot ask for the windows", !(await attempt(seedId("scholar:1"), "select * from public.school_renewal_windows()")).ok);

console.log("\nThe undo and the file");
await db.exec(read(UNDO));
check("after the undo the functions are gone", (await q("select to_regprocedure('public.school_renewal_list(text,text)') is null a, to_regprocedure('public.school_renewal_summary(text,text)') is null b, to_regprocedure('public.school_renewal_windows()') is null c, to_regprocedure('public._school_renewal_rows(text,text)') is null d"))[0].a);
await db.exec(read(FILE));
const text = read(FILE).replace(/--.*$/gm, "");
check("functions only: no table is changed or emptied", !/(alter table|drop table|delete from|truncate|create table|insert into|update public)/i.test(text) && (text.match(/create or replace function/gi) ?? []).length === 4);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
await db.close?.();
