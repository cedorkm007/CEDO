// tests/sdp-owed/web_tests.mjs — the credits lacking after an approved SDP reconsideration INCREASE the requirement, and the scholar sees it as soon as it is approved
// Run:  node tests/sdp-owed/web_tests.mjs
// No database or browser needed.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const api = src("src/scholar/sdpApi.ts"), panel = src("src/scholar/components/dashboard/SDPPanel.tsx");

console.log("The calls");
test("the website asks for the credits added to the coming semesters; nothing (and no error) before the database update", () => {
  assert.ok(api.includes('rpc("fetch_scholar_sdp_owed")') && /fetchScholarSDPOwed[\s\S]*if \(error \|\| !Array\.isArray\(data\)\) return \[\];/.test(api));
  assert.ok(api.includes("isCurrent: !!r.is_current") && api.includes(".filter(r => r.amount > 0)"));
});

console.log("The scholar's SDP tab");
test("the requirement is shown as a HIGHER requirement (3 + what was lacking, e.g. 0 / 5), not as negative credits", () => {
  assert.ok(panel.includes("const need = required[c.key] ?? CREDITS_REQUIRED;") && panel.includes("const count = credits[c.key] ?? 0;"));
  assert.equal(/sdpShownCredits|sdpOwedFrom/.test(panel), false);
});
test("as soon as the request is approved, a notice per coming semester says how many credits are added and the new requirement of each category (3 + n = total)", () => {
  assert.ok(panel.includes("function ComingRequirement") && panel.includes("{!loading && coming.length > 0 && <ComingRequirement rows={coming} />}"));
  assert.ok(panel.includes("Added to your SDP requirement for {termLabelOf(schoolYear, semester)}") && panel.includes("{CREDITS_REQUIRED} + {r.amount} ="));
  assert.ok(panel.includes("fetchScholarSDPOwed()") && panel.includes("setComing(owed.filter(o => !o.isCurrent))"), "the current semester is already in the boxes above; only the coming ones get the notice");
});
test("the note about the current semester's higher requirement is still there", () => assert.ok(panel.includes("Part of this semester's requirement is credit that was lacking last semester")));

console.log("The staff screens show the higher requirement too");
test("SDP Monitoring and the SDP credits window show 'credits / (3 + owed)'", () => {
  assert.ok(src("src/sead/pages/SDPMonitoringTab.tsx").includes("const goal = SDP_CATEGORY_CREDIT_GOAL + owed;"));
  assert.ok(src("src/sead/renewal/RenewalScholarListTab.tsx").includes("const need = (k: string) => data?.sdp.required[k] ?? data?.required ?? 3;"));
});
test("the words say the lacking credits are ADDED to the requirement", () => {
  for (const f of ["src/lib/renewal.ts", "src/scholar/components/dashboard/RenewalPanel.tsx", "src/sead/renewal/RenewalSdpReconsiderationTab.tsx"]) assert.ok(/added to (your|their|the|my) SDP requirement/.test(src(f)), f);
  assert.equal(/negative credits/.test(src("src/lib/renewal.ts") + src("src/sead/renewal/RenewalScholarListTab.tsx") + src("src/sead/renewal/RenewalSdpReconsiderationTab.tsx")), false);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
