// tests/sdp-reconsideration/tick_before_grades_web_tests.mjs — the SDP reconsideration tick is offered right away (also while the grades still have to be entered)
// Run:  node tests/sdp-reconsideration/tick_before_grades_web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const p = fs.readFileSync("src/scholar/components/dashboard/RenewalPanel.tsx", "utf8").split("\r\n").join("\n");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
test("the tick is shown whenever the scholar may ask (SDP lacking, no request yet), with no wait for the grades", () => {
  assert.ok(p.includes("{preview && canAskReconsideration && (\n            <div") && !p.includes("canAskReconsideration && !gradesReady") && !p.includes("canAskReconsideration && gradesReady"));
  assert.ok(p.includes('<input type="checkbox" checked={askReconsideration} onChange={e => setAskReconsideration(e.target.checked)}'));
});
test("while grades are still missing it says so: you can tick now, and the application with the request is sent after the grades", () => {
  assert.ok(p.includes('data-testid="sdp-tick-grades-note"') && p.includes("You can tick it now."));
});
test("the choice is remembered and sent when ticked, whatever the order (the grades are what the Next button waits for)", () => {
  assert.ok(p.includes("const wantsReconsideration = canAskReconsideration && askReconsideration;") && p.includes("requestSdpReconsideration: wantsReconsideration"));
  assert.ok(p.includes("disabled={!preview || !gate.open}"));
});
test("the red 'cannot go on' message always points to the tick when the SDP is lacking and a request can be made", () => {
  assert.ok(p.includes('{canAskReconsideration ? "Tick the box above to ask for an SDP reconsideration, and you can go on." :'));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
