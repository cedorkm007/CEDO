// tests/sdp-update/phase9_step4_test.mjs — Phase 9: the read-only default-password estimate runs, counts correctly and shows no names.
// Run:  node tests/sdp-update/phase9_step4_test.mjs
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
// Real accounts use bcrypt: make the demo's accounts look like that. Staff: 5 on 123456, the rest on something else; scholars: 30 of them on 123456, signed in.
await q("update auth.users set encrypted_password = extensions.crypt('Some-Other-Pass-77', extensions.gen_salt('bf', 6))");
await q("update auth.users set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf', 6)) where id in (select id from users order by username limit 5)");
await q("update auth.users set last_sign_in_at = now() where id in (select id from scholars)");
await q("update auth.users set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf', 6)) where id in (select id from scholars order by scholar_id_number limit 30)");
const fingerprint = async () => JSON.stringify((await q("select md5(string_agg(encrypted_password, ',' order by id)) h from auth.users"))[0]);
const before = await fingerprint();
const res = await db.exec(fs.readFileSync("sql_oneoff/p9_step4_default_password_estimate_readonly.sql", "utf8"));
const rows = res[res.length - 1].rows;
const staff = rows.find(r => r.kind === "staff"), school = rows.find(r => r.kind === "school"), scholars = rows.find(r => /^scholars/.test(r.kind));
check("it runs and changes nothing", rows.length === 3 && before === await fingerprint());
check("staff are checked one by one: exactly the 5 on 123456 are found", Number(staff.checked) === 11 && Number(staff.still_default) === 5, JSON.stringify(staff));
check("the school account is checked and is not on 123456", Number(school.checked) === 4 && Number(school.still_default) === 0, JSON.stringify(school));
check("scholars are a random sample, the share is reported and scaled up to everyone who has signed in", Number(scholars.checked) > 0 && Number(scholars.checked) <= 250 && /of \d+ scholars who have signed in \(estimate\)/.test(scholars.estimate_for_everyone), JSON.stringify(scholars));
check("with all scholars checkable (45 here, under the 250 sample) the estimate is exact: 30 of 45", Number(scholars.still_default) === 30 && Number(scholars.checked) === 45 && /^30 of 45/.test(scholars.estimate_for_everyone), JSON.stringify(scholars));
check("no names or passwords appear", !JSON.stringify(rows).match(/TEST|demo\.|123456/));
// an account whose password is not a bcrypt hash must not make the check fail
await q("update auth.users set encrypted_password = 'not-a-bcrypt-hash' where id = (select id from scholars limit 1)");
check("an account with an unusual stored password is skipped instead of stopping the check", await db.exec(fs.readFileSync("sql_oneoff/p9_step4_default_password_estimate_readonly.sql", "utf8")).then(() => true, () => false));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
