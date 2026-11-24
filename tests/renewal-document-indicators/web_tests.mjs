// tests/renewal-document-indicators/web_tests.mjs — the words of the document indicators under a case (2 checks)
// Run:  node tests/renewal-document-indicators/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rdi-"));
const f = path.join(tmp, "r.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewal.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(f).href);
const tab = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx"), api = src("src/sead/consultRenewalApi.ts");

check("1 the indicators read: 'Waiting for study plan upload', 'Waiting for clearance upload', 'Waiting for the letter from the dean upload' style for each document not sent yet; 'Waiting for a new … upload (it was returned)'; '… uploaded — waiting for your approval'; '… approved'",
  R.docIndicatorText("study_plan", "missing") === "Waiting for study plan upload" && R.docIndicatorText("clearance", "missing") === "Waiting for clearance upload" && R.docIndicatorText("inc_letter", "missing") === "Waiting for letter from the dean upload"
  && R.docIndicatorText("clearance", "returned") === "Waiting for a new clearance upload (it was returned)" && R.docIndicatorText("study_plan", "submitted") === "Study plan uploaded — waiting for your approval" && R.docIndicatorText("clearance", "accepted") === "Clearance approved");
check("2 every case card in Renewal Cases lists its indicators as a numbered list under 'Documents:' (amber = still to send or to send again, blue = waiting for the staff, green = approved), straight from the list (the documents do not have to be opened); before the database update the list is simply empty",
  tab.includes("c.documents.length > 0 && (") && tab.includes("list-decimal") && tab.includes("docIndicatorText(d.kind, d.state)") && api.includes("documents: ((r.documents ?? []) as Row[]).map(") && api.includes("documents: { kind: DocKind; label: string; state: DocIndicatorState }[]"));
check("3 a case that is ready to endorse (no document asked for yet) shows a grey note: no document is needed yet, the study plan and the clearance are asked after the evaluator approves the status, and the 'Waiting for ... upload' lines then appear; it is not shown for the Division Head route",
  tab.includes('c.documents.length === 0 && !c.legacy && ["ready_for_endorsement", "needs_study_plan_consultation", "endorsed_for_approval"].includes(c.stage)') && tab.includes("No document is needed yet. The study plan and the clearance"));
console.log(`\n${passed} passed`);
