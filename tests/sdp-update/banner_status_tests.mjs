// tests/sdp-update/banner_status_tests.mjs — the green / grey SDP marks on the scholar's profile banner (src/scholar/sdpApi.ts: fetchScholarSDPCategoryStatus)
//   A category is green when the saved "completed" mark says so OR the credits shown in the SDP tab (4/3, 6/3 included) reach the requirement.
// Run:  node tests/sdp-update/banner_status_tests.mjs
// No database or browser needed: the database calls are replaced by a small stand-in.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "banner-"));
const stub = path.join(tmp, "supabase-stub.mjs");
fs.writeFileSync(stub, `
export const state = (globalThis.__stubState ??= { saved: [], savedError: null, progress: [], progressError: null });
export const supabase = {
  from: () => ({ select: () => ({ eq: async () => state.savedError ? { data: null, error: { message: state.savedError } } : { data: state.saved, error: null } }) }),
  rpc: async () => state.progressError ? { data: null, error: { message: state.progressError } } : { data: state.progress, error: null },
};`);
const outfile = path.join(tmp, "sdpApi.mjs");
await build({
  entryPoints: [path.join(root, "src/scholar/sdpApi.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error",
  alias: { "@/lib/supabase": stub, "@": path.join(root, "src") },
});
const S = await import(pathToFileURL(outfile).href);
const state = globalThis.__stubState;

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const reset = () => { state.saved = []; state.savedError = null; state.progress = []; state.progressError = null; };
const cats = ["community_service", "community_volunteerism", "formation_program"];
const progress = (a, b, c) => cats.map((category, i) => ({ category, credits: [a, b, c][i], reserved: 0 }));

console.log("SDP marks on the profile banner");
await test("more than 3 credits (4/3) is green even when the saved mark is missing", async () => {
  reset(); state.progress = progress(4, 0, 0);
  assert.deepEqual(await S.fetchScholarSDPCategoryStatus("X"), { community_service: true, community_volunteerism: false, formation_program: false });
});
await test("more than 3 credits is green even when the saved mark says not completed", async () => {
  reset(); state.saved = [{ category: "formation_program", completed: false }]; state.progress = progress(0, 0, 6);
  assert.equal((await S.fetchScholarSDPCategoryStatus("X")).formation_program, true);
});
await test("exactly 3 credits is green; 2 is not", async () => {
  reset(); state.progress = progress(3, 2, 0);
  const s = await S.fetchScholarSDPCategoryStatus("X");
  assert.equal(s.community_service, true); assert.equal(s.community_volunteerism, false);
});
await test("a saved 'completed' mark still shows green when the current credits are lower (nothing that was green turns grey)", async () => {
  reset(); state.saved = [{ category: "community_volunteerism", completed: true }]; state.progress = progress(0, 1, 0);
  assert.equal((await S.fetchScholarSDPCategoryStatus("X")).community_volunteerism, true);
});
await test("each category is judged on its own", async () => {
  reset(); state.saved = [{ category: "community_service", completed: true }]; state.progress = progress(0, 5, 2);
  assert.deepEqual(await S.fetchScholarSDPCategoryStatus("X"), { community_service: true, community_volunteerism: true, formation_program: false });
});
await test("if the credit totals cannot be read, the saved marks are used as before", async () => {
  reset(); state.saved = [{ category: "community_service", completed: true }]; state.progressError = "boom";
  assert.deepEqual(await S.fetchScholarSDPCategoryStatus("X"), { community_service: true, community_volunteerism: false, formation_program: false });
});
await test("if the saved marks cannot be read, the credit totals still decide", async () => {
  reset(); state.savedError = "boom"; state.progress = progress(3, 0, 4);
  assert.deepEqual(await S.fetchScholarSDPCategoryStatus("X"), { community_service: true, community_volunteerism: false, formation_program: true });
});
await test("with nothing at all, everything is grey", async () => {
  reset();
  assert.deepEqual(await S.fetchScholarSDPCategoryStatus("X"), { community_service: false, community_volunteerism: false, formation_program: false });
});
await test("the requirement is the same 3 the SDP tab and the renewal check use", async () => {
  assert.match(fs.readFileSync(path.join(root, "src/lib/renewal.ts"), "utf8"), /SDP_CREDITS_REQUIRED = 3;/);
  assert.match(fs.readFileSync(path.join(root, "src/scholar/components/dashboard/SDPPanel.tsx"), "utf8"), /CREDITS_REQUIRED = 3/);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
