// tests/sdp-monitoring/run.mjs — website checks for the SDP Monitoring fixes (no database or browser needed).  Run:  node tests/sdp-monitoring/run.mjs
// Source guards: the result column says only Complied / Not complied, the pubmat is saved through the checked function (and never reported as saved
// when nothing changed), the QR screen offers more codes for both attendance types, and the Renewal reminder says "Renew your scholarship before …".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`); }
}

test("the SDP Result column shows only Complied or Not complied (no list of what is missing)", () => {
  const tab = read("src/sead/pages/SDPMonitoringTab.tsx");
  assert.equal(/s\.missing/.test(tab), false, "the 'missing' text is no longer shown");
  const cell = /<ComplianceBadge row=\{s\} \/>[^]*?<\/td>/.exec(tab)[0];
  assert.equal(/<p/.test(cell), false, "nothing but the badge in the cell");
  assert.match(tab, /Complied<\/span>/); assert.match(tab, /Not complied<\/span>/);
});

test("the pubmat is saved through set_activity_pubmat; an update that changed nothing is an error, and a replaced picture gets a new name", () => {
  const api = read("src/sead/pubmatApi.ts");
  assert.match(api, /rpc\("set_activity_pubmat", \{ p_type: type, p_id: id, p_path: path \}\)/);
  assert.match(api, /\.update\(\{ pubmat_path: path \}\)\.eq\("id", id\)\.select\("id"\)/); assert.match(api, /data\.length === 0/);
  assert.match(api, /pubmat-\$\{Date\.now\(\)\}/);
  assert.match(api, /return savePubmatPath\(type, id, null\)/);
});

test("creating an SDP activity with a pubmat that fails does not leave a second press of Create to make a duplicate", () => {
  const tab = read("src/sead/pages/SDPMonitoringTab.tsx");
  assert.match(tab, /setCreatedWithoutPubmat\(true\); onCreated\(\)/); assert.match(tab, /createdWithoutPubmat \? onClose : handleCreate/);
});

test("the QR screen explains recurring activities and offers more codes for BOTH attendance types; the roster shows days and the survey wait", () => {
  const tab = read("src/sead/pages/SDPMonitoringTab.tsx"), api = read("src/sead/sdpMonitorApi.ts");
  assert.match(tab, /This is a recurring activity: each scholar can scan once for every day/); assert.match(tab, /Add time-in \/ time-out codes/);
  assert.equal(/session\.type === "voucher" && \(\s*<div className="mb-3 rounded-lg bg-\[#f8fafd\] p-3">/.test(tab), false, "the top-up box is no longer voucher-only");
  assert.match(tab, /Waiting for survey/); assert.match(tab, /completedDays/);
  assert.match(api, /sessionInfo\?\.type === "time_in_time_out" \? \["time_in", "time_out"\] : \["voucher"\]/);
});

test("the Credited Scholars tab lists scholars who scanned but have no credit, with the reason, and warns when an activity has no category", () => {
  const tab = read("src/sead/pages/SDPMonitoringTab.tsx"), api = read("src/sead/sdpMonitorApi.ts");
  assert.match(tab, /Scanned the QR code but not credited/); assert.match(tab, /no SDP category/);
  for (const reason of ["Waiting for the scholar to answer the survey", "This activity has no SDP category", "Attended, but no credit was recorded"]) assert.ok(api.includes(reason), reason);
});

test("the Renewal reminder says “Renew your scholarship before <date>” everywhere it is built", () => {
  const src = read("src/scholar/renewalSummary.ts");
  assert.match(src, /Renew your scholarship before \$\{formatDay\(w\.window\.closesOn\)\}\./); assert.equal(/Apply by/.test(src), false);
  for (const p of ["src/scholar", "src/lib", "src/sead/renewal"]) for (const f of fs.readdirSync(path.join(root, p), { recursive: true }).filter(x => /\.tsx?$/.test(String(x)))) assert.equal(/Apply by/.test(read(`${p}/${f}`)), false, `${p}/${f}`);
});

test("both new SQL files exist and say where they must be run", () => {
  const a = read("supabase_migration_sdp_recurring_attendance_fix.sql"), b = read("supabase_migration_activity_pubmats_sdp_monitors.sql");
  assert.match(a, /Asia\/Manila/); assert.match(a, /create or replace function public\._apply_attendance/); assert.match(a, /time_in_count/);
  assert.match(b, /create policy "activity monitors manage their pubmats"/); assert.match(b, /create or replace function public\.set_activity_pubmat/);
  assert.equal(/to anon/.test((a + b).replace(/--.*$/gm, "")), false);
});

test("the Credited Scholars tab has a button that credits the scholars who attended, through credit_attended_scholars, after a question", () => {
  const tab = read("src/sead/pages/SDPMonitoringTab.tsx"), api = read("src/sead/sdpMonitorApi.ts"), sql = read("supabase_migration_sdp_credit_attended_scholars.sql");
  assert.match(tab, /Credit these scholars \(/); assert.match(tab, /window\.confirm\(`Credit \$\{n\} scholar/); assert.match(tab, /creditAttendedScholars\(activity\.id\)/);
  assert.match(api, /rpc\("credit_attended_scholars", \{ p_activity_id: activityId \}\)/); assert.match(api, /canCredit: m\.status === "present" && !!category/);
  assert.match(sql, /r\.status = 'present'/); assert.match(sql, /not exists \(select 1 from public\.sdp_attendance c/); assert.equal(/to anon/.test(sql.replace(/--.*$/gm, "")), false);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
