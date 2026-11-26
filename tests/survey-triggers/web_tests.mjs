// tests/survey-triggers/web_tests.mjs — choosing when a survey is asked, filtering by trigger, the scholar's banner (3 checks, short on purpose)
// Run:  node tests/survey-triggers/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stg-"));
const outfile = path.join(tmp, "results.mjs");
await build({ entryPoints: [path.join(root, "src/lib/surveyResults.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const R = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const roster = [
  { activityId: "1", activityType: "sdp", activityName: "One", trigger: "qr", status: "completed" },
  { activityId: "1", activityType: "sdp", activityName: "One", trigger: "manual", status: "in_progress" },
  { activityId: "r1", activityType: "reconsideration", activityName: "SDP reconsideration – A", trigger: "reconsideration", status: "completed" },
  { activityId: "r2", activityType: "reconsideration", activityName: "SDP reconsideration – B", trigger: "reconsideration", status: "released" },
  { activityId: "1", activityType: "sdp", activityName: "One", trigger: null, status: "declined" },
];

test("all reconsideration requests count as one line, and the list filters by activity and by how it was asked", () => {
  const rows = R.activityCounts([{ id: "1", name: "One", detached: false }], roster);
  assert.deepEqual(rows.map(r => [r.id, r.name, r.completed, r.in_progress, r.declined, r.released, r.detached]),
    [["1", "One", 1, 1, 1, 0, false], ["reconsideration", "SDP reconsideration", 1, 0, 0, 1, false]]);
  assert.equal(R.filterRoster(roster, "reconsideration", "").length, 2);
  assert.equal(R.filterRoster(roster, "1", "manual").length, 1);
  assert.equal(R.filterRoster(roster, "", "none").length, 1);
  assert.equal(R.filterRoster(roster, "", "").length, 5);
  assert.equal(R.triggerLabel("scanner"), "Scanning Tools");
  assert.equal(R.triggerLabel(null), "Not recorded");
});

test("a survey's creator has the five tick boxes, the first two ticked for a new survey, with the warning when the reconsideration tick moves", () => {
  const c = src("src/sead/components/survey/TriggerChoices.tsx");
  for (const words of [/QR scan or typed code/, /Scanning Tools/, /Manual credit by staff/, /Picture-confirmed attendance approval/, /SDP reconsideration/, /Saving moves it to this survey/, /Time In and file import never ask/]) assert.match(c, words);
  assert.match(src("src/sead/components/SurveyEditorModal.tsx"), /qr: true, scanner: true, manual: false, picture: false, reconsideration: false/);
  assert.match(src("src/sead/pages/research/SurveyResultsSubtab.tsx"), /How it was asked/);
});

test("the scholar's banner says whether attendance is waiting, and a reconsideration survey opens after the request is sent", () => {
  const portal = src("src/scholar/pages/ScholarPortalPage.tsx");
  assert.match(portal, /to finalize your attendance/);
  assert.match(portal, /Please answer the survey/);
  assert.match(portal, /n\.trigger === "reconsideration"/);
  assert.match(src("src/scholar/scholarApi.ts"), /my_pending_surveys/);
  assert.match(src("src/scholar/components/dashboard/SurveyResponseModal.tsx"), /was saved/);
});
console.log(`\n${passed} passed`);
