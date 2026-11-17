// tests/sdp-reconsideration-note/web_tests.mjs — the SDP Checklist writes "Reconsideration approved" under the Complied chip of a scholar who is Complied only because of an approved reconsideration (4 checks)
// Run:  node tests/sdp-reconsideration-note/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "note-"));
const f = path.join(tmp, "n.mjs");
await build({ entryPoints: [path.join(root, "src/lib/sdpChecklistNote.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const N = await import(pathToFileURL(f).href);

const row = (id, cs, cv, fp, complied = true, applicable = true) => ({ scholarIdNumber: id, applicable, complied, communityService: cs, communityVolunteerism: cv, formationProgram: fp });
const approved = new Set(["A", "B", "C", "D", "E"]);
const owed = new Map([["E", { communityService: 2, communityVolunteerism: 0, formationProgram: 0 }]]);
check("1 the note shows only when it explains something: Complied, a category below 3 (or below 3 plus what is owed), and an approved reconsideration",
  N.compliedByReconsideration(row("A", 0, 0, 0), approved, owed) === true && N.compliedByReconsideration(row("B", 0, 1, 0), approved, owed) === true
  && N.compliedByReconsideration(row("C", 3, 3, 3), approved, owed) === false      // really has the credits: no note
  && N.compliedByReconsideration(row("E", 4, 3, 3), approved, owed) === true         // owes 2 more in the first category: 4 is below 5
  && N.compliedByReconsideration(row("E", 5, 3, 3), approved, owed) === false);
check("2 no note for a scholar who is not Complied, is not in the approved list, or is in Summer (no requirement)",
  N.compliedByReconsideration(row("A", 0, 0, 0, false), approved, owed) === false && N.compliedByReconsideration(row("Z", 0, 0, 0), approved, owed) === false
  && N.compliedByReconsideration(row("A", 0, 0, 0, null, false), approved, owed) === false && N.compliedByReconsideration(row("A", 0, 0, 0, true, false), approved, owed) === false);
const tab = src("src/sead/pages/SDPMonitoringTab.tsx"), api = src("src/sead/sdpMonitorApi.ts");
check("3 the Checklist asks for the approved ones of the page being shown, writes the note under the Complied chip in the table AND on the phone card, explains the rule above the list; the credits, the chip and the result are not changed",
  /fetchSdpReconsidered\(chosen\.schoolYear, chosen\.term, pagedIds\)/.test(tab) && (tab.match(/compliedByReconsideration\(s, reconsidered, owed\) && <ReconsideredNote \/>/g) ?? []).length === 2
  && /Reconsideration approved/.test(src("src/lib/sdpChecklistNote.ts")) && /SDP reconsideration was approved<\/strong> also counts as complied/.test(tab) && /<ComplianceBadge row=\{s\} \/>/.test(tab) && !/s\.missing/.test(tab));
check("4 the call is read-only, sends only the scholars of the page, and without the database update the answer is 'nobody' (no note, nothing breaks)",
  /rpc\("scholars_sdp_reconsidered", \{ p_school_year: schoolYear, p_semester: semester, p_ids: ids \}\)/.test(api) && /if \(error \|\| !Array\.isArray\(data\)\) return out;/.test(api.slice(api.indexOf("fetchSdpReconsidered"))));
console.log(`\n${passed} passed`);
