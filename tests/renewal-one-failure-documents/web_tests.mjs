// tests/renewal-one-failure-documents/web_tests.mjs — the evaluator's approval for ONE failed subject: the endorsed status is shown, Regular / Probationary can be chosen, the documents come first (2 checks)
// Run:  node tests/renewal-one-failure-documents/web_tests.mjs        No database or browser needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const detail = src("src/sead/renewal/RenewalDetailView.tsx"), api = src("src/sead/consultRenewalApi.ts"), renewal = src("src/lib/renewal.ts");

check("1 the evaluator's approval dialog shows the status the consultation staff endorsed; for ONE failed subject (rule B) with Regular or Probationary endorsed it offers 'Regular / Probationary' to choose from, and says the scholar is NOT renewed yet (study plan and clearance first); the choice is sent to the database only when it differs from the endorsed status",
  detail.includes("The consultation staff endorsed <strong>{(r.endorsedStatus ?? \"\")}</strong>") && detail.includes("const oneFailure = /^B(\\+|$)/.test(") && detail.includes("const canChoose = oneFailure && (r.endorsedStatus === \"Regular\" || r.endorsedStatus === \"Probationary\")")
  && detail.includes("(one failed subject: you choose)") && detail.includes("is <strong>not renewed yet</strong>") && detail.includes("chosenStatus && chosenStatus !== r.endorsedStatus ? chosenStatus : undefined")
  && api.includes('p_status: status') && api.includes('status?: "Regular" | "Probationary"'));
check("2 a scholar with one failed subject is told, before the decision, that no document is needed now but the study plan and the clearance will be asked after the status is approved (and that she can still be renewed); everyone else keeps the earlier sentence",
  renewal.includes("After your new status is approved, you will be asked for the study plan and the clearance (you can still be renewed with one failed subject).") && renewal.includes("If you are approved as Reconsidered or Probationary, you will be asked for the study plan and the clearance."));
console.log(`\n${passed} passed`);
