// tests/scholar-apply-network/network_tests.mjs — "Failed to fetch" while a scholar submits the renewal application:
//   the helpers (src/lib/uploadResilience.ts) and how the application call (src/scholar/renewalApi.ts) uses them, with a pretend Supabase that drops the connection.
// Run:  node tests/scholar-apply-network/network_tests.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { File as NodeFile } from "node:buffer";
globalThis.File ??= NodeFile;
globalThis.crypto ??= (await import("node:crypto")).webcrypto;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const bundle = async (entry, name, extra = {}) => {
  const out = path.join(root, `.net_tmp_${name}.mjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") }, ...extra });
  return out;
};
const cleanup = [];

// ── the helpers ──
const helperFile = await bundle("src/lib/uploadResilience.ts", "helpers"); cleanup.push(helperFile);
const H = await import(pathToFileURL(helperFile).href + "?t=" + Date.now());
const noSleep = async () => {};

await test("these messages are recognised as 'the request did not get through'", () => {
  for (const m of ["Failed to fetch", "TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "Network request failed", "The network connection was lost.", "request timed out", "fetch failed"]) assert.equal(H.isNetworkErrorMessage(m), true, m);
});
await test("real refusals from the database are not mistaken for a dropped connection", () => {
  for (const m of ["You have an INC in 2nd Semester 2025-2026.", "Enter your grades first.", "new row violates row-level security policy", "You already applied for this renewal.", "", null, undefined]) assert.equal(H.isNetworkErrorMessage(m), false, String(m));
});
await test("a dropped connection is tried again and the second try is used", async () => {
  let calls = 0;
  const r = await H.retryOnNetworkError(async () => (++calls === 1 ? { error: { message: "TypeError: Failed to fetch" } } : { error: null, data: "ok" }), [1, 1], noSleep);
  assert.equal(calls, 2); assert.equal(r.error, null);
});
await test("it gives up after the last try and returns the error", async () => {
  let calls = 0;
  const r = await H.retryOnNetworkError(async () => { calls++; return { error: { message: "Failed to fetch" } }; }, [1, 1], noSleep);
  assert.equal(calls, 3); assert.equal(r.error.message, "Failed to fetch");
});
await test("a refusal for a real reason is returned at once, without trying again", async () => {
  let calls = 0;
  const r = await H.retryOnNetworkError(async () => { calls++; return { error: { message: "Enter your grades first." } }; }, [1, 1], noSleep);
  assert.equal(calls, 1); assert.equal(r.error.message, "Enter your grades first.");
});
await test("a call that throws (instead of returning an error) is handled the same way", async () => {
  let calls = 0;
  const r = await H.retryOnNetworkError(async () => { if (++calls < 3) throw new TypeError("Failed to fetch"); return { error: null }; }, [1, 1], noSleep);
  assert.equal(calls, 3); assert.equal(r.error, null);
});
await test("the message for the scholar says what failed, that nothing was saved, and what to do", () => {
  const t = H.networkProblemText("send your application");
  assert.match(t, /could not send your application/); assert.match(t, /Nothing was saved/); assert.match(t, /press Submit again/); assert.doesNotMatch(t, /Failed to fetch/i);
});
await test("a big screenshot shrinks to the limit without being stretched, a small one is left alone", () => {
  const phone = H.shrunkSize(1170, 2532); assert.equal(phone.height, 2400); assert.equal(phone.width, Math.round(1170 * 2400 / 2532));
  const s = H.shrunkSize(4000, 8000); assert.equal(s.height, 2400); assert.equal(s.width, 1200);
  assert.deepEqual(H.shrunkSize(800, 600), { width: 800, height: 600 });
});
await test("only big JPG, PNG or WEBP pictures are shrunk (not small ones, not other types)", () => {
  assert.equal(H.shouldShrink({ type: "image/png", size: 4 * 1024 * 1024 }), true);
  assert.equal(H.shouldShrink({ type: "image/jpeg", size: 9 * 1024 * 1024 }), true);
  assert.equal(H.shouldShrink({ type: "image/png", size: 500 * 1024 }), false);
  assert.equal(H.shouldShrink({ type: "application/pdf", size: 9 * 1024 * 1024 }), false);
});
await test("a picture that cannot be read in the browser is sent as it is (no browser here, so the original comes back)", async () => {
  const f = new File([new Uint8Array(2 * 1024 * 1024)], "shot.png", { type: "image/png" });
  assert.equal(await H.shrinkImageForUpload(f), f);
});

// ── the application call, with a pretend Supabase ──
const apiFile = await bundle("src/scholar/renewalApi.ts", "api", { plugins: [{ name: "fake-supabase", setup(b) { b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: "fake-supabase", namespace: "fake" })); b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: "export const supabase = new Proxy({}, { get: (_t, k) => globalThis.__fakeSupabase[k] });", loader: "js" })); } }] });
cleanup.push(apiFile);
const API = await import(pathToFileURL(apiFile).href + "?t=" + Date.now());
const PNG = (name, bytes = 1000) => new File([new Uint8Array(bytes)], name, { type: "image/png" });
const makeFake = (plan) => {
  const log = { uploads: [], removed: [], applyCalls: 0 };
  const fake = {
    rpc: async (name, args) => {
      if (name === "renewal_apply") { log.applyCalls++; const r = plan.apply(log.applyCalls, args); if (r.saved) log.saved = true; return r.res; }
      if (name === "renewal_my_overview") return { data: { scholar: { scholar_id_number: "X", school: "S", program: "P", year_level: "1", status: "Active" }, windows: [{ window: { id: "W1", school_year: "2026-2027", term: "1st Semester", opens_on: "2026-10-01", closes_on: "2026-11-30", late_allowed: true, note: "" }, state: "open", record: log.saved ? { id: "R1", stage: "submitted", evaluation: {} } : null, documents: [], history: [], inc_items: [] }] }, error: null };
      return { data: null, error: { message: "unexpected rpc " + name } };
    },
    storage: { from: () => ({
      upload: async (p, f) => { const r = plan.upload(log.uploads.length + 1, f); log.uploads.push({ p, ok: !r }); return r ? { data: null, error: r } : { data: {}, error: null }; },
      remove: async (paths) => { log.removed.push(...paths); return { data: [], error: null }; },
    }) },
    auth: { getUser: async () => ({ data: { user: null } }) },
  };
  globalThis.__fakeSupabase = fake;
  return log;
};
const base = { windowId: "W1", school: "S", program: "P", yearLevel: "1", note: "", scholarIdNumber: "TEST-0016" };
const gradeArgs = { lines: [{ code: "M1", subject: "Math", units: "3", grade: "A" }], newFiles: [PNG("a.png"), PNG("b.png")], acknowledged: true };
// make the waits instant for these tests
const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);

await test("grades + SDP request: a screenshot upload that drops once is tried again and the application goes through", async () => {
  const log = makeFake({ upload: (n) => (n === 1 ? { message: "TypeError: Failed to fetch" } : null), apply: () => ({ saved: true, res: { data: "R1", error: null } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true, grades: gradeArgs });
  assert.equal(r.ok, true); assert.equal(log.uploads.length, 3); assert.equal(log.applyCalls, 1);
});
await test("the connection stays down while sending the screenshots: a clear message, the files already sent are removed, nothing is applied", async () => {
  const log = makeFake({ upload: (n) => (n >= 2 ? { message: "TypeError: Failed to fetch" } : null), apply: () => ({ saved: true, res: { data: "R1", error: null } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true, grades: gradeArgs });
  assert.equal(r.ok, false); assert.match(r.error, /could not send your grade screenshot \(2 of 2\)/); assert.doesNotMatch(r.error, /Failed to fetch/);
  assert.equal(log.removed.length, 1); assert.equal(log.applyCalls, 0);
});
await test("the application call drops once and is sent again", async () => {
  const log = makeFake({ upload: () => null, apply: (n) => (n === 1 ? { saved: false, res: { data: null, error: { message: "TypeError: Failed to fetch" } } } : { saved: true, res: { data: "R1", error: null } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true, grades: gradeArgs });
  assert.equal(r.ok, true); assert.equal(log.applyCalls, 2);
});
await test("the application WAS saved but the answer got lost: it counts as done, and the uploaded screenshots are kept", async () => {
  const log = makeFake({ upload: () => null, apply: () => ({ saved: true, res: { data: null, error: { message: "TypeError: Failed to fetch" } } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true, grades: gradeArgs });
  assert.equal(r.ok, true); assert.equal(log.removed.length, 0);
});
await test("the application never gets through: a clear message, the screenshots are removed again", async () => {
  const log = makeFake({ upload: () => null, apply: () => ({ saved: false, res: { data: null, error: { message: "TypeError: Failed to fetch" } } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true, grades: gradeArgs });
  assert.equal(r.ok, false); assert.match(r.error, /could not send your application/); assert.match(r.error, /Nothing was saved/); assert.equal(log.removed.length, 2);
});
await test("a real refusal (not a network problem) is shown as it is and is not tried again", async () => {
  const log = makeFake({ upload: () => null, apply: () => ({ saved: false, res: { data: null, error: { message: "Enter your grades first." } } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true, grades: gradeArgs });
  assert.equal(r.ok, false); assert.equal(r.error, "Enter your grades first."); assert.equal(log.applyCalls, 1);
});
await test("the plain application (no grades, SDP request only) also survives one dropped connection, and says so clearly when it cannot get through", async () => {
  makeFake({ upload: () => null, apply: (n) => (n === 1 ? { saved: false, res: { data: null, error: { message: "Failed to fetch" } } } : { saved: true, res: { data: "R1", error: null } }) });
  assert.equal((await API.applyForRenewal({ ...base, requestSdpReconsideration: true })).ok, true);
  makeFake({ upload: () => null, apply: () => ({ saved: false, res: { data: null, error: { message: "Failed to fetch" } } }) });
  const r = await API.applyForRenewal({ ...base, requestSdpReconsideration: true });
  assert.equal(r.ok, false); assert.match(r.error, /Nothing was saved/);
});
globalThis.setTimeout = realSetTimeout;

for (const f of cleanup) fs.rmSync(f, { force: true });
console.log(`\n${passed} passed`);
