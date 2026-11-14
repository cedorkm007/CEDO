// tests/academic-status/web_tests.mjs — the screens of the academic status: the helpers, the new subtab in Scholars, the column, and the renewal wording (4 checks, short on purpose)
// Run:  node tests/academic-status/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acad-"));
const bundle = async (entry, out) => { const f = path.join(tmp, out); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } }); return import(pathToFileURL(f).href); };
const A = await bundle("src/lib/academicStatus.ts", "a.mjs");
const R = await bundle("src/lib/renewal.ts", "r.mjs");
const Act = await bundle("src/lib/renewalActions.ts", "act.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

const map = new Map([["bs nursing", "academic"], ["bs arts", "non_academic"]]);
check("1 a program is matched however it is typed; the list says Academic / Non-academic / Not set (a program not placed yet), and nothing for a scholar with no program",
  A.programKey("  BS   Nursing ") === "bs nursing" && A.academicStatusText(map, "BS NURSING") === "Academic" && A.academicStatusText(map, "bs  arts") === "Non-academic" && A.academicStatusText(map, "BS Law") === "Not set" && A.academicStatusText(map, "") === "");
check("2 a passing GWA is a number from 1.00 to 5.00 (empty = not set); anything else is refused in plain words",
  A.passingGwaProblem("") === null && A.passingGwaProblem("2.5") === null && A.passingGwaProblem("2,75") === null && A.passingGwaProblem("0.5") !== null && A.passingGwaProblem("5.5") !== null && A.passingGwaProblem("abc") !== null && A.passingGwaProblem("", false) !== null
  && A.parsePassingGwa("2,5") === 2.5 && A.parsePassingGwa("") === null && A.formatPassingGwa(null) === "not set" && A.formatPassingGwa(3) === "3.00");
const tab = src("src/sead/pages/ScholarsTab.tsx"), sub = src("src/sead/pages/ScholarsGradesAcademicSubtab.tsx"), api = src("src/sead/seadApi.ts");
check("3 Scholar Management Tools > Scholars has the new subtab 'Grades and Academic Management' (passing GWA for Academic and Non-academic, programs with their status, special programs with their own GWA), and the Information list has an Academic Status column",
  tab.includes("Grades and Academic Management") && tab.includes("<ScholarsGradesAcademicSubtab />") && tab.includes('{ key: "academicStatus", label: "Academic Status" }')
  && sub.includes("Academic programs") && sub.includes("Non-academic programs") && sub.includes("Special program (its own passing GWA)") && api.includes("withAcademicStatus"));
const steps = R.scholarNextSteps("needs_gwa_consultation", { gwa: 2.63, passing_gwa: 2 }, { consultState: "ok", consultNeeded: true });
check("4 the renewal has the new stage 'needs a consultation (GWA below the passing GWA)': the scholar is told the two numbers and that no documents are needed; the evaluator may refer the scholar for it",
  R.STAGE_INFO.needs_gwa_consultation.short === "Consultation (GWA)" && R.isActiveStage("needs_gwa_consultation") && steps.some(s => /2\.63/.test(s) && /2\.00/.test(s) && /No documents/.test(s))
  && Act.canReferForConsultation({ failed: 0, drp: 0, inc: 0 }, { recordId: "r", stage: "needs_gwa_consultation", isLate: false, appliedAt: null, docsToReview: 0, consultationRequired: true, consultationDoneAt: null, nextConsultation: null, gradesStatus: "school", dhReferralId: null, dhStatus: null, referralStatus: null }) === true, JSON.stringify(steps));
console.log(`\n${passed} passed`);
