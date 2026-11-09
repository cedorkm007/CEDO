// tests/grades-any-increment/db_tests.mjs — a school with a conversion table can enter a grade in ANY increment (1.1, 1.2 ...), not only the table's own grades (5 checks, short on purpose)
// Run:  node tests/grades-any-increment/db_tests.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const read = f => fs.readFileSync(f, "utf8");
const NEW = "supabase_migration_grades_any_increment.sql", UNDO = "undo_grades_any_increment.sql";
const school = (await q("select id from schools where name like '%Lower-Is-Better%'"))[0].id;
await q("delete from school_grading_versions where school_id = $1", [school]);
const ver = (await q("insert into school_grading_versions (school_id, version_no, effective_year, effective_term, entry_mode, passing_mark_pct) values ($1, 1, '2000-2001', '1st Semester', 'either', 75) returning id", [school]))[0].id;
const bands = [[97, 100, "1.00"], [94, 96.99, "1.25"], [91, 93.99, "1.50"], [75, 90.99, "2.00"], [0, 74.99, "5.00"]];
for (const [i, [f, t, g]] of bands.entries()) await q("insert into school_grade_bands (version_id, sort_no, pct_from, pct_to, equivalent_grade, equivalent_value, remarks, result) values ($1, $2, $3::numeric, $4::numeric, $5::text, $5::numeric, 'x', case when $3::numeric >= 75 then 'passed' else 'failed' end)", [ver, i + 1, f, t, g]);
const entry = (grade, pct = null) => q("select * from public._grading_entry($1, '2026-2027', '1st Semester', $2, $3)", [school, grade, pct]).then(r => r[0]);
const outcome = g => q("select public._grade_outcome_at($1, $2, null, '2026-2027', '1st Semester', null) o", [school, g]).then(r => r[0].o);
await db.exec(read(NEW)); await db.exec(read(NEW));      // twice: safe

console.log("Any increment");
const [a, b, c, d] = [await entry("1.1"), await entry("1.2"), await entry("2.35"), await entry("1.25")];
check("1 grades like 1.1, 1.2 and 2.35 are accepted (and the table's own 1.25 still is)", [a, b, c, d].every(r => r.error === null && r.grade !== null), JSON.stringify([a, b, c, d].map(r => r.error)));
const z = await entry("Z");
check("2 a mark that is not a number and not in the table is still refused, listing the table's grades", /not in your conversion table\. Use one of: 1\.00, 1\.25, 1\.50, 2\.00, 5\.00/.test(z.error ?? ""), z.error);
const p = await entry(null, 95), pm = await entry("1.1", 95);
check("3 a percentage still turns into the table's grade, and a grade that disagrees with it is still refused", p.grade === "1.25" && Number(p.percentage) === 95 && /is 1\.25 in your conversion table, not 1\.1/.test(pm.error ?? ""), JSON.stringify([p, pm.error]));
check("4 a grade the table does not list is judged by the school's passing mark on the scale: 1.1 passed, 3.9 failed", (await outcome("1.1")) === "passed" && (await outcome("3.9")) === "failed", `${await outcome("1.1")} ${await outcome("3.9")}`);
await db.exec(read(UNDO));
const old = await entry("1.1");
check("5 after the undo the old rule is back: 1.1 is refused again (and 1.25 is fine)", /not in your conversion table/.test(old.error ?? "") && (await entry("1.25")).error === null, old.error);

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
