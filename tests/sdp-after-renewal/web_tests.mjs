// tests/sdp-after-renewal/web_tests.mjs — the screens that show a renewed scholar's SDP for the next semester
// Run:  node tests/sdp-after-renewal/web_tests.mjs
// No database or browser needed.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The scholar's SDP tab");
test("the tab asks which semester it shows and says so when the scholar is renewed", () => {
  const api = src("src/scholar/sdpApi.ts"), panel = src("src/scholar/components/dashboard/SDPPanel.tsx");
  assert.ok(api.includes('supabase.rpc("fetch_scholar_sdp_view")') && api.includes("shifted: !!r.shifted"));
  assert.ok(panel.includes("fetchScholarSDPView()") && panel.includes("nextSemester") && panel.includes("<strong>You are renewed.</strong>"));
  assert.ok(panel.includes("3 credits per category were used") && panel.includes("termLabelOf(nextSemester.schoolYear, nextSemester.semester)"));
});
test("before the database update the tab shows no note and works as before (the view is null)", () => {
  assert.ok(src("src/scholar/sdpApi.ts").includes("if (error || !r) return null;") && src("src/scholar/components/dashboard/SDPPanel.tsx").includes("setNextSemester(view?.shifted ?"));
});

console.log("\nThe staff SDP Checklist");
test("the Checklist asks which rows show the next semester and marks them under the name", () => {
  const api = src("src/sead/sdpMonitorApi.ts"), tab = src("src/sead/pages/SDPMonitoringTab.tsx");
  assert.ok(api.includes('supabase.rpc("scholars_sdp_advanced"') && api.includes("fetchSdpAdvanced"));
  assert.ok(tab.includes("fetchSdpAdvanced(chosen.schoolYear, chosen.term)") && tab.includes("advanced.has(s.scholarIdNumber)") && tab.includes("Renewed — showing"));
});

console.log("\nThe renewal detail page");
test("a renewed application shows the SDP after the renewal, from the database, with the requirement", () => {
  const api = src("src/sead/renewalApi.ts"), view = src("src/sead/renewal/RenewalDetailView.tsx");
  assert.ok(api.includes('supabase.rpc("renewal_sdp_after"') && api.includes("if (error || !d || !d.applies) return null;"));
  assert.ok(view.includes('r.detail.record.stage === "renewed" ? await fetchRenewalSdpAfter(recordId)') && view.includes("After the renewal — ") && view.includes("sdpAfter.requiredCommunityVolunteerism"));
});

console.log("\nThe database files");
test("the file and its undo exist; the file only replaces and adds functions", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase_migration_sdp_after_renewal.sql")) && fs.existsSync(path.join(root, "undo_sdp_after_renewal.sql")));
  const sql = src("supabase_migration_sdp_after_renewal.sql").replace(/--.*$/gm, "");
  assert.equal(/(alter table|drop table|delete from|truncate|create table|insert into|update public)/i.test(sql), false);
  assert.ok(src("supabase_migration_sdp_after_renewal.sql").includes("STOPPED, nothing changed: run the SDP reconsideration files"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
