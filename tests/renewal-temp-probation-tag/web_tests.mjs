// tests/renewal-temp-probation-tag/web_tests.mjs — the screens of the temporary probationary tag: the Grades Approver's dialog, the scholar's "No grade yet" tick, the detail page and the scholar's next steps (4 checks, short on purpose)
// Run:  node tests/renewal-temp-probation-tag/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tag-"));
const bundle = async (entry, out) => { const f = path.join(tmp, out); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } }); return import(pathToFileURL(f).href); };
const T = await bundle("src/lib/tempProbation.ts", "t.mjs");
const R = await bundle("src/lib/renewal.ts", "r.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

check("1 the tag is offered only when the entered grades have an INC or exactly ONE subject without a grade (not for two blanks, not for plain passed grades); the form asks for remarks (5+ characters) and 1 to 365 days",
  T.tagHint([{ grade: "INC" }, { grade: "1.5" }]).canTag && T.tagHint([{ grade: "" }, { grade: "2.0" }]).canTag && !T.tagHint([{ grade: "" }, { grade: "" }]).canTag && !T.tagHint([{ grade: "1.5" }]).canTag
  && T.tagProblem("abcd", "30") !== null && T.tagProblem("INC in Math, grade coming", "0") !== null && T.tagProblem("INC in Math, grade coming", "400") !== null && T.tagProblem("INC in Math, grade coming", "30") === null);
const row = (grade, noGrade = false, code = "S1") => ({ code, subject: "Math", units: "3", grade, noGrade });
check("2 the scholar may leave ONE subject without a grade, only by ticking 'No grade yet' (a forgotten grade is still refused); two such subjects are refused",
  R.validateSelfGradeLines([row("1.5")]) === null && R.validateSelfGradeLines([row("", true)]) === null
  && /No grade yet/.test(R.validateSelfGradeLines([row("")]) ?? "") && /Only ONE subject/.test(R.validateSelfGradeLines([row("", true, "S1"), row("", true, "S2")]) ?? ""));
const tab = src("src/sead/renewal/RenewalEnteredGradesTab.tsx"), api = src("src/sead/enteredGradesApi.ts"), form = src("src/scholar/components/dashboard/SelfGradesForm.tsx"), detail = src("src/sead/renewal/RenewalDetailView.tsx");
check("3 the Grades Approver's approve dialog has the tag section (checkbox, remarks, days) and sends it with the approval; the scholar's form has the 'No grade yet' tick; the detail page shows the tag",
  tab.includes("tagHint(deciding.row.lines).canTag") && tab.includes("Approve and tag") && api.includes("p_tag: true, p_tag_remarks: tag.remarks, p_tag_days: tag.days") && form.includes("No grade yet for this subject") && detail.includes("Temporary probation (tagged by the Grades Approver)"));
const steps = R.scholarNextSteps("renewed", null, { incDeadlines: [{ subject: "Mathematics", deadline: "2026-12-20" }], result: "renewed_probationary" });
check("4 a scholar renewed on temporary probation is told the deadline of the INC / missing grade and that passing it brings them back to Regular", steps.some(s => /Mathematics/.test(s) && /back to Regular/.test(s)) && steps.some(s => /Probationary/.test(s)), JSON.stringify(steps));
console.log(`\n${passed} passed`);
