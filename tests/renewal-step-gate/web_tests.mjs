// tests/renewal-step-gate/web_tests.mjs — the Next button of "Check your SDP and grades" opens only for the four allowed cases
// Run:  node tests/renewal-step-gate/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rgate-"));
const outfile = path.join(tmp, "renewal.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewal.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const ev = ({ schoolGrades = false, selfStatus = null, complied = true, rc, applicable = true, inForm = true } = {}) => ({
  grades_in_form: inForm,
  grades: { state: "ready", school_submitted: schoolGrades, self_status: selfStatus, reason: "", counts: {}, failed_subjects: [], inc_subjects: [], review_subjects: [] },
  sdp: { applicable, complied, missing: complied ? null : "x", lacking: complied ? {} : { community_service: 1 }, reconsideration: rc },
});
const gate = (e, entered = false, asked = false) => R.renewalNextGate(e, { gradesEntered: entered, reconsiderationAsked: asked });

console.log("The four cases that may go on");
test("1 + 3: the grades are complete (school's upload) and the SDP is complied: go on, nothing to wait for", () => {
  const g = gate(ev({ schoolGrades: true })); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, []);
});
test("1 + 3 also when the scholar's own grades were already approved", () => { const g = gate(ev({ selfStatus: "approved" })); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, []); });
test("2 + 3: the scholar entered the grades and the SDP is complied: go on, then wait for the Grades Approver", () => {
  const g = gate(ev(), true); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, ["grades"]);
});
test("1 + 4: grades complete, SDP not complied but a reconsideration is asked for: go on, then wait for the SDP approver", () => {
  const g = gate(ev({ schoolGrades: true, complied: false }), false, true); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, ["sdp"]);
});
test("2 + 4: entered grades and a reconsideration asked for: go on, then wait for both approvers", () => {
  const g = gate(ev({ complied: false }), true, true); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, ["grades", "sdp"]);
});

console.log("\nEverything else stays on the screen");
test("SDP not complied and no reconsideration asked for: cannot go on, even with complete grades", () => {
  const g = gate(ev({ schoolGrades: true, complied: false })); assert.equal(g.open, false); assert.equal(g.blocker, "sdp");
});
test("SDP not complied, no reconsideration, grades entered: cannot go on", () => assert.equal(gate(ev({ complied: false }), true, false).open, false));
test("no grades at all (not uploaded, not entered): cannot go on, whatever the SDP", () => {
  assert.equal(gate(ev()).open, false); assert.equal(gate(ev()).blocker, "grades");
  assert.equal(gate(ev({ complied: false }), false, true).open, false);
});
test("grades entered but not finished (the form is not complete yet) count as not entered", () => assert.equal(gate(ev({ selfStatus: "pending" }), false).open, false));
test("a reconsideration that was denied does not open the way", () => assert.equal(gate(ev({ schoolGrades: true, complied: false, rc: { id: "1", status: "denied" } })).open, false));
test("nothing is decided before the evaluation has loaded", () => assert.equal(gate(null).open, false));

console.log("\nOther situations");
test("an already approved reconsideration lets the scholar go on and there is no SDP approver to wait for", () => {
  const g = gate(ev({ schoolGrades: true, complied: false, rc: { id: "1", status: "approved" } })); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, []);
});
test("a reconsideration still pending counts as asked for and is waited for", () => {
  const g = gate(ev({ schoolGrades: true, complied: false, rc: { id: "1", status: "pending" } })); assert.equal(g.open, true); assert.deepEqual(g.waitsFor, ["sdp"]);
});
test("no SDP requirement (summer): only the grades matter", () => { assert.equal(gate(ev({ schoolGrades: true, applicable: false, complied: null })).open, true); });
test("before the database update that puts grades in the form, grades do not block (only the SDP does)", () => {
  assert.equal(gate(ev({ inForm: false })).open, true); assert.equal(gate(ev({ inForm: false, complied: false })).open, false);
});

console.log("\nThe screen");
const panel = src("src/scholar/components/dashboard/RenewalPanel.tsx");
test("the Next button of the check screen follows the gate and says why it is closed or what happens next", () => {
  assert.ok(panel.includes("renewalNextGate(preview, { gradesEntered: enterGrades && !gradeProblem, reconsiderationAsked: wantsReconsideration })"));
  assert.ok(panel.includes("onClick={() => setStep(3)} disabled={!preview || !gate.open}"));
  assert.ok(panel.includes("You cannot go on yet: your SDP is not complete.") && panel.includes("before the next step."));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
