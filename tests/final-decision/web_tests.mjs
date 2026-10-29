// tests/final-decision/web_tests.mjs — the Division Head approves and signs; the consulting staff member makes the final decision (the screens and the words)
// Run:  node tests/final-decision/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fdw-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const R = await bundle("renewal", "src/lib/renewal.ts");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The calls");
const api = src("src/sead/referralApi.ts");
test("the website asks for the cases waiting for the consulting staff's final decision and makes the final decision; a new status exists", () => {
  assert.ok(api.includes('rpc("consult_final_decisions")') && api.includes('rpc("consult_finalize_decision", { p_referral_id: referralId })'));
  assert.ok(/ReferralStatus = [^;]*"division_head_approved"/.test(api));
  assert.ok(/fetchFinalDecisions[\s\S]*if \(error \|\| !data\) return \[\];/.test(api), "empty (not an error) before the database update");
});

console.log("The consulting staff's screen");
const dash = src("src/sead/pages/ScholarCounselingDashboardTab.tsx");
test("a list 'Waiting for your final decision' with a 'Proceed with the final decision' button for each case", () => {
  assert.ok(dash.includes("Waiting for your final decision") && dash.includes("Proceed with the final decision"));
  assert.ok(dash.includes("fetchFinalDecisions()") && dash.includes("finalizeDecision(item.referralId)") && dash.includes("{finals.length > 0 && ("));
});
test("before the status changes the staff member is asked to confirm, with what will happen", () => {
  assert.ok(dash.includes("window.confirm(") && dash.includes("the last step before the scholarship status changes") && dash.includes("Removed"));
});
test("it says the Division Head approved and signed, what the decision is, and who signed", () => assert.ok(dash.includes("Approved by the Division Head:") && dash.includes("{item.decisionLabel}") && dash.includes("signed by")));

console.log("The Division Head and the evaluator");
test("the Division Head's options say the consulting staff makes the final decision and only then does the status change", () => {
  for (const k of ["approve_probationary", "reconsidered", "removed"]) assert.ok(/consulting staff member who consulted the scholar then makes the final decision/.test(R.DIVISION_HEAD_OPTION_INFO[k].effect) && /only then/.test(R.DIVISION_HEAD_OPTION_INFO[k].effect), k);
  assert.ok(/Send back|Nothing changes/.test(R.DIVISION_HEAD_OPTION_INFO.return.effect));
});
test("the Division Head's list has a group 'Approved — waiting for the final decision' naming who makes it", () => {
  const t = src("src/sead/renewal/RenewalDivisionHeadTab.tsx");
  assert.ok(t.includes("Approved — waiting for the final decision") && t.includes('r.state === "awaiting_final"') && t.includes("waiting for {c.finalBy"));
  assert.ok(src("src/sead/divisionHeadApi.ts").includes('"awaiting_final"') && src("src/sead/divisionHeadApi.ts").includes("finalBy: strOrNull(r.final_by)"));
});
test("the decision panel and the evaluator's page say the case waits for the final decision, and the evaluator cannot send it again meanwhile", () => {
  assert.ok(src("src/sead/renewal/RenewalDecisionPanel.tsx").includes('info.referralStatus === "division_head_approved"'));
  const d = src("src/sead/renewal/RenewalDetailView.tsx");
  assert.ok(d.includes('const awaitingFinal = dh?.status === "division_head_approved"') && d.includes("waiting for the final decision") && d.includes("!withDivisionHead && !awaitingFinal"));
});
test("the Referral Form shows the Division Head's signature as soon as they approved", () => assert.ok(src("src/sead/components/ReferralFormPanel.tsx").includes('(referral?.status === "approved" || referral?.status === "division_head_approved")')));

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
