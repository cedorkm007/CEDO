// tests/pdf-size-hint/logic_tests.mjs — a big scanned PDF gets a friendly tip (how to make it smaller) before it is uploaded (3 checks, short on purpose)
// Run:  node tests/pdf-size-hint/logic_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pdfhint-")), "u.mjs");
await build({ entryPoints: [path.join(root, "src/lib/uploadResilience.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const U = await import(pathToFileURL(out).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const MB = 1024 * 1024;
const pdf = (size, name = "scan.pdf") => ({ name, type: "application/pdf", size });

check("1 a PDF from 5 MB up gets a tip that names the file and its size and says how to scan smaller; smaller PDFs and other files get none",
  U.bigPdfHint(pdf(8.1 * MB)).includes("“scan.pdf” is 8.1 MB") && /lower quality/.test(U.bigPdfHint(pdf(8.1 * MB)))
  && U.bigPdfHint(pdf(4.9 * MB)) === null && U.bigPdfHint({ name: "p.jpg", type: "image/jpeg", size: 9 * MB }) === null && U.bigPdfHint({ name: "d.docx", type: "", size: 9 * MB }) === null);
check("2 a PDF over the 20 MB limit is told it will most likely be refused; a PDF whose type is empty is still recognised by its .pdf name",
  /over the 20 MB limit/.test(U.bigPdfHint(pdf(21 * MB))) && !/over the 20 MB limit/.test(U.bigPdfHint(pdf(19 * MB))) && U.bigPdfHint({ name: "SCAN.PDF", type: "", size: 7 * MB }) !== null);
const list = src("src/scholar/components/dashboard/SubmissionActivitiesList.tsx");
check("3 the upload screen shows the tip under the file box when a file is picked (it never blocks the upload, and a wrong-type or too-many-files error replaces it)",
  list.includes("bigPdfHint(f)") && list.includes("sizeHints[field.id]") && list.includes("!fieldErrors[field.id] && (sizeHints") && list.includes("error ? [] : selected.map"));
console.log(`\n${passed} passed`);
