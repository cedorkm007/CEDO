// Writes a sample clearance PDF and Word file (three scholars: two on the first page, one on the second) so the layout can be looked at.
// Run:  node tests/school-renewal-tab/clearance_sample.mjs <output folder>
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = process.argv[2] ?? os.tmpdir();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clr-"));
const outfile = path.join(tmp, "clr.mjs");
await build({ entryPoints: [path.join(root, "src/lib/clearanceForm.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(root, ".clr_tmp.mjs"), logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") }, external: ["pizzip", "pdf-lib"], outdir: undefined });
const C = await import(pathToFileURL(path.join(root, ".clr_tmp.mjs")).href); fs.rmSync(path.join(root, ".clr_tmp.mjs"));
const template = fs.readFileSync(path.join(root, "src/assets/ClearanceTemplate.docx"));
const entries = [
  C.clearanceEntryFor({ firstName: "Juan", middleName: "Santos", lastName: "Dela Cruz", contactNo: "09171234567", schoolName: "Xavier University - Ateneo de Cagayan", gwaText: "2.57", program: "Bachelor of Science in Psychology", yearLevel: "3rd Year", semester: "1st Semester 2025-2026", scholarIdNumber: "2409-00123" }),
  C.clearanceEntryFor({ firstName: "Maria Luisa", middleName: "", lastName: "Reyes & Sons <test>", contactNo: "", schoolName: "Capitol University", gwaText: "—", program: "BS Information Technology", yearLevel: "2nd Year", semester: "Summer 2025-2026", scholarIdNumber: "2409-00456" }),
  C.clearanceEntryFor({ firstName: "Ana", middleName: "B", lastName: "Cruz", contactNo: "09990000000", schoolName: "Liceo de Cagayan University", gwaText: "85.5", program: "Bachelor of Science in Civil Engineering Major in Structural Engineering", yearLevel: "4th Year", semester: "2nd Semester 2025-2026", scholarIdNumber: "2409-00789" }),
];
fs.writeFileSync(path.join(outDir, "clearance_sample.pdf"), await C.buildClearancePdf(template, entries));
fs.writeFileSync(path.join(outDir, "clearance_sample.docx"), C.buildClearanceDocx(template, entries));
console.log("written to", outDir);
fs.rmSync(tmp, { recursive: true, force: true });
