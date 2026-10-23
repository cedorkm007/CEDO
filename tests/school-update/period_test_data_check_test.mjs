// tests/school-update/period_test_data_check_test.mjs — the read-only "what was entered in the semester opened for testing?" check (sql_oneoff/period_test_data_check_readonly.sql)
// Run:  node tests/school-update/period_test_data_check_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const SQL = fs.readFileSync("sql_oneoff/period_test_data_check_readonly.sql", "utf8");
const tables = ["grading_period_settings", "academic_periods", "scholar_subjects_grades", "school_period_submissions", "grade_correction_requests", "scholar_grade_audit", "sdp_attendance", "sdp_credit_history",
  "sdp_reserved_credits", "sdp_activities", "scholars", "renewal_windows"];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await q(`select count(*)::int n from public.${t}`))[0].n])));
const before = await counts();
// as on the project: a semester that was opened later, with credits stamped to it
await q("insert into academic_periods (school_year, term, status) values ('2026-2027', '2nd Semester', 'open') on conflict (school_year, term) do nothing");
await q("update sdp_attendance set school_year = '2026-2027', semester = '2nd Semester' where id in (select id from sdp_attendance order by id limit 3)");
const before2 = await counts();
const res = await db.exec(SQL);
const rows = res[res.length - 1]?.rows ?? [];
const after = await counts();

console.log("\nThe check");
check("it returns rows and no section reports an error", rows.length > 8 && rows.filter(r => r.part === "ERROR").length === 0, JSON.stringify(rows.filter(r => r.part === "ERROR")));
check("it shows the current grading period and the periods with their status", rows.some(r => r.part === "1. CURRENT PERIOD") && rows.some(r => r.part === "1. PERIODS" && r.item === "2026-2027 · 2nd Semester" && /status open/.test(r.value)));
check("it counts the grades of each semester, with the schools and dates", rows.some(r => r.part === "2. GRADES" && /grades, \d+ scholars, \d+ schools/.test(r.value)));
check("it counts the SDP credits of each semester, how many were typed by staff, and lists the activities and scholars of the opened semester",
  rows.some(r => r.part === "4. SDP CREDITS" && r.item.startsWith("2026-2027 · 2nd Semester") && /^3 credits/.test(r.value)) && rows.some(r => r.part.startsWith("4. SDP CREDITS in 2026-2027")) && rows.filter(r => r.part.startsWith("4. SCHOLARS")).length >= 1);
check("it never prints a scholar's name", !rows.some(r => /\bTEST\s+(All Passed|One Failed|Two Failed)/i.test(r.item + " " + r.value)));
check("it changed nothing (every table has the same number of rows)", JSON.stringify(before2) === JSON.stringify(after), JSON.stringify([before2, after]));
const body = SQL.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
check("the file only reads: no insert into a real table, update, delete, drop of a real table or alter", !/\b(update|delete|alter|truncate)\b/i.test(body) && !/insert into (?!_pt)/i.test(body) && !/drop table (?!if exists pg_temp)/i.test(body));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
