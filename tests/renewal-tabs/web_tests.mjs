// tests/renewal-tabs/web_tests.mjs — Scholar Renewal: the lists Applications, Renewed and Not applied, their sub-tabs, filters and columns
// Run:  node tests/renewal-tabs/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rtabs-"));
const outfile = path.join(tmp, "tabs.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewalTabs.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const T = await import(pathToFileURL(outfile).href);
const out2 = path.join(tmp, "actions.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewalActions.ts")], bundle: true, format: "esm", platform: "node", outfile: out2, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const A = await import(pathToFileURL(out2).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The sub-tabs");
test("Applications and Not applied have the sub-tabs Complete, 1 failed, INC, 2 failed (and Grades not in, so that nobody is left out), in that order", () => {
  for (const tab of ["applications", "not_applied"]) assert.deepEqual(T.SUBTABS[tab].map(s => s.label), ["Complete", "1 failed", "INC", "2 failed", "Grades not in"]);
});
test("Renewed has Regular, Probationary and Reconsidered", () => assert.deepEqual(T.SUBTABS.renewed.map(s => s.label), ["Regular", "Probationary", "Reconsidered"]));
test("every list starts on its first sub-tab and a stale choice is not accepted", () => {
  assert.equal(T.FIRST_SUBTAB.applications, "complete"); assert.equal(T.FIRST_SUBTAB.renewed, "regular");
  assert.equal(T.validSubTab("renewed", "failed1"), false); assert.equal(T.validSubTab("applications", "failed1"), true);
});

console.log("\nThe scholarship status column");
test("Renewed shows from and to when the status changed, one status when it did not", () => {
  assert.equal(T.statusColumnText("renewed", "Probationary", "Regular", "Probationary"), "Regular → Probationary");
  assert.equal(T.statusColumnText("renewed", "Regular", "Regular", "Regular"), "Regular");
  assert.equal(T.statusColumnText("renewed", "Reconsidered", "Removed", "Reconsidered"), "Removed → Reconsidered");
  assert.equal(T.statusColumnText("renewed", "Regular", null, null), "Regular");
});
test("Applications and Not applied show the status now", () => { assert.equal(T.statusColumnText("applications", "Probationary", "Regular", "Probationary"), "Probationary"); assert.equal(T.statusColumnText("not_applied", "", null, null), "—"); });

console.log("\nThe screen");
const list = src("src/sead/renewal/RenewalListTab.tsx"), page = src("src/sead/ScholarRenewalPage.tsx"), api = src("src/sead/renewalTabsApi.ts");
test("the tab list is Applications, Renewed, Not applied first; Scholar List, Late and INC are gone; the work tabs stay", () => {
  const labels = [...page.matchAll(/\{ key: "(\w+)", label: "([^"]+)"/g)].map(m => m[2]);
  assert.deepEqual(labels.slice(0, 3), ["Applications", "Renewed", "Not applied"]);
  for (const gone of ["Scholar List", "Late", "INC"]) assert.equal(labels.includes(gone), false, gone);
  for (const kept of ["Dashboard", "Entered grades", "SDP Reconsideration", "Consultations", "Division Head", "Windows", "Certificate"]) assert.ok(labels.includes(kept), kept);
});
test("the three tabs open the one list component, for the people who act on the lists", () => {
  assert.ok(page.includes('<RenewalListTab tab="applications"') && page.includes('<RenewalListTab tab="renewed"') && page.includes('<RenewalListTab tab="not_applied"'));
  assert.ok(page.includes('(t.key === "applications" || t.key === "renewed" || t.key === "notApplied") ? seesList'));
  assert.ok(page.includes('useState<Tab>(isEvaluator ? "applications"'));
});
test("the columns: Scholar ID, Name, Year level, School, Program, Scholarship status, SDP, Grades and (Applications, Not applied) Actions", () => {
  assert.ok(list.includes('["Scholar ID"') && list.includes('["Name"') && list.includes('["Year level"') && list.includes('["School"') && list.includes('["Program"') && list.includes('["Scholarship status"') && list.includes('["SDP"') && list.includes('["Grades"'));
  assert.ok(list.includes('...(hasActions ? [["Actions"') && list.includes('const hasActions = tab !== "renewed"'));
  assert.ok(list.indexOf('["Scholar ID"') < list.indexOf('["Name"') && list.indexOf('["Name"') < list.indexOf('["Year level"') && list.indexOf('["School"') < list.indexOf('["Program"') && list.indexOf('["Scholarship status"') < list.indexOf('["SDP"'));
});
test("the filters: year level, school, program, scholarship status, SDP and grades (and a search)", () => {
  for (const l of ['label="Year level"', 'label="School"', 'label="Program"', 'label="Scholarship status"', 'aria-label="SDP"', 'aria-label="Grades"', 'aria-label="Search scholars"']) assert.ok(list.includes(l), l);
  assert.ok(api.includes("p_statuses") && api.includes("p_sdp: f.sdp") && api.includes("p_grades: f.grades"));
});
test("the numbers on the sub-tabs follow the filters, and a sub-tab choice goes back to page 1", () => {
  assert.ok(list.includes("fetchRenewalListCounts(schoolYear, term, tab, filters)") && list.includes("setSub(s.key); setPage(1)"));
});
test("the scholar's name opens the application (when there is one); the stage and a late mark show under it on Applications", () => {
  assert.ok(list.includes("onOpenRecord(r.recordId as string)") && list.includes("RenewalStageBadge") && list.includes('tab === "applications"'));
});
test("the status column of Renewed is from-to", () => assert.ok(list.includes("statusColumnText(tab, r.status, r.fromStatus, r.toStatus)")));

console.log("\nThe actions");
test("Late applications and INC decisions are done from the Actions column: 'Decide the late application' opens the application, 'Decide on the INC' opens the INC decision for that scholar", () => {
  const row = { eligibility: [], sdpReconsideration: null, sdpApplicable: true, sdpComplied: true, sdpMissing: null, gradesState: "ready", failed: 0, drp: 0, inc: 1, review: 0 };
  const facts = stage => ({ recordId: "r1", stage, isLate: false, appliedAt: null, docsToReview: 0, consultationRequired: false, consultationDoneAt: null, nextConsultation: null, gradesStatus: "school", dhReferralId: null, dhStatus: null, referralStatus: null });
  const late = A.neededActions(row, facts("late_pending")), inc = A.neededActions(row, facts("inc_deadline_passed"));
  assert.deepEqual(late.map(a => `${a.key}:${a.label}`), ["open_application:Decide the late application"]);
  assert.deepEqual(inc.map(a => `${a.key}:${a.label}`), ["decide_inc:Decide on the INC"]);
  assert.ok(list.includes('acting?.key === "decide_inc"') && list.includes("<RenewalIncTab") && list.includes("only={{ recordId: acting.facts.recordId"));
  assert.ok(src("src/sead/renewal/RenewalIncTab.tsx").includes("only?: { recordId: string; onDone: () => void }") && src("src/sead/renewal/RenewalIncTab.tsx").includes("r.rows.filter(x => x.recordId === only.recordId)"));
});
test("Not applied adds the evaluator's 'Mark not required' to the actions, asking for a reason", () => {
  assert.ok(list.includes('tab === "not_applied" && f && !f.recordId') && list.includes('label: "Mark not required"') && list.includes("markNotRequired(marking.scholarIdNumber, schoolYear, term, reason)"));
});
test("the other actions open the same screens as before: entered grades, SDP reconsideration, the Division Head's case, a consultation referral", () => {
  for (const s of ["RenewalEnteredGradesTab", "RenewalSdpReconsiderationTab", "ReferralFormPanel", "ReferralFormModal"]) assert.ok(list.includes(`<${s}`), s);
});
test("only the staff assigned to an action can press it (the same cell as the Scholar List used)", () => {
  assert.ok(list.includes("<ActionCell") && src("src/sead/renewal/RenewalScholarListTab.tsx").includes("canDoAction(a, viewer)"));
});

console.log("\nThe database file");
test("the file and its undo exist; the file only reads", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase_migration_renewal_tabs.sql")) && fs.existsSync(path.join(root, "undo_renewal_tabs.sql")));
  const sql = src("supabase_migration_renewal_tabs.sql").replace(/--.*$/gm, "");
  assert.equal(/(create table|alter table|drop table|delete from|truncate|insert into)/i.test(sql), false);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
