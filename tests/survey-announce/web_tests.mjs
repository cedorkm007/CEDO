// tests/survey-announce/web_tests.mjs — the Announce button and the scholar's banner (2 checks, short on purpose)
// Run:  node tests/survey-announce/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "san-"));
const outfile = path.join(tmp, "results.mjs");
await build({ entryPoints: [path.join(root, "src/lib/surveyResults.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const R = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("the wait counts down as minutes and seconds, and announced answers are their own line (not a detached activity)", () => {
  assert.deepEqual([600, 545.2, 61, 5, 0, -3].map(R.formatWait), ["10:00", "9:06", "1:01", "0:05", "0:00", "0:00"]);
  const rows = R.activityCounts([], [{ activityId: "s1", activityType: "announcement", activityName: "Announcement", trigger: "announcement", status: "completed" }]);
  assert.deepEqual(rows.map(r => [r.name, r.completed, r.detached]), [["Announcement", 1, false]]);
  assert.equal(R.triggerLabel("announcement"), "Announcement");
});

test("Announce is offered for active surveys only, asks before sending, waits 10 minutes; the scholar's banner names the survey", () => {
  const tools = src("src/sead/pages/research/SurveyToolsSubtab.tsx");
  assert.match(tools, /\{s\.isActive && \(\s*<button[^\n]*setAnnouncing\(s\)[^\n]*disabled=\{waitFor\(s\.id\) > 0\}/);
  assert.match(tools, /Announced · again in/);
  const dialog = src("src/sead/components/survey/AnnounceDialog.tsx");
  for (const words of [/Announce this survey\?/, /Send announcement/, /even without attending the activity/, /again in 10 minutes/]) assert.match(dialog, words);
  assert.match(dialog, /const canSend = !!status && status\.toNotify > 0 && status\.secondsLeft <= 0;/);
  assert.match(src("src/scholar/pages/ScholarPortalPage.tsx"), /s\.trigger === "announcement"\s*\? <>Please answer the survey/);
  assert.match(src("src/scholar/components/dashboard/SurveyResponseModal.tsx"), /Your response was saved\./);
});

console.log(`${passed} passed`);
