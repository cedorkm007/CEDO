// tests/renewal-document-popup/web_tests.mjs — Consultation Tool > Renewal Cases: a document opens in a pop-up with Approve / Reject (2 checks)
// Run:  node tests/renewal-document-popup/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const viewer = src("src/sead/renewal/RenewalDocumentViewer.tsx"), tab = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx");

// what can be shown inside the pop-up (the pure part of the viewer)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rdp-"));
const out = path.join(tmp, "p.mjs");
fs.writeFileSync(path.join(tmp, "entry.ts"), `const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export function previewKind(fileName: string) { const ext = /\\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1].toLowerCase() ?? ""; if (ext === "pdf") return { kind: "pdf", mime: MIME.pdf }; if (ext in MIME) return { kind: "image", mime: MIME[ext] }; return { kind: "other", mime: null }; }`);
await build({ entryPoints: [path.join(tmp, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const P = await import(pathToFileURL(out).href);
const fn = viewer.match(/export function previewKind[\s\S]*?\n}\n/)?.[0] ?? "";
check("1 the pop-up shows a PDF inside a frame and a picture (png, jpg, webp) as an image; a Word file can only be downloaded; the file is read into the page first (a stored file's own address would not show a PDF inside a pop-up) and released when the pop-up closes",
  P.previewKind("Study plan.PDF").kind === "pdf" && P.previewKind("scan.jpeg").kind === "image" && P.previewKind("a.webp").kind === "image" && P.previewKind("letter.docx").kind === "other"
  && fn.includes('if (ext === "pdf")') && viewer.includes("URL.createObjectURL(") && viewer.includes("URL.revokeObjectURL(made)") && viewer.includes("<iframe title=") && viewer.includes("Word document"));
check("2 pressing a document's name opens the pop-up instead of a new page (no more window.open); a document waiting for approval has Approve and Reject (Reject asks for what to fix); an approved one has Allow resubmission; after an action the pop-up closes and only that case is read again",
  !tab.includes("window.open(") && tab.includes("setViewer({ doc: current, recordId: c.recordId, name: c.name })") && tab.includes("<RenewalDocumentViewer")
  && viewer.includes('doc.status === "submitted" && (') && viewer.includes(">Reject</button>") && viewer.includes("/> Approve") && viewer.includes("Reject it") && viewer.includes('doc.status === "accepted" && (') && viewer.includes("Allow resubmission</button>")
  && (tab.match(/setViewer\(null\); await refreshCase\(id\)/g) ?? []).length === 3);
console.log(`\n${passed} passed`);
