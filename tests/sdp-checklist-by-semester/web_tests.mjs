// tests/sdp-checklist-by-semester/web_tests.mjs — the SDP Checklist's Semester choice: the semester being renewed is its own view (only how it is shown)
// Run:  node tests/sdp-checklist-by-semester/web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const tab = src("src/sead/pages/SDPMonitoringTab.tsx"), api = src("src/sead/sdpMonitorApi.ts");
const section = tab.slice(tab.indexOf("function ChecklistSection()"));
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The picker");
test("the screen asks the database which semester is being renewed (and how many are renewed, and whether the renewal is open) when it opens", () => {
  assert.ok(api.includes('supabase.rpc("sdp_checklist_renewal_period")') && /export async function fetchSdpChecklistRenewalPeriod\(\): Promise<SdpRenewalPeriod \| null>/.test(api));
  assert.ok(section.includes("fetchSdpChecklistRenewalPeriod()") && section.includes("setRenewal(ren)"));
});
test("a missing database update (or any failure) just means no extra choice: the function answers null", () => {
  assert.ok(/if \(error \|\| !r\) return null;/.test(api));
});
test("the semester being renewed is added to the Semester choice (even before CEDO lists it as a period) and named 'renewed scholars'", () => {
  assert.ok(section.includes("list.push({ id: periodKey(renewal.schoolYear, renewalTerm)") && section.includes("— renewed scholars"));
});
test("choosing it asks the same page and counts functions as any semester (the database does the filtering to the renewed scholars)", () => {
  assert.ok(section.includes("fetchSdpChecklistPage({") && section.includes("schoolYear: chosen.schoolYear, semester: chosen.term"));
});

console.log("\nThe notes");
test("while the renewal window is open a note says the numbers are subject to change", () => {
  assert.ok(section.includes("{renewal?.ongoing && (") && section.includes('data-testid="sdp-renewal-ongoing-note"') && section.includes("subject to change"));
});
test("the renewal semester says what it lists (only the renewed scholars so far), what the numbers are, and that it fills in as renewals are confirmed", () => {
  const n = section.slice(section.indexOf('data-testid="sdp-renewal-semester-note"'), section.indexOf('data-testid="sdp-before-renewal-note"'));
  assert.ok(n.includes("only the scholars renewed so far") && n.includes("3 credits per category were used") && n.includes("added to the requirement") && n.includes("fills in as renewals are confirmed"));
});
test("the current semester says it shows everyone before the renewal and points to the renewal semester's view", () => {
  const n = section.slice(section.indexOf("{renewal && effectiveKey === currentKey && ("), section.indexOf("{chosen && currentKey && effectiveKey !== currentKey"));
  assert.ok(n.includes('data-testid="sdp-before-renewal-note"') && n.includes("as it stands before the renewal"));
});
test("the plain 'you are viewing another semester' note is not repeated on the renewal semester", () => {
  assert.ok(section.includes("effectiveKey !== currentKey && effectiveKey !== renewalKey"));
});

console.log("\nNothing else changed");
test("the scholar's own SDP tab is not touched by this change", () => {
  const scholar = src("src/scholar/components/dashboard/SDPPanel.tsx");
  assert.equal(/sdp_checklist_renewal_period|fetchSdpChecklistRenewalPeriod/.test(scholar), false);
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
