// tests/renewal-traffic/logic_tests.mjs — less traffic during the renewal: reloads are joined, big photos are shrunk before they are sent (3 checks, short on purpose)
// Run:  node tests/renewal-traffic/logic_tests.mjs     (no database or browser needed; time is simulated)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "traffic-"));
const stub = path.join(tmp, "supabase-stub.mjs");
fs.writeFileSync(stub, "export const supabase = { rpc: async () => ({ data: 'x', error: null }) };");
const bundle = async (entry, out) => { const f = path.join(tmp, out); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@/lib/supabase": stub, "@": path.join(root, "src") }, jsx: "automatic" }); return import(pathToFileURL(f).href); };
const L = await bundle("src/lib/liveUpdates.tsx", "live.mjs");
const U = await bundle("src/lib/uploadResilience.ts", "up.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };

// a fake clock
let t = 0; const timers = [];
const gateOf = gapMs => { let fired = 0; const g = L.createTickGate({ gapMs, fire: () => { fired++; }, now: () => t, setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: x => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); } }); return { g, fired: () => fired }; };
const advance = ms => { t += ms; for (const x of [...timers].sort((a, b) => a.at - b.at)) if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.fn(); } };

const a = gateOf(15000);
a.g.trigger();                                   // first change: at once
const first = a.fired();
for (let i = 0; i < 20; i++) { advance(500); a.g.trigger(); }     // 10 seconds of changes
const during = a.fired();
advance(6000);                                   // the gap is over: ONE more reload, not twenty
check("1 the first change reloads the screens at once; a burst of changes is joined into ONE more reload after the gap (not one per change)", first === 1 && during === 1 && a.fired() === 2, `${first} ${during} ${a.fired()}`);
const b = gateOf(0); b.g.trigger(); b.g.trigger();
check("2 the staff portal joins reloads (at most one per 15 seconds), the scholar portal still reloads at once and asks every 30 seconds (it was 15), the staff keep asking every 10", L.LIVE_MIN_RELOAD_GAP_MS.staff === 15000 && L.LIVE_MIN_RELOAD_GAP_MS.scholar === 0 && b.fired() === 2 && L.LIVE_INTERVAL_MS.scholar === 30000 && L.LIVE_INTERVAL_MS.staff === 10000);
const ren = src("src/scholar/renewalApi.ts"), sub = src("src/scholar/submissionsApi.ts");
const gradesSend = ren.slice(ren.indexOf("Sends the entered grades"));
check("3 the pictures of the entered grades and the photos sent to a submission activity are shrunk before they are uploaded (only big ones; a JPG keeps its type and name)",
  gradesSend.slice(0, gradesSend.indexOf("renewal_self_grades_submit")).includes("shrinkImageForUpload(readable)") && sub.includes("shrinkJpegForUpload(file)")
  && U.shouldShrinkJpeg({ type: "image/jpeg", size: 6 * 1024 * 1024 }) && !U.shouldShrinkJpeg({ type: "image/jpeg", size: 400 * 1024 }) && !U.shouldShrinkJpeg({ type: "application/pdf", size: 9 * 1024 * 1024 }) && !U.shouldShrinkJpeg({ type: "image/png", size: 9 * 1024 * 1024 }));
const app = src("src/app/App.tsx");
const sync = app.slice(app.indexOf("let running = false;"), app.indexOf("}, [currentUser]);", app.indexOf("let running = false;")));
check("4 the staff screens no longer read the four WHOLE tables (notifications, submissions, leave, logs) every 5 seconds: the safety poll is every 30 seconds and not while the page is hidden",
  !app.includes("setInterval(syncNow, 5_000)") && sync.includes("}, 30_000)") && sync.includes("if (!document.hidden)") && sync.includes("TABLES.NOTIFICATIONS) ? getAll"));
check("5 a change in one table reads only that table, a burst of changes is joined into one read per 10 seconds, and a change that arrives during a read is read right after it (never lost)",
  sync.includes("syncNow([table])") && sync.includes("10_000") && sync.includes("throttledSync(TABLES.NOTIFICATIONS)") && sync.includes("queued") && !sync.includes(", syncNow)"));
console.log(`\n${passed} passed`);

