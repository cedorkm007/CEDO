// tests/entered-grades/revert_web_tests.mjs — the "Revert approval" button on approved entered grades (only how it is wired)
// Run:  node tests/entered-grades/revert_web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const tab = src("src/sead/renewal/RenewalEnteredGradesTab.tsx"), api = src("src/sead/enteredGradesApi.ts");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("the API calls the new function with the submission and the reason, and says plainly when the database update is not run", () => {
  assert.ok(api.includes('supabase.rpc("renewal_self_grades_revert", { p_submission_id: id, p_note: note })') && api.includes("has not been run yet"));
});
test("an approved try shows a 'Revert approval' button, only to the Grades Approver (counts.canDecide) and not once the school's own grades count", () => {
  assert.ok(tab.includes('{counts?.canDecide && r.status === "approved" && !r.schoolSubmitted && ('));
  assert.ok(tab.includes("Revert approval</button>") && tab.includes("Approved by mistake?"));
});
test("it asks for a reason first (required) and says what will happen", () => {
  const d = tab.slice(tab.indexOf("{reverting && ("), tab.indexOf("{deciding && ("));
  assert.ok(d.includes('title="Revert the approval"') && d.includes("required danger") && d.includes("waiting for approval") && d.includes("the scholar and the evaluators are told"));
});
test("after reverting, the list reloads and a message says the grades wait for approval again", () => {
  const d = tab.slice(tab.indexOf("{reverting && ("), tab.indexOf("{deciding && ("));
  assert.ok(d.includes("revertEnteredGradesApproval(reverting.id, reason)") && d.includes("if (!r.ok) return r.error;") && d.includes("Approval reverted.") && d.includes("onChanged(); await load();"));
});
test("approve and return are unchanged: they are still only for a try that is waiting (r.canDecide)", () => {
  assert.ok(tab.includes("{r.canDecide && (") && tab.includes("Return for correction"));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
