// tests/live-updates/poller_tests.mjs — the scheduling of the live updates (src/lib/liveUpdates.tsx): when it asks, when it reloads, when it stops
// Run:  node tests/live-updates/poller_tests.mjs     (no database or browser needed; time is simulated)
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
const stub = path.join(tmp, "supabase-stub.mjs");
fs.writeFileSync(stub, "export const supabase = { rpc: async () => ({ data: 'x', error: null }) };");
const outfile = path.join(tmp, "live.mjs");
await build({ entryPoints: [path.join(root, "src/lib/liveUpdates.tsx")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error",
  alias: { "@/lib/supabase": stub, "@": path.join(root, "src") }, jsx: "automatic" });
const L = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const settle = () => new Promise(r => setImmediate(r));

// a fake clock: timers wait in a list until the test lets "time" pass
function clock() {
  const timers = []; let id = 0;
  return {
    setTimer: (fn, ms) => { timers.push({ id: ++id, fn, ms }); return id; },
    clearTimer: tid => { const i = timers.findIndex(t => t.id === tid); if (i >= 0) timers.splice(i, 1); },
    pending: () => timers.length, nextMs: () => timers[0]?.ms,
    async fire() { const t = timers.shift(); if (t) { t.fn(); await settle(); await settle(); } },
  };
}
const make = (stamps, extra = {}) => {
  const c = clock(); const changes = []; let i = 0, asked = 0;
  const p = L.createLivePoller({ baseMs: 10_000, random: () => 0.5, setTimer: c.setTimer, clearTimer: c.clearTimer, onChange: () => changes.push(i),
    fetchStamp: async () => { asked++; const s = stamps[Math.min(i++, stamps.length - 1)]; return typeof s === "function" ? s() : { ok: true, stamp: s }; }, ...extra });
  return { c, p, changes, asked: () => asked };
};

console.log("When it asks");
await test("the first answer is only remembered (nothing reloads), then it waits about the normal interval", async () => {
  const t = make(["a"]); t.p.start(); await settle();
  assert.equal(t.changes.length, 0); assert.equal(t.asked(), 1); assert.equal(t.c.nextMs(), 10_000);
});
await test("when the code is the same nothing reloads; when it differs the page reloads once, and the new code becomes the one to compare with", async () => {
  const t = make(["a", "a", "b", "b"]); t.p.start(); await settle();
  await t.c.fire(); assert.equal(t.changes.length, 0);
  await t.c.fire(); assert.equal(t.changes.length, 1);
  await t.c.fire(); assert.equal(t.changes.length, 1);
});
await test("the wait is spread by up to ±20% so open pages do not all ask together", () => {
  assert.equal(L.nextLiveDelay(10_000, 0, () => 0), 8_000);
  assert.equal(L.nextLiveDelay(10_000, 0, () => 1), 12_000);
  assert.equal(L.nextLiveDelay(10_000, 0, () => 0.5), 10_000);
});
await test("after errors it slows down (doubling, at most 2 minutes) and goes back to normal after one good answer", async () => {
  assert.equal(L.nextLiveDelay(10_000, 1, () => 0.5), 20_000); assert.equal(L.nextLiveDelay(10_000, 2, () => 0.5), 40_000); assert.equal(L.nextLiveDelay(10_000, 9, () => 0.5), 120_000);
  const t = make([() => ({ ok: false, fatal: false }), () => ({ ok: false, fatal: false }), "a", "a"]); t.p.start(); await settle();
  assert.equal(t.c.nextMs(), 20_000); await t.c.fire(); assert.equal(t.c.nextMs(), 40_000); await t.c.fire(); assert.equal(t.c.nextMs(), 10_000);
});
await test("a thrown error counts as a failed try (it does not stop the polling)", async () => {
  const t = make([() => { throw new Error("offline"); }, "a"]); t.p.start(); await settle();
  assert.equal(t.c.pending(), 1); assert.equal(t.c.nextMs(), 20_000);
});

console.log("\nWhen it stops or waits");
await test("an error that will not go away (the SQL was not run, or not allowed) stops it for good: nothing is scheduled", async () => {
  const t = make([() => ({ ok: false, fatal: true })]); t.p.start(); await settle();
  assert.equal(t.c.pending(), 0); t.p.pollNow(); await settle(); assert.equal(t.asked(), 1);
});
await test("which errors are 'for good': function missing, not authorized, not signed in; a network error is not", () => {
  assert.equal(L.isFatalLiveError({ code: "PGRST202", message: "x" }), true);
  assert.equal(L.isFatalLiveError({ message: "Not authorized to follow renewal changes." }), true);
  assert.equal(L.isFatalLiveError({ message: "Not signed in as a scholar." }), true);
  assert.equal(L.isFatalLiveError({ message: "Failed to fetch" }), false);
  assert.equal(L.isFatalLiveError({ status: 503, message: "Service unavailable" }), false);
  assert.equal(L.isFatalLiveError(null), false);
});
await test("while the page is hidden it does not ask (it waits); when it is shown it asks at once", async () => {
  let hidden = true; const t = make(["a", "b"], { isHidden: () => hidden });
  t.p.start(); await settle(); assert.equal(t.asked(), 0); assert.equal(t.c.pending(), 1);
  await t.c.fire(); assert.equal(t.asked(), 0);
  hidden = false; t.p.pollNow(); await settle(); await settle(); assert.equal(t.asked(), 1);
});
await test("asking now cancels the waiting timer (no double asking), and two asks at the same moment do not overlap", async () => {
  let release; const t = make([() => new Promise(r => { release = () => r({ ok: true, stamp: "a" }); })]);
  t.p.start(); await settle(); t.p.pollNow(); t.p.pollNow(); await settle(); assert.equal(t.asked(), 1);
  release(); await settle(); await settle(); assert.equal(t.c.pending(), 1);
});
await test("stop() cancels the next ask and an answer that arrives later is ignored", async () => {
  let release; const t = make([() => new Promise(r => { release = () => r({ ok: true, stamp: "zzz" }); })]);
  t.p.start(); await settle(); t.p.stop(); release(); await settle(); await settle(); assert.equal(t.changes.length, 0); assert.equal(t.c.pending(), 0);
});

console.log("\nHow the portals use it");
await test("the poller is only started for a portal that asks the right function, pauses when hidden, and wakes on show / focus / coming back online", () => {
  const s = src("src/lib/liveUpdates.tsx");
  for (const fn of ["scholar_live_stamp", "staff_live_stamp", "school_live_stamp"]) assert.ok(s.includes(fn), fn);
  assert.match(s, /document\.hidden/); assert.match(s, /visibilitychange/); assert.match(s, /"focus"/); assert.match(s, /"online"/);
});
await test("each portal wraps its page in the provider, and the screens register with useLiveReload (no 'Loading…' flash: they use their quiet load)", () => {
  assert.match(src("src/scholar/pages/ScholarPortalPage.tsx"), /<LiveProvider kind="scholar">/);
  assert.match(src("src/sead/ScholarRenewalPage.tsx"), /<LiveProvider kind="staff">/);
  assert.match(src("src/school/pages/SchoolPortalPage.tsx"), /<LiveProvider kind="school">/);
  for (const f of ["src/scholar/components/dashboard/RenewalPanel.tsx", "src/scholar/components/dashboard/NotificationBell.tsx", "src/scholar/components/dashboard/SDPPanel.tsx", "src/scholar/components/dashboard/RenewalHomeBanner.tsx",
    "src/scholar/components/dashboard/ConsultationPanel.tsx", "src/scholar/components/dashboard/SelfGradesSection.tsx",
    "src/sead/renewal/RenewalBoardTab.tsx", "src/sead/renewal/RenewalLateTab.tsx", "src/sead/renewal/RenewalNotAppliedTab.tsx", "src/sead/renewal/RenewalIncTab.tsx", "src/sead/renewal/RenewalDashboardTab.tsx",
    "src/sead/renewal/RenewalDivisionHeadTab.tsx", "src/sead/renewal/RenewalDetailView.tsx", "src/sead/renewal/RenewalScholarListTab.tsx", "src/sead/renewal/RenewalSdpReconsiderationTab.tsx", "src/sead/renewal/RenewalEnteredGradesTab.tsx",
    "src/sead/appointments/AppointmentsTab.tsx", "src/school/useSchoolData.ts"]) assert.match(src(f), /useLiveReload\(/, f);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
