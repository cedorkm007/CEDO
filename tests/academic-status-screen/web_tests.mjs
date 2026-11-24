// tests/academic-status-screen/web_tests.mjs — the words and the wiring of the school screen (3 checks)
// Run:  node tests/academic-status-screen/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asc-"));
const f = path.join(tmp, "a.mjs");
await build({ entryPoints: [path.join(root, "src/lib/academicScreen.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const A = await import(pathToFileURL(f).href);

const filt = { ...A.EMPTY_FILTER, search: " juan ", status: "not_set", programs: ["bsit"], custom: true };
const impact = { total: 120, willChange: 100, same: 20, fromNotSet: 90, fromAcademic: 10, fromNonAcademic: 0, customSet: 0, customCleared: 3, openRenewals: 7, recheckRenewals: 5, ruleOn: true, academicPassingGwa: 2, nonAcademicPassingGwa: 3 };
const lines = A.impactLines(impact, "non_academic");
check("1 the filter is sent as only what is set (search trimmed, status, program, custom); an empty filter is empty; the impact is read as plain sentences (100 change to Non-academic, 20 already have it, from where, 3 lose a custom GWA, 7 open renewals of which 5 need a new check, the school's two numbers) and says so when the school's GWA rule is off",
  JSON.stringify(A.filterToJson(filt)) === JSON.stringify({ search: "juan", status: "not_set", programs: ["bsit"], custom: true }) && A.filterIsEmpty(A.EMPTY_FILTER) && !A.filterIsEmpty(filt)
  && /^100 scholars change to Non-academic; 20 already have it and are left alone\.$/.test(lines[0]) && /90 from Not set, 10 from Academic/.test(lines[1]) && lines.some(l => /3 scholars lose their custom passing GWA/.test(l)) && lines.some(l => /5 open renewals will be checked again because the passing GWA used changes/.test(l)) && lines.some(l => /Academic 2\.00 and Non-academic 3\.00/.test(l))
  && A.impactLines({ ...impact, ruleOn: false }, "academic").some(l => /GWA rule is off/.test(l)) && A.impactLines({ ...impact, total: 0 }, "academic")[0] === "No scholar is chosen.");

check("2 a status is written in one line for the renewal case ('Non-academic · passing GWA 2.75 · scholar GWA 2.90 is below'; 'Not set · checked as Academic'; 'no passing GWA set'), for the Information list and its export ('Non-academic (passing GWA 2.75)', 'Not set (counts as Academic)'), and a history row reads 'Not set → Non-academic (custom 2.50)'",
  A.statusLine("non_academic", true, 2.75, 2.9, true) === "Non-academic · passing GWA 2.75 · scholar GWA 2.90 is below" && A.statusLine("academic", false, 2, null) === "Not set · checked as Academic · passing GWA 2.00" && /no passing GWA set/.test(A.statusLine("academic", true, null))
  && A.infoStatusText({ status: "non_academic", isSet: true, passingGwa: 2.75 }) === "Non-academic (passing GWA 2.75)" && A.infoStatusText({ status: "academic", isSet: false, passingGwa: 2 }) === "Not set (counts as Academic) (passing GWA 2.00)" && A.infoStatusText(undefined) === ""
  && A.changeText(null, "non_academic", null, 2.5) === "Not set → Non-academic (custom 2.50)", `${A.infoStatusText({ status: "academic", isSet: false, passingGwa: 2 })}`);

const sub = src("src/sead/pages/ScholarsGradesAcademicSubtab.tsx"), scr = src("src/sead/components/AcademicSchoolScreen.tsx"), api = src("src/sead/academicScreenApi.ts"), sead = src("src/sead/seadApi.ts"), tab = src("src/sead/pages/ScholarsTab.tsx"), ren = src("src/sead/renewal/RenewalDetailView.tsx");
check("3 the school screen is in Grades and Academic Management (paged 50, search, sorting, filters, 'Select all N that match', 'Set status…' with the impact before saving, history of a scholar and of the school); the database does the work (academic_school_scholars / facets / impact / apply / history); the Information list and its export use the scholar's status (and are not sortable by it); the renewal case shows the status line",
  sub.includes("<AcademicSchoolScreen") && scr.includes("Select all {n(total)} that match") && scr.includes("Set status…") && scr.includes("History of this school") && scr.includes("What this will do") && scr.includes("fetchImpact(target, what)") && scr.includes("applyChange(target, what, reason, impact.willChange)")
  && ["academic_school_scholars", "academic_school_facets", "academic_status_impact", "academic_status_apply", "academic_status_history_scholar", "academic_status_history_school", "academic_status_of_scholars"].every(x => api.includes(`"${x}"`))
  && sead.includes("fetchStatusOf(rows.map") && !sead.includes("fetchAcademicStatusMap") && tab.includes('c.key === "academicStatus" ? <th') && ren.includes("statusLine(acad.status"));
console.log(`\n${passed} passed`);
