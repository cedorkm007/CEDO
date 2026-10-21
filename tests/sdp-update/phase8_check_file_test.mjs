// tests/sdp-update/phase8_check_file_test.mjs — Phase 8 step 0: the read-only "broad access" check runs, changes nothing, and sorts rules sensibly.
// Run:  node tests/sdp-update/phase8_check_file_test.mjs   (add --show to print the demo's broad rules)
import { buildDb } from "../../localdemo/build.mjs";
import { seedDb } from "../../localdemo/seed.mjs";
import fs from "node:fs";

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
await seedDb(db);
const fingerprint = async () => JSON.stringify((await db.query("select (select count(*) from pg_policies) p, (select count(*) from pg_class where relrowsecurity) r, (select count(*) from scholars) s")).rows);
const before = await fingerprint();
const res = await db.exec(fs.readFileSync("sql_oneoff/p8_step0_broad_access_check_readonly.sql", "utf8"));
const rows = res[res.length - 1].rows;
check("it runs and returns rows", rows.length > 50);
check("it changes nothing", before === await fingerprint());
const rules = rows.filter(r => r.part === "1. RULE");
const kind = r => r.detail.split(" | ")[0];
check("it sorts every rule into a group", rules.length > 50 && rules.every(r => ["ANY SIGNED-IN", "ANY STAFF", "TAG", "OWN", "OTHER"].includes(kind(r))));
check("the Phase 7 'staff full access' replacement and the SDP tag rule are sorted correctly", rules.some(r => r.thing === "staff_account_tags" && kind(r) === "ANY STAFF") && rules.some(r => r.thing === "sdp_activities" && kind(r) === "TAG"));
check("it lists the helper functions and the tags", rows.some(r => r.part === "4. HELPER" && /is_cedo_staff/.test(r.thing)) && rows.some(r => r.part === "5. TAG"));
if (process.argv.includes("--show")) {
  const by = {};
  for (const r of rules) if (["ANY STAFF", "ANY SIGNED-IN"].includes(kind(r))) (by[r.thing] ??= []).push(kind(r) + " " + r.detail.split(" | ")[2]);
  for (const [t, v] of Object.entries(by).sort()) console.log("   ", t, "→", v.join(", "));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
