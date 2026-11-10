// tests/entered-grades-gwa/web_tests.mjs — the GWA of the entered grades: the number, what is left out, and where it is shown (5 checks, short on purpose)
// Run:  node tests/entered-grades-gwa/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egwa-"));
const bundle = async (entry, name) => { const outfile = path.join(tmp, name); await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", jsx: "automatic", alias: { "@": path.resolve("src") } }); return import(pathToFileURL(outfile).href); };
const G = await bundle("src/lib/enteredGwa.ts", "g.mjs");
const C = await bundle("src/app/components/EnteredGwaLine.tsx", "c.mjs");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const src = rel => fs.readFileSync(rel, "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

const lines = [{ grade: "1.0", units: 3 }, { grade: "1.5", units: 3 }, { grade: "2.0", units: 2 }];
const a = G.enteredGwa(lines);
check("1 the GWA is weighted by units: (1.0x3 + 1.5x3 + 2.0x2) / 8 = 1.4375, shown with 2 decimals as 1.44", Math.abs(a.gwa - 1.4375) < 1e-9 && a.text === "1.44" && a.subjectsCounted === 3 && a.unitsCounted === 8 && a.notCounted.length === 0, JSON.stringify(a));
const b = G.enteredGwa([{ grade: "1.5", units: 3 }, { grade: "INC", units: 3 }, { grade: "drp", units: 3 }, { grade: "2.5", units: 3 }]);
check("2 INC and DRP are not numbers: they are left out of the GWA and named; the count says how many subjects were used", b.text === "2.00" && b.subjectsCounted === 2 && b.subjectsTotal === 4 && b.notCounted.join() === "INC,DRP", JSON.stringify(b));
const c = G.enteredGwa([{ grade: "1 .0", units: "3" }, { grade: "2.0", units: "" }, { grade: "", units: "3" }]);
check("3 a number with a stray space counts ('1 .0' is 1.0); a subject without units counts as 1 unit; blank grades are ignored; with nothing numeric there is no GWA", c.subjectsTotal === 2 && Math.abs(c.gwa - (1.0 * 3 + 2.0 * 1) / 4) < 1e-9 && G.enteredGwa([{ grade: "INC", units: 3 }]).gwa === null && G.enteredGwa([]).gwa === null, JSON.stringify(c));
const html = renderToStaticMarkup(createElement(C.EnteredGwaLine, { lines: [...lines, { grade: "INC", units: 3 }] }));
check("4 the line says it in plain words, and shows nothing when there is no number yet",
  /GWA of these grades: 1\.44/.test(html) && /weighted by units · 3 of 4 subjects counted; INC not counted/.test(html) && renderToStaticMarkup(createElement(C.EnteredGwaLine, { lines: [{ grade: "INC", units: 3 }] })) === "");
check("5 the GWA is shown in the Grades Approver's Entered grades tab, the application's detail, the scholar's own Grades tile and the entry form (while typing)",
  src("src/sead/renewal/RenewalEnteredGradesTab.tsx").includes("<EnteredGwaLine lines={r.lines} />") && src("src/sead/renewal/RenewalDetailView.tsx").includes("<EnteredGwaLine lines={entered.lines} />")
  && src("src/scholar/components/dashboard/SelfGradesSection.tsx").includes("<EnteredGwaLine lines={data.lines} />") && src("src/scholar/components/dashboard/SelfGradesForm.tsx").includes("<EnteredGwaLine lines={rows}"));
console.log(`\n${passed} passed`);
