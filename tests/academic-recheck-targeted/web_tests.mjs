// tests/academic-recheck-targeted/web_tests.mjs — the words and the wiring of the re-check progress (2 checks)
// Run:  node tests/academic-recheck-targeted/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rck-"));
const f = path.join(tmp, "a.mjs");
await build({ entryPoints: [path.join(root, "src/lib/academicScreen.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const A = await import(pathToFileURL(f).href);
const imp = { total: 10, willChange: 10, same: 0, fromNotSet: 10, fromAcademic: 0, fromNonAcademic: 0, customSet: 0, customCleared: 0, openRenewals: 4, recheckRenewals: 0, ruleOn: true, academicPassingGwa: 2, nonAcademicPassingGwa: 3 };
check("1 the progress reads 'Re-checking 340 renewals… 120 done' and 'All 340 renewals checked.'; the impact says no renewal needs a new check when the passing GWA used does not change, and that a small change (up to 10) is checked right away while a big one shows a count",
  A.recheckText(340, 220) === "Re-checking 340 renewals… 120 done" && A.recheckText(340, 0) === "All 340 renewals checked." && A.recheckText(1, 0) === "All 1 renewal checked."
  && A.impactLines(imp, "academic").some(l => /no renewal needs to be checked again/.test(l)) && A.impactLines({ ...imp, recheckRenewals: 4 }, "non_academic").some(l => /4 open renewals will be checked again.*checked right away/.test(l)) && A.impactLines({ ...imp, openRenewals: 40, recheckRenewals: 40 }, "non_academic").some(l => /count is shown on the screen/.test(l)));
const bar = src("src/sead/components/AcademicRecheckBar.tsx"), sub = src("src/sead/pages/ScholarsGradesAcademicSubtab.tsx"), api = src("src/sead/academicScreenApi.ts"), scr = src("src/sead/components/AcademicSchoolScreen.tsx");
check("2 the bar asks for the next 25 until none is left and tells what is left for the background job; it is on top of Grades and Academic Management and looks again after a status change, a passing GWA save and an upload; the calls are academic_recheck_status / academic_recheck_step",
  bar.includes("recheckStep(25)") && bar.includes("finished by the background job") && bar.includes("could not be checked after 3 tries") && sub.includes("<AcademicRecheckBar nonce={recheckNonce} />") && scr.includes("onChanged?.(); void load();") && sub.includes("setRecheckNonce(x => x + 1); await load(school.id)") && scr.includes("onChanged?.()")
  && api.includes('"academic_recheck_status"') && api.includes('"academic_recheck_step"'));
console.log(`\n${passed} passed`);
