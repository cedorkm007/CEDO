// tests/sdp-reconsideration/approved_clear_web_tests.mjs — once an SDP reconsideration is approved, nothing says the SDP is lacking, and the form says there is nothing to tick
// Run:  node tests/sdp-reconsideration/approved_clear_web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const panel = fs.readFileSync("src/scholar/components/dashboard/RenewalPanel.tsx", "utf8").split("\r\n").join("\n");
const summary = panel.slice(panel.indexOf("function EvaluationSummary("), panel.indexOf("function Tracker("));
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("an approved request counts as approved even when the plain credit check says 'not complied' (rcApproved)", () => {
  assert.ok(summary.includes('const rcApproved = !!sdp?.applicable && (sdp.reconsideration?.status === "approved" || !!sdp.by_reconsideration);'));
});
test("when approved: the green 'Complied through your approved SDP reconsideration' line shows, and the amber 'Not complied yet' line does not", () => {
  assert.ok(summary.includes("{rcApproved && <p className=\"text-[14px] text-green-800") && summary.includes("Complied through your approved SDP reconsideration."));
  assert.ok(summary.includes("{sdp?.applicable && !sdp.complied && !rcApproved && <p"));
});
test("the plain 'Complied — you have the credits needed' line is not shown together with the approved line", () => {
  assert.ok(summary.includes("{sdp?.applicable && sdp.complied && !rcApproved && <p"));
});
test("the application form says: your SDP is settled, nothing to tick, and (while grades are missing) only the grades are still needed", () => {
  assert.ok(panel.includes('data-testid="sdp-already-approved"') && panel.includes("Your SDP is settled.") && panel.includes("there is nothing to tick or ask for") && panel.includes('gate.blocker === "grades" ? " Only your grades are still needed before you can go on." : ""'));
});
test("the choice to ask is still only offered when there is no request yet (an approved one hides it)", () => {
  assert.ok(panel.includes("&& !preview.sdp.reconsideration;") || /canAskReconsideration = [^;]*!preview\.sdp\.reconsideration/.test(panel));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
