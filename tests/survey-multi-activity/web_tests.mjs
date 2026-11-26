// tests/survey-multi-activity/web_tests.mjs — choosing activities, counts per activity and the scholar's banner (3 checks, short on purpose)
// Run:  node tests/survey-multi-activity/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sma-"));
const bundle = async (entry, name) => { const outfile = path.join(tmp, name); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" }); return pathToFileURL(outfile).href; };
const S = await import(await bundle("src/lib/surveyBuilder.ts", "builder.mjs"));
const R = await import(await bundle("src/lib/surveyResults.ts", "results.mjs"));
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const a = (id, extra = {}) => ({ id, type: "sdp", name: `Activity ${id}`, category: "community_service", subCategory: "community_based", date: "2026-11-10T01:00:00Z", surveyId: null, surveyTitle: null, ...extra });
const options = [a("1"), a("2", { category: "formation_program", subCategory: "formation", date: "2026-10-01T01:00:00Z" }), a("3", { type: "formation", category: null, subCategory: null, name: "Leadership talk" }), a("4", { surveyId: "other", surveyTitle: "Venue feedback" })];
const ids = list => list.map(x => x.id).join("");

test("activities are found by name, type, category, sub-category and Philippine date; an activity with another survey cannot be ticked, its own can", () => {
  const f = patch => ids(S.filterActivities(options, { ...S.NO_ACTIVITY_FILTERS, ...patch }));
  assert.equal(f({}), "1234");
  assert.equal(f({ search: "leader" }), "3");
  assert.equal(f({ type: "formation" }), "3");
  assert.equal(f({ category: "formation_program" }), "2");
  assert.equal(f({ subCategory: "community_based" }), "14");
  assert.equal(f({ from: "2026-11-01" }), "134");
  assert.equal(f({ to: "2026-10-01" }), "2");
  assert.equal(S.takenBy(options[3], "mine"), "Venue feedback");
  assert.equal(S.takenBy(options[3], "other"), null);
  assert.equal(S.takenBy(options[0], null), null);
});

test("counts per activity list every attached activity (and detached ones that still have scholars); the unwritten 'Section 1' has no intro screen", () => {
  const rows = R.activityCounts([{ id: "1", name: "One", detached: false }, { id: "2", name: "Two", detached: false }],
    [{ activityId: "1", status: "completed" }, { activityId: "1", status: "in_progress" }, { activityId: "9", activityName: "Gone", status: "released" }, { activityId: null, status: "completed" }]);
  assert.deepEqual(rows.map(r => [r.name, r.completed, r.in_progress, r.declined, r.released]), [["One", 1, 1, 0, 0], ["Two", 0, 0, 0, 0], ["Gone", 0, 0, 0, 1]]);
  assert.equal(rows[2].detached, true);
  assert.equal(S.hasIntro({ title: "Section 1", description: "" }), false);
  assert.equal(S.hasIntro({ title: "Section 1", description: "Read this" }), true);
  assert.equal(S.hasIntro({ title: "About the venue", description: "" }), true);
});

test("the screens are wired to it: activities are ticked in a list, results filter by activity, the scholar's banner has one line per activity and opens that one, and the SDP pop-up names the survey", () => {
  assert.match(src("src/sead/components/SurveyEditorModal.tsx"), /<ActivityPicker /);
  assert.match(src("src/sead/components/survey/ActivityPicker.tsx"), /Already has the survey/);
  assert.match(src("src/sead/pages/research/SurveyResultsSubtab.tsx"), /All activities combined/);
  assert.match(src("src/scholar/pages/ScholarPortalPage.tsx"), /activityId=\{openSurvey\.activityId\}/);
  assert.match(src("src/scholar/scholarApi.ts"), /p_activity_id/);
  assert.match(src("src/sead/pages/SDPMonitoringTab.tsx"), /<ActivitySurveyNote activityId=\{activity\.id\} \/>/);
});
console.log(`\n${passed} passed`);
