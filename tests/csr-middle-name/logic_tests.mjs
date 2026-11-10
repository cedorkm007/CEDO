// tests/csr-middle-name/logic_tests.mjs — the Certificate of Scholarship Renewal skips a middle name that is blank or a placeholder such as N/A (4 checks, short on purpose)
// Run:  node tests/csr-middle-name/logic_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "csrn-")), "c.mjs");
await build({ entryPoints: ["supabase/functions/_shared/csrPdf.ts"], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const C = await import(pathToFileURL(outfile).href);
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

check("1 a real middle name still prints as its initial: JUAN -TEST N. DELA CRUZ", C.csrFullName("Juan -Test", "Nuñez", "Dela Cruz") === "JUAN -TEST N. DELA CRUZ" && C.csrFullName("Ana", "Marie Santos", "Reyes") === "ANA M. REYES");
const placeholders = ["", " ", "N/A", "n/a", "NA", "na", "N.A.", "n.a", "None", "NONE", "nil", "null", "NMN", "No middle name", "no middle initial", "Not applicable", "-", "--", "—", ".", "( none )", "N / A", "undefined"];
check("2 a blank middle name or a placeholder (N/A, NA, N.A., none, nil, NMN, no middle name, -, ...) is skipped: no 'N.' on the certificate", placeholders.every(m => C.csrFullName("Ana", m, "Reyes") === "ANA REYES"), JSON.stringify(placeholders.filter(m => C.csrFullName("Ana", m, "Reyes") !== "ANA REYES")));
check("3 names that only START like a placeholder are not skipped (Nora, Natividad, Nilo, Noel keep their initial)", ["Nora", "Natividad", "Nilo", "Noel", "Nuñez"].every(m => C.csrFullName("Ana", m, "Reyes") === `ANA ${m[0].toUpperCase()}. REYES`));
check("4 a missing value (null / undefined) and extra spaces are handled; the removal form uses the same name rule", C.csrFullName("  Ana  Marie ", null, " Reyes ") === "ANA MARIE REYES" && C.csrFullName("Ana", undefined, "Reyes") === "ANA REYES" && C.isNoMiddleName(null) === true && C.isNoMiddleName("Santos") === false
  && fs.readFileSync("supabase/functions/_shared/removalFormPdf.ts", "utf8").includes("csrFullName(d.first, d.middle, d.last)"));
console.log(`\n${passed} passed`);
