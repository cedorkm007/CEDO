// tests/renewal-documents-after-approval/web_tests.mjs — the words and the steps the scholar and the staff see for the new stage "awaiting_documents" and the shorter route before it (3 checks)
// Run:  node tests/renewal-documents-after-approval/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rda-"));
const f = path.join(tmp, "r.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewal.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(f).href);

console.log("The scholar's words and steps");
const docs = [{ kind: "study_plan", label: "Study plan", satisfied: false, approved: false }, { kind: "clearance", label: "Clearance", satisfied: true, approved: false }];
const wait = R.scholarNextSteps ? R.scholarNextSteps("awaiting_documents", { required_documents: docs, consult_route: true, consultation_done: true }) : null;
const before = R.scholarNextSteps ? R.scholarNextSteps("needs_study_plan_consultation", { required_documents: [], consult_route: true, consultation_required: true }, { consultNeeded: true }) : null;
const ready = R.scholarNextSteps ? R.scholarNextSteps("ready_for_endorsement", { required_documents: [], consult_route: true, consultation_done: true }) : null;
check("1 before the decision the scholar is told NO document is needed yet (and that Reconsidered / Probationary will ask for the study plan and the clearance); once the consultation is done the case waits for the endorsement with no document asked for",
  !!before && before.some(s => /No document is needed now/.test(s)) && before.every(s => !/^Upload/.test(s)) && !!ready && ready.some(s => /do not need to send any document yet/i.test(s)) && ready.every(s => !/documents are approved/i.test(s)),
  JSON.stringify([before, ready]));
check("2 once the status is approved the scholar is told to send the documents that are still missing (the study plan) and that the consultation staff approve the ones sent (the clearance); the new stage has its own title and sits in the 'Needs documents + consultation' group",
  !!wait && wait.some(s => /Upload your study plan/.test(s)) && wait.every(s => !/Upload your clearance/.test(s)) && wait.some(s => /consultation staff will approve the documents you sent/i.test(s)) && R.stageTitle("awaiting_documents") === "Approved — waiting for the study plan and the clearance"
  && R.BOARD_GROUPS.find(g => g.key === "consult").stages.includes("awaiting_documents") && R.RENEWAL_STAGES.includes("awaiting_documents"), JSON.stringify(wait));

const steps = R.renewalProgress ? R.renewalProgress("awaiting_documents", { required_documents: docs, consult_route: true, consultation_required: true, consultation_done: true }, {}) : null;
const tab = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx"), detail = src("src/sead/renewal/RenewalDetailView.tsx"), actions = src("src/lib/renewalActions.ts");
check("3 the progress line shows Applied, SDP and grades, Consultation, Endorsement and approval as done, then 'Upload your documents' as the current step and 'Renewed' last; the consultation staff see 'waiting for the scholar's documents' and can still approve each one; the evaluator sees the stage and cannot return the case; the staff are not asked to refer it for consultation again",
  !!steps && steps.map(s => `${s.key}:${s.state}`).join(",") === "applied:done,checked:done,consultation:done,decision:done,documents:current,renewed:todo"
  && tab.includes('c.stage === "awaiting_documents"') && detail.includes('"endorsed_for_approval", "awaiting_documents"].includes(r.stage)') && detail.includes("awaiting_documents") && actions.includes('"endorsed_for_approval", "awaiting_documents"].includes(facts.stage')
  && tab.includes("No document is needed before that."), JSON.stringify(steps));
console.log(`\n${passed} passed`);
