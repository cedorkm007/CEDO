// tests/school-update/renewal_test_data_check_test.mjs — the read-only "what renewal test data is there?" check (sql_oneoff/renewal_test_data_check_readonly.sql)
// It runs on the demo's hypothetical data, finds the data, reports no errors, and changes nothing.
// Run:  node tests/school-update/renewal_test_data_check_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const SQL = fs.readFileSync("sql_oneoff/renewal_test_data_check_readonly.sql", "utf8");

const tables = ["renewal_windows", "renewal_records", "renewal_history", "renewal_documents", "renewal_inc_items", "counseling_slots", "counseling_availability", "counseling_booking_history", "scholar_notifications",
  "scholar_counseling_referrals", "scholar_counseling_records", "scholar_status_history", "csr_issued", "csr_counters", "renewal_notice_log", "push_outbox", "renewal_export_log", "scholars"];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await q(`select count(*)::int n from public.${t}`))[0].n])));
const before = await counts();
const statements = SQL.split(/;\s*\n(?=drop|create|do|select)/i);   // the file is run as the SQL editor runs it: one go
let result;
for (const s of [SQL]) { const res = await db.exec(s); result = res[res.length - 1]?.rows ?? []; }
const rows = result;
const after = await counts();

console.log("\nThe check");
check("it returns rows", rows.length > 10, String(rows.length));
check("no section reports an error", rows.filter(r => r.part === "ERROR").length === 0, JSON.stringify(rows.filter(r => r.part === "ERROR")));
check("it shows the windows, and says who each is for", rows.filter(r => r.part === "1. WINDOW").length >= 2 && rows.some(r => /OPEN TO EVERYONE|TESTERS ONLY/.test(r.value)));
check("it lists the applications by Scholar ID and stage", rows.some(r => r.part === "2. APPLICATIONS" && /TEST-\d{4} \[/.test(r.value)));
check("it shows the renewal's status changes with the scholar's status now", rows.some(r => r.part === "3. STATUS CHANGES" && /->/.test(r.value) && /now:/.test(r.value)));
check("it shows the consultation bookings by state, the Daily Records and the certificates", rows.some(r => r.item === "bookings by state") && rows.some(r => r.item.startsWith("Daily Records made")) && rows.some(r => r.item === "certificates issued"));
check("it never prints a scholar's name", !rows.some(r => /\bTEST\s+(All Passed|One Failed|Two Failed)/i.test(r.item + " " + r.value)));
check("it changed nothing (every table has the same number of rows)", JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
check("the file only reads: no insert, update, delete, drop of a real table or alter", !/\b(update|delete|alter|truncate)\b/i.test(SQL.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''")) && !/drop table (?!if exists pg_temp)/i.test(SQL));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
