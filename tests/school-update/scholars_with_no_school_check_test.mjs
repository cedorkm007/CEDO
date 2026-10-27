// tests/school-update/scholars_with_no_school_check_test.mjs — the read-only list of scholars with no school set (sql_oneoff/scholars_with_no_school_readonly.sql)
// Run:  node tests/school-update/scholars_with_no_school_check_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const SQL = fs.readFileSync("sql_oneoff/scholars_with_no_school_readonly.sql", "utf8");
const tables = ["scholars", "schools", "school_aliases", "renewal_windows"];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await q(`select count(*)::int n from public.${t}`))[0].n])));

// the project's situation: a few active scholars whose school matches nothing (a spelling nobody merged, and a blank), plus a Removed one (must not be listed)
const ids = (await q("select scholar_id_number s from scholars where status not in ('Removed', 'On leave') order by 1 limit 4")).map(r => r.s);
await q("update scholars set school_id = null, school = 'Sample Univ. (typo)' where scholar_id_number = any ($1)", [ids.slice(0, 2)]);
await q("update scholars set school_id = null, school = 'Sample Univ. (typo)' where scholar_id_number = $1", [ids[2]]);
await q("update scholars set school_id = null, school = '' where scholar_id_number = $1", [ids[3]]);
const removed = (await q("select scholar_id_number s from scholars where status = 'Removed' limit 1"))[0]?.s;
if (removed) await q("update scholars set school_id = null where scholar_id_number = $1", [removed]);
const before = await counts();
const noLink = (await q("select count(*)::int n from scholars where school_id is null and status not in ('Removed', 'On leave')"))[0].n;
const res = await db.exec(SQL);
const rows = res[res.length - 1]?.rows ?? [];
const after = await counts();

console.log("\nThe list");
check("it returns rows and says how many active scholars have no school linked", rows.some(r => r.part === "1. SUMMARY" && r.item.startsWith("active scholars with no school") && Number(r.value) === noLink && noLink >= 4), JSON.stringify(rows.filter(r => r.part === "1. SUMMARY")));
const group = rows.find(r => r.part === "2. BY WHAT IS TYPED" && r.item === "Sample Univ. (typo)");
check("it groups them by what is typed on the record (so one school spelled several ways stands out), with the IDs", group && /^3 scholar\(s\)/.test(group.value) && group.value.includes(ids[0]), JSON.stringify(group));
check("a blank school shows as '(nothing typed)'", rows.some(r => r.part === "2. BY WHAT IS TYPED" && r.item === "(nothing typed)" && /1 scholar/.test(r.value)));
check("it lists the official schools with their scholar counts, for reference", rows.filter(r => r.part.startsWith("3.")).length >= 4);
check("it lists each scholar by Scholar ID with the typed school, status and year level", ids.every(id => rows.some(r => r.part.startsWith("4.") && r.item === id && /typed:/.test(r.value))));
check("a Removed scholar is not listed", !removed || !rows.some(r => r.part.startsWith("4.") && r.item === removed));
check("it never prints a scholar's name", !rows.some(r => /\bTEST\s+(All Passed|One Failed|Two Failed|Equal)/i.test(r.item + " " + r.value)));
check("it changed nothing (every table has the same number of rows)", JSON.stringify(before) === JSON.stringify(after));
const body = SQL.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
check("the file only reads: no insert, update, delete, drop or alter", !/\b(insert|update|delete|alter|truncate|drop|create)\b/i.test(body));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
