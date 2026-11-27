// tests/survey-live-results/web_tests.mjs — Survey Results update by themselves, and results can be hidden per section (4 checks, short on purpose)
// Run:  node tests/survey-live-results/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slr-"));
const outfile = path.join(tmp, "results.mjs");
await build({ entryPoints: [path.join(root, "src/lib/surveyResults.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const R = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const row = (id, status, updatedAt) => ({ scholarIdNumber: id, activityId: "a1", status, trigger: "qr", updatedAt });

test("a new, further answered, finished or removed response counts as a change; the same list in another order does not", () => {
  const before = R.rosterSignature([row("1", "in_progress", "10:00"), row("2", "completed", "09:00")]);
  assert.equal(R.rosterSignature([row("2", "completed", "09:00"), row("1", "in_progress", "10:00")]), before);
  for (const after of [
    [row("1", "in_progress", "10:01"), row("2", "completed", "09:00")],                                       // answered one more question
    [row("1", "completed", "10:00"), row("2", "completed", "09:00")],                                         // finished
    [row("1", "in_progress", "10:00"), row("2", "completed", "09:00"), row("3", "in_progress", "10:02")],     // new
    [row("2", "completed", "09:00")],                                                                         // deleted
  ]) assert.notEqual(R.rosterSignature(after), before);
});

test("which sections are hidden is remembered per survey, and a broken or blocked storage just means everything shows", () => {
  const data = new Map();
  const store = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  R.writeHiddenSections("s1", ["sec-a", "none"], store);
  assert.deepEqual(R.readHiddenSections("s1", store), ["sec-a", "none"]);
  assert.deepEqual(R.readHiddenSections("s2", store), []);
  data.set("survey-results-hidden:s3", "not json");
  assert.deepEqual(R.readHiddenSections("s3", store), []);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(R.readHiddenSections("s1", blocked), []);
  R.writeHiddenSections("s1", ["x"], blocked);
});

test("the screen watches only while it is looked at, refreshes charts in place, and has the show / hide buttons", () => {
  const s = src("src/sead/pages/research/SurveyResultsSubtab.tsx");
  assert.match(s, /createLivePoller/);
  assert.match(s, /if \(!tabActive\) return;/);
  assert.match(s, /isHidden: \(\) => document\.hidden/);
  assert.match(s, /key=\{`\$\{q\.id\}:\$\{activityId\}:\$\{trigger\}`\} version=\{version\}/);      // not rebuilt on a refresh, so no "Loading results…" flash
  assert.match(s, /new responses appear by themselves/);
  const t = src("src/app/components/ResultsToggles.tsx");
  for (const words of [/Hide results/, /Show results/, /Show all results/, /Hide all results/]) assert.match(t, words);
  assert.match(src("src/sead/seadApi.ts"), /if \(error \|\| !data\) return null;\s*return data as GatingRosterEntry\[\];/);   // a failed read never empties the list
});

test("hiding keeps the question and hides only its results, on both results screens; My Surveys questions sit under their sections", () => {
  const sections = [{ id: "A", title: "First", description: "" }, { id: "B", title: "Second", description: "" }, { id: "C", title: "Empty", description: "" }];
  const of = { q1: null, q2: "B", q3: "A", q4: "gone" };
  const grouped = R.bySection(["q1", "q2", "q3", "q4"], sections, q => of[q]);
  assert.deepEqual(grouped.map(g => [g.title, g.items]), [["Not in a section", ["q1", "q4"]], ["First", ["q3"]], ["Second", ["q2"]]]);
  assert.deepEqual(R.bySection(["q1"], [], () => null).map(g => g.title), ["Results"]);

  const activity = src("src/sead/pages/research/SurveyResultsSubtab.tsx");
  assert.match(activity, /\{g\.questions\.map\(q => \(/);                          // the questions are listed whether hidden or not
  assert.match(activity, /\{hidden \? null : loading \?/);
  const mine = src("src/mysurveys/results/QuestionResultCard.tsx");
  assert.match(mine, /\{hidden \? null : group\.sameType/);
  assert.match(mine, /\{!hidden && group\.multiVersion/);
  assert.match(src("src/mysurveys/results/SurveyResultsPanel.tsx"), /<SectionHeading/);
});

console.log(`${passed} passed`);
