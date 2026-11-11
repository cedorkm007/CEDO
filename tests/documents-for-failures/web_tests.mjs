// tests/documents-for-failures/web_tests.mjs — the three document buttons appear AS SOON AS a failed grade, a DRP or an INC is typed in the application form (5 checks, short on purpose)
// Run:  node tests/documents-for-failures/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dff-")), "g.mjs");
await build({ entryPoints: ["src/lib/gradeCheck.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const G = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(rel, "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name}`); } };

const lower = { scaleMin: 1, scaleMax: 5, usesLetterGrades: false, letters: [], marks: [], direction: "lower_is_better", passingMark: 3, letterValues: {}, markOutcomes: {} };
const higher = { scaleMin: 60, scaleMax: 100, usesLetterGrades: false, letters: [], marks: [], direction: "higher_is_better", passingMark: 75, letterValues: {}, markOutcomes: {} };
const lettered = { scaleMin: 1, scaleMax: 5, usesLetterGrades: true, letters: ["A", "F"], marks: ["D/F", "P"], direction: "lower_is_better", passingMark: 3, letterValues: { a: 1, f: 5 }, markOutcomes: { "d/f": "failed", p: "passed" } };

check("1 a failed number is read like the database: 5.0 fails and 3.0 / 1.5 pass when lower is better (passing mark 3); 70 fails and 75 passes when higher is better (passing mark 75)",
  G.localGradeOutcome("5.0", lower) === "failed" && G.localGradeOutcome("3.0", lower) === "passed" && G.localGradeOutcome("1.5", lower) === "passed" && G.localGradeOutcome("3.1", lower) === "failed"
  && G.localGradeOutcome("70", higher) === "failed" && G.localGradeOutcome("75", higher) === "passed" && G.localGradeOutcome("1 .5", lower) === "passed");
check("2 INC and DRP are read at once (even before the school's rules are known); the school's letters and other marks use their own meaning",
  G.localGradeOutcome("INC", null) === "inc" && G.localGradeOutcome("drp", null) === "drp" && G.localGradeOutcome("F", lettered) === "failed" && G.localGradeOutcome("A", lettered) === "passed"
  && G.localGradeOutcome("D/F", lettered) === "failed" && G.localGradeOutcome("P", lettered) === "passed");
check("3 nothing typed, or a grade that cannot be judged yet, says nothing (no buttons, no false alarm)", G.localGradeOutcome("", lower) === null && G.localGradeOutcome("2.0", null) === null && G.localGradeOutcome("2.0", { ...lower, passingMark: null }) === null);
check("4 the buttons are needed when ONE failed grade, TWO failed grades, a DRP or an INC is typed, and not when everything passes",
  G.needsDocuments([{ grade: "1.5" }, { grade: "5.0" }], lower) && G.needsDocuments([{ grade: "5.0" }, { grade: "5.0" }, { grade: "1.5" }], lower) && G.needsDocuments([{ grade: "DRP" }], lower) && G.needsDocuments([{ grade: "INC" }], lower)
  && !G.needsDocuments([{ grade: "1.5" }, { grade: "2.0" }, { grade: "" }], lower));
const panel = src("src/scholar/components/dashboard/RenewalPanel.tsx"), hook = src("src/scholar/useMyGradeRules.ts");
check("5 the application form notices a typed failed grade, DRP or INC at once (and tells the scholar the documents come after the grades are approved); the school's passing mark, direction, letters and marks are loaded for it",
  panel.includes("needsDocuments(gRows, gradeRules)") && panel.includes("const docsComing = !!preview &&") && panel.includes("enteredInc || serverNeedsInc") && panel.includes("{preview && docsComing && (")
  && hook.includes("passingMark: cfg.passingMark") && hook.includes("direction: cfg.direction") && hook.includes("markOutcomes:") && hook.includes("letterValues:"));
console.log(`\n${passed} passed`);
