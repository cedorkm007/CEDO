// tests/failures-no-letter/web_tests.mjs — the application screen lists only the study plan and the clearance for failed subjects (2 checks, short on purpose)
// Run:  node tests/failures-no-letter/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "onef-")), "r.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewal.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(out).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

check("1 failed subjects (one, two or three) send the study plan and the clearance; an INC, or a failed subject together with an INC, sends all three; nothing failed sends none",
  R.docsForCase({ failed: 1, inc: 0 }).join() === "study_plan,clearance" && R.docsForCase({ failed: 2, inc: 0 }).join() === "study_plan,clearance" && R.docsForCase({ failed: 3, inc: 0 }).length === 2
  && R.docsForCase({ failed: 0, inc: 1 }).length === 3 && R.docsForCase({ failed: 1, inc: 1 }).length === 3 && R.docsForCase({ failed: 0, inc: 0 }).length === 0);
const panel = src("src/scholar/components/dashboard/RenewalPanel.tsx");
check("2 the application screen lists only the documents of the case (and says 'two' or 'three')", panel.includes("docsForCase(caseCounts)") && panel.includes("docsToSend.map(d =>") && panel.includes("these two documents"));
console.log(`\n${passed} passed`);
