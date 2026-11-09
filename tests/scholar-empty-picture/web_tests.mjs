// tests/scholar-empty-picture/web_tests.mjs — "No content provided": a picture the phone lost arrives empty; it is found before sending and explained in plain words (5 checks, short on purpose)
// Run:  node tests/scholar-empty-picture/web_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { File as NodeFile } from "node:buffer";

globalThis.File ??= NodeFile;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "epic-")), "u.mjs");
await build({ entryPoints: [path.join(root, "src/lib/uploadResilience.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root });
const U = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

await test("1 the storage server's 'No content provided' becomes plain words naming the picture; other messages stay as they are", () => {
  assert.equal(U.isEmptyUploadMessage("No content provided"), true);
  assert.match(U.uploadProblemText("No content provided", "grades.png"), /"grades\.png" could not be read.*remove it, choose the picture again/s);
  assert.equal(U.uploadProblemText("The resource already exists", "grades.png"), "The resource already exists");
});
await test("2 a picture with no bytes is found before sending (null), not sent", async () => assert.equal(await U.makeReadable(new File([], "empty.png", { type: "image/png" })), null));
await test("3 a normal picture is read into memory and comes back with the same bytes, name and type", async () => {
  const r = await U.makeReadable(new File([new Uint8Array([1, 2, 3, 4])], "ok.png", { type: "image/png" }));
  assert.ok(r && r.name === "ok.png" && r.type === "image/png" && r.size === 4);
});
await test("4 a picture the browser cannot read any more (the phone lost it) is found, not sent", async () => {
  const lost = { name: "lost.jpg", type: "image/jpeg", size: 9, lastModified: 0, arrayBuffer: () => Promise.reject(new Error("NotReadableError")) };
  assert.equal(await U.makeReadable(lost), null);
});
await test("5 every place a scholar's grade picture or document is uploaded reads it first and explains an empty one", () => {
  const api = src("src/scholar/renewalApi.ts"), form = src("src/scholar/components/dashboard/SelfGradesForm.tsx");
  assert.equal((api.match(/await makeReadable\(/g) ?? []).length, 4);
  assert.equal((api.match(/uploadProblemText\(up\.error\.message/g) ?? []).length, 4);
  assert.ok(form.includes("await makeReadable(f)") && form.includes("const chosen = [...list]"));
});
console.log(`\n${passed} passed`);
