// tests/keep-alive/logic_tests.mjs — every staff tool and tab the staff member already opened stays alive when they switch away: no new "Loading…" and no new read, unless something changed meanwhile or they were away long (5 checks, short on purpose)
// Run:  node tests/keep-alive/logic_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keep-"));
const out = path.join(tmp, "k.mjs");
await build({ entryPoints: [path.join(root, "src/lib/keepAlive.tsx")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", jsx: "automatic", absWorkingDir: root });
const K = await import(pathToFileURL(out).href);
const stub = path.join(tmp, "supabase-stub.mjs");
fs.writeFileSync(stub, "export const supabase = { rpc: async () => ({ data: 'x', error: null }) };");
const outLive = path.join(tmp, "live.mjs");
await build({ entryPoints: [path.join(root, "src/lib/liveUpdates.tsx")], bundle: true, format: "esm", platform: "node", outfile: outLive, logLevel: "error", jsx: "automatic", absWorkingDir: root, alias: { "@/lib/supabase": stub, "@": path.join(root, "src") } });
const L = await import(pathToFileURL(outLive).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const step = (s, active, key, now, stale) => { const n = K.nextPaneState(s, active, key, now, stale); return { s: { seen: n.seen, shownKey: n.shownKey, hiddenAt: n.hiddenAt, generation: n.generation }, n }; };

// 1. never opened = nothing loaded; opened = stays (hidden); the refresh number only moves while shown
let r = step({ seen: false, shownKey: 0 }, false, 0, 0);
const neverOpened = r.n.render;
r = step(r.s, true, 0, 1); const opened = r.n.render;
r = step(r.s, false, 1, 2); const staysHidden = r.n.render;       // the refresh number went to 1 while hidden
const frozen = r.n.shownKey;
r = step(r.s, true, 1, 3); const afterBack = r.n.shownKey;
check("1 a tab or tool never opened renders nothing (nothing is loaded for it); once opened it stays (hidden) when another is chosen; a refresh made while hidden reaches it only when it is shown again",
  neverOpened === false && opened === true && staysHidden === true && frozen === 0 && afterBack === 1, `${neverOpened} ${opened} ${staysHidden} ${frozen} ${afterBack}`);
// 2. away too long: a tab without live updates is built again; a quick switch is not; a live tab (no limit) never is
const MIN = 60_000;
let a = step({ seen: true, shownKey: 0 }, false, 0, 0, 2 * MIN);      // hidden at time 0
a = step(a.s, true, 0, 1 * MIN, 2 * MIN); const quick = a.n.generation;       // back after 1 minute: the same screen
let b = step({ seen: true, shownKey: 0 }, false, 0, 0, 2 * MIN);
b = step(b.s, true, 0, 5 * MIN, 2 * MIN); const slow = b.n.generation;       // back after 5 minutes: read fresh
let c = step({ seen: true, shownKey: 0 }, false, 0, 0, undefined);
c = step(c.s, true, 0, 60 * MIN, undefined); const live = c.n.generation;     // a live tab: never rebuilt
check("2 coming back within 2 minutes shows the same screen at once; after a long absence a tab WITHOUT live updates reads fresh data; a tab that follows the live updates is never rebuilt", quick === 0 && slow === 1 && live === 0 && K.TAB_STALE_MS === 2 * MIN && K.TOOL_STALE_MS === 10 * MIN, `${quick} ${slow} ${live}`);
// 3. the live-reload rule
let reads = 0; const gate = K.createLiveReloadGate(() => { reads++; });
gate.activeChanged(true); gate.tick(true); const afterShown = reads;
gate.tick(false); gate.tick(false); gate.tick(false); const whileHidden = reads;
gate.activeChanged(true); const afterBackReads = reads;
gate.activeChanged(false); gate.activeChanged(true);
check("3 live changes read at once while the tab is shown; while it is hidden they are only remembered (three changes = one read when it is shown again); switching away and back with nothing changed reads nothing",
  afterShown === 1 && whileHidden === 1 && afterBackReads === 2 && reads === 2, `${afterShown} ${whileHidden} ${afterBackReads} ${reads}`);
// 4. a hidden tool does not ask the database; when shown again it compares with the last code it knew
const live2 = src("src/lib/liveUpdates.tsx");
let changes = 0;
const timers = []; const poller = L.createLivePoller({ baseMs: 10_000, initialStamp: "a", fetchStamp: async () => ({ ok: true, stamp: "b" }), onChange: () => { changes++; }, setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
poller.start(); await new Promise(res => setImmediate(res));
check("4 every screen that follows the live updates obeys its tab (a screen in a hidden tab does not read), a hidden tool stops asking the database, and when it is shown again the first answer is compared with the last code it knew (a change made meanwhile still shows)",
  live2.includes("useLiveReloadGate(reload, useLiveTick(), useTabActive())") && live2.includes("enabled && tabActive") && live2.includes("initialStamp: lastStamp.current") && changes === 1, `${changes}`);
// 5. every tool of the staff app and the tabs inside the tools use it
const app = src("src/app/App.tsx");
const tools = (app.match(/<KeepAlivePane active=\{page==="/g) ?? []).length;
const tabsFiles = ["src/sead/ScholarManagementToolsPage.tsx", "src/sead/ScholarsGradesMonitoringPage.tsx", "src/sead/QuestManagementToolsPage.tsx", "src/sead/pages/MyResearchPage.tsx", "src/sead/pages/ResearchProjectMonitoringTab.tsx", "src/itadmin/AccountsPage.tsx", "src/kauban/admin/KaubanContentManagementPage.tsx", "src/sead/ScholarCounselingToolPage.tsx", "src/sead/ScholarRenewalPage.tsx"];
const allTabs = tabsFiles.every(f => src(f).includes("<KeepAlivePane "));
const page = src("src/sead/ScholarRenewalPage.tsx");
check("5 all 19 tools of the staff app stay alive when another tool is open, the tabs inside the tools do too, and a scholar's detail page opens on top of the Renewal lists (Back shows the same list at once)",
  tools === 19 && allTabs && page.includes("<div hidden={!!detailId}>") && !page.includes("{detailId ? ("), `${tools}`);
console.log(`\n${passed} passed`);
