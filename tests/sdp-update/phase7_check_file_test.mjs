// tests/sdp-update/phase7_check_file_test.mjs — Phase 7 step 0: the read-only live check file runs, changes nothing and covers the 12 tables.
// Run:  node tests/sdp-update/phase7_check_file_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const TABLES = ["users", "staff_account_tags", "notifications", "leave_requests", "submissions", "accomplishment_logs", "chat_messages", "divisions", "programs", "division_change_log", "sead_scholar_account_log", "sdp_attendance"];
const fingerprint = async () => JSON.stringify((await db.query("select (select count(*) from pg_policies) p, (select count(*) from pg_class where relrowsecurity) r, (select count(*) from users) u, (select count(*) from scholars) s")).rows);
const before = await fingerprint();
const res = await db.exec(fs.readFileSync("sql_oneoff/p7_step0_live_protection_check_readonly.sql", "utf8"));
const rows = res[res.length - 1].rows;
check("the check runs and returns rows", rows.length > 12);
check("it changes nothing (policies, protection, data)", before === await fingerprint());
check("part 1 names every one of the 12 tables", TABLES.every(t => rows.some(r => r.part === "1. PROTECTION" && r.thing === t)));
check("part 3 (what visitors and signed-in people may do) covers the tables that exist", TABLES.filter(t => rows.some(r => r.part === "1. PROTECTION" && r.thing === t && r.detail !== "TABLE NOT FOUND")).every(t => rows.some(r => r.part === "3. GRANTS" && r.thing === t)));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
