// tests/sdp-update/phase9_review_file_test.mjs — Phase 9: the read-only "what changed since 19 August" review runs, changes nothing and reports what it should.
// Run:  node tests/sdp-update/phase9_review_file_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb, seedId } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const SEAD = seedId("staff:demo.sead"), PLAIN = seedId("staff:demo.plain");
// A few things that happened "since 19 August": a credit by someone without the tool, a late code in an old session, a stranger's sign-up, a recent tag.
await q("insert into auth.users (id, email, encrypted_password, created_at) values (gen_random_uuid(), 'poc.test@gmail.com', 'x', '2026-09-20 09:26+08')");
await q("insert into sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, created_at, occurrence_number) select id, 'TEST-0001', '2026-10-01', $1, '2026-10-01 10:00+08', 99 from sdp_activities limit 1", [PLAIN]);
await q("update staff_account_tags set created_at = '2026-10-02 09:00+08' where staff_id = $1 and tag_key = 'sdp_monitoring'", [SEAD]);
const before = JSON.stringify((await q("select (select count(*) from sdp_attendance) a, (select count(*) from staff_account_tags) t, (select count(*) from auth.users) u, (select count(*) from pg_policies) p"))[0]);
const res = await db.exec(fs.readFileSync("sql_oneoff/p9_step3_what_changed_since_19_aug_readonly.sql", "utf8"));
const rows = res[res.length - 1].rows;
check("it runs and returns rows", rows.length > 5);
check("it changes nothing", before === JSON.stringify((await q("select (select count(*) from sdp_attendance) a, (select count(*) from staff_account_tags) t, (select count(*) from auth.users) u, (select count(*) from pg_policies) p"))[0]));
const part = p => rows.filter(r => r.part === p);
check("a part that cannot run on this database says so and the other parts still run", rows.some(r => r.thing === "skipped") && rows.some(r => !/skipped/.test(r.thing)));
check("the new sign-in account is listed with only the part after the @", part("1. NEW SIGN-IN ACCOUNTS").some(r => /gmail\.com \| never signed in \| confirmed/.test(r.thing)) && !JSON.stringify(rows).includes("poc.test"));
check("the credit added by someone without the SDP tool is reported", part("6. CREDITS BY SOMEONE WITHOUT THE TOOL").some(r => r.thing === "demo.plain" && /1 credit/.test(r.detail)));
check("credits are counted per day with the person named", part("5. SDP CREDITS ADDED").some(r => /2026-10-01 \| by demo\.plain/.test(r.thing)));
check("the recently given tool tag is listed with the staff user name", part("4. TOOL TAGS GIVEN").some(r => r.thing === "demo.sead" && /sdp_monitoring/.test(r.detail)));
check("staff roles list the administrators", part("3. STAFF ROLES").some(r => r.thing === "demo.admin" && /super_admin/.test(r.detail)));
check("no scholar's name or ID is shown anywhere in the review", !rows.some(r => /TEST-\d{4}|TEST All Passed/.test(r.thing + " " + r.detail)));
check("the credit-history and grade-audit parts run (the demo has both)", !part("7. CREDIT HISTORY").some(r => r.thing === "skipped") && !part("10. GRADE CHANGES").some(r => r.thing === "skipped"));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
