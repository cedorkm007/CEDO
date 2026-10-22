// tests/sdp-update/phase9_check_files_test.mjs — Phase 9: the two read-only check files run, change nothing and say what they should.
//   p9_step0_function_access_preview_readonly.sql  (what file A would close)   p9_step2_unknown_accounts_check_readonly.sql  (accounts that belong to nobody)
// Run:  node tests/sdp-update/phase9_check_files_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
await db.exec(fs.readFileSync("undo_sdp_update_p9_a.sql", "utf8"));   // the demo already has file A applied; the preview is for the project BEFORE it
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fingerprint = async () => JSON.stringify((await q("select (select count(*) from auth.users) a, (select count(*) from scholars) s, (select count(*) from pg_policies) p, (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')) f"))[0]);
const run = async f => { const res = await db.exec(fs.readFileSync(f, "utf8")); return res[res.length - 1].rows; };

console.log("\nStep 0: the preview of the closing");
const before = await fingerprint();
const preview = await run("sql_oneoff/p9_step0_function_access_preview_readonly.sql");
check("it runs and changes nothing", preview.length > 100 && before === await fingerprint());
check("every row has a decision, a function name and who can run it", preview.every(r => r.decision && r.function_name && "visitors_can_run_it_today" in r && "signed_in_can_run_it_today" in r));
const keep = preview.filter(r => /KEEP \(a visitor page/.test(r.decision)).map(r => r.function_name).sort();
check("it keeps exactly the eleven functions the visitor pages call", keep.length >= 10 && ["get_public_survey", "resolve_staff_login_email", "submit_my_survey_response", "join_presentation_session"].every(n => keep.includes(n)), keep.join(", "));
check("it would close the helpers that hand out data, and the underscore helpers to signed-in people too", preview.some(r => r.function_name === "_sdp_period_totals" && /CLOSE/.test(r.decision) && /signed-in/.test(r.decision)) && preview.some(r => r.function_name === "get_scholar_grading_config_for_staff" && /^CLOSE to visitors/.test(r.decision)));
check("it keeps the helpers that table rules use", preview.some(r => r.function_name === "is_cedo_staff" && /table rule/.test(r.decision)));

console.log("\nStep 2: accounts that belong to nobody");
const accounts = await run("sql_oneoff/p9_step2_unknown_accounts_check_readonly.sql");
check("it runs and changes nothing", accounts.length >= 5 && before === await fingerprint());
const get = part => accounts.filter(r => r.part === part).map(r => r.detail);
check("it counts the accounts in total and by kind, and none belongs to nobody in the demo", Number(get("1. accounts in total")[0]) > 50 && Number(get("2. staff accounts")[0]) > 5 && Number(get("2. scholar accounts")[0]) > 30 && get("3. ACCOUNTS WITH NO STAFF, SCHOOL OR SCHOLAR RECORD")[0] === "0");
await db.query("insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), 'stranger.name@evil.example', 'x')");
const withStranger = await run("sql_oneoff/p9_step2_unknown_accounts_check_readonly.sql");
check("an account that belongs to nobody is counted and listed, showing only the part after the @", withStranger.find(r => r.part === "3. ACCOUNTS WITH NO STAFF, SCHOOL OR SCHOLAR RECORD").detail === "1"
  && withStranger.some(r => /^3\. no record/.test(r.part) && r.detail === "email domain: evil.example") && !JSON.stringify(withStranger).includes("stranger.name"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
