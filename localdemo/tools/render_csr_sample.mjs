// localdemo/tools/render_csr_sample.mjs — makes a sample Certificate of Scholarship Renewal (all TEST data) so the layout can be looked at:
//     node localdemo/tools/render_csr_sample.mjs [output.pdf]
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "csr-"));
const bundled = path.join(tmp, "csrPdf.mjs");
await build({ entryPoints: [path.join(root, "supabase/functions/_shared/csrPdf.ts")], bundle: true, format: "esm", platform: "node", outfile: bundled, logLevel: "error" });
const M = await import(pathToFileURL(bundled).href);
const bytes = await M.buildCsrPdf({
  csrNumber: "CSR-2025-1S-00012", version: 1, fullName: M.csrFullName("Juan -Test", "Nuñez", "Dela Cruz"), scholarIdNumber: "2108-00001", barangay: "Besigan",
  program: M.csrProgramCode("BSMARE", "5th Year"), school: "PHINMA Cagayan de Oro College", term: "1st Semester", schoolYear: "2025-2026", issuedAt: new Date("2025-07-04T02:00:00Z"),
  place: "the City of Cagayan de Oro, Philippines", officer: { name: "Ms. Richel Petalcurin-Dahay, LPT, MPSM", title: "City Education and Development Officer, City Education and Development Office" },
  mayor: { name: "Hon. Rolando A. Uy", title: "City Mayor" }, qrUrl: "https://example.test/CEDO/id?token=00000000-0000-4000-8000-000000000001",
});
const outFile = process.argv[2] ?? path.join(tmp, "csr_sample.pdf");
fs.writeFileSync(outFile, bytes);
console.log(outFile, bytes.length);
