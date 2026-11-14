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

const map = new Map([["school one|bs nursing", "academic"], ["school one|bs arts", "non_academic"], ["school two|bs nursing", "non_academic"]]);
check("1 a program is matched however it is typed, PER SCHOOL (the same program can differ between two schools); the list says Academic / Non-academic / Not set (a program not placed yet in that school), and nothing for a scholar with no program",
  A.programKey("  BS   Nursing ") === "bs nursing" && A.academicStatusText(map, "School One", "BS NURSING") === "Academic" && A.academicStatusText(map, " school  two ", "BS NURSING") === "Non-academic" && A.academicStatusText(map, "School One", "bs  arts") === "Non-academic"
  && A.academicStatusText(map, "School Two", "bs arts") === "Not set" && A.academicStatusText(map, "School One", "BS Law") === "Not set" && A.academicStatusText(map, "School One", "") === "");
const higher = { min: 60, max: 100, direction: "higher_is_better" };
check("2 a passing GWA is checked against the school's OWN scale (the standard 1.00 to 5.00 when none is given; 60 to 100 for a school on the percent scale; empty = not set); anything else is refused in plain words that name the best grade",
  A.passingGwaProblem("") === null && A.passingGwaProblem("2.5") === null && A.passingGwaProblem("2,75") === null && A.passingGwaProblem("0.5") !== null && A.passingGwaProblem("5.5") !== null && A.passingGwaProblem("abc") !== null && A.passingGwaProblem("", false) !== null
  && A.passingGwaProblem("90", true, higher) === null && A.passingGwaProblem("3", true, higher) !== null && A.passingGwaProblem("101", true, higher) !== null && /100\.00 is the best/.test(A.passingGwaProblem("3", true, higher)) && A.describeScale(higher) === "60.00 to 100.00 (100.00 is the best)"
  && A.parsePassingGwa("2,5") === 2.5 && A.parsePassingGwa("") === null && A.formatPassingGwa(null) === "not set" && A.formatPassingGwa(3) === "3.00");
const tab = src("src/sead/pages/ScholarsTab.tsx"), sub = src("src/sead/pages/ScholarsGradesAcademicSubtab.tsx"), api = src("src/sead/seadApi.ts");
check("3 Scholar Management Tools > Scholars has the subtab 'Grades and Academic Management': the staff choose a SCHOOL, then set its passing GWA for Academic and Non-academic (on its own scale) and see only the programs of that school with their status, special programs with their own GWA, and the Information list has an Academic Status column",
  tab.includes("Grades and Academic Management") && tab.includes("<ScholarsGradesAcademicSubtab />") && tab.includes('{ key: "academicStatus", label: "Academic Status" }')
  && sub.includes("Academic programs") && sub.includes("Non-academic programs") && sub.includes("Special program (its own passing GWA)") && api.includes("withAcademicStatus")
  && sub.includes("Choose the school first") && sub.includes("pickSchool") && sub.includes("Only the programs of this school's scholars are listed") && sub.includes("describeScale(scale)") && /saveAcademicPassingGwa\(school\.id/.test(sub) && /saveAcademicProgram\(schoolId/.test(sub));
const steps = R.scholarNextSteps("needs_gwa_consultation", { gwa: 2.63, passing_gwa: 2 }, { consultState: "ok", consultNeeded: true });
check("4 the renewal has the new stage 'needs a consultation (GWA below the passing GWA)': the scholar is told the two numbers and that no documents are needed; the evaluator may refer the scholar for it",
  R.STAGE_INFO.needs_gwa_consultation.short === "Consultation (GWA)" && R.isActiveStage("needs_gwa_consultation") && steps.some(s => /2\.63/.test(s) && /2\.00/.test(s) && /No documents/.test(s))
  && Act.canReferForConsultation({ failed: 0, drp: 0, inc: 0 }, { recordId: "r", stage: "needs_gwa_consultation", isLate: false, appliedAt: null, docsToReview: 0, consultationRequired: true, consultationDoneAt: null, nextConsultation: null, gradesStatus: "school", dhReferralId: null, dhStatus: null, referralStatus: null }) === true, JSON.stringify(steps));
console.log(`\n${passed} passed`);
