// tests/survey-sections/web_tests.mjs — the screen rules for sections, skips, dragging and the scholar's path (4 checks, short on purpose)
// Run:  node tests/survey-sections/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svs-"));
const outfile = path.join(tmp, "builder.mjs");
await build({ entryPoints: [path.join(root, "src/lib/surveyBuilder.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const S = await import(pathToFileURL(outfile).href);
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const sections = [{ id: "A", title: "One" }, { id: "B", title: "Two" }, { id: "C", title: "Three" }];
const q = (id, sectionId, extra = {}) => ({ id, sectionId, questionType: "open_ended", choices: [], ...extra });
const list = [q("1", "A"), q("2", "A"), q("3", "B"), q("4", "C")];
const groups = S.groupBySection(sections, list);
const ids = g => g.map(x => `${x.section?.id ?? "-"}:${x.questions.map(y => y.id).join("")}`).join(" ");

test("questions are grouped by section (one unnamed group without sections) and dragging moves a question within or between sections, and a whole section", () => {
  assert.equal(ids(groups), "A:12 B:3 C:4");
  assert.equal(ids(S.groupBySection([], [q("1", null)])), "-:1");
  assert.equal(ids(S.moveQuestion(groups, "2", "A", "1")), "A:21 B:3 C:4");
  assert.equal(ids(S.moveQuestion(groups, "1", "C", null)), "A:2 B:3 C:41");
  assert.equal(ids(S.moveQuestion(groups, "4", "B", "3")), "A:12 B:43 C:");
  assert.equal(ids(S.moveSection(groups, "C", 0)), "C:4 A:12 B:3");
  assert.deepEqual(S.layoutOf(S.moveSection(groups, "C", 0))[0], { sectionId: "C", questionIds: ["4"] });
});

test("only later questions and sections can be skipped to, and a skip that was moved or deleted is reported", () => {
  const t = S.skipTargets(groups, "2", null);
  assert.deepEqual([t.questions.map(x => x.id), t.sections.map(x => x.id)], [["3", "4"], ["B", "C"]]);
  assert.deepEqual(S.skipTargets(groups, null, "B").questions.map(x => x.id), ["4"]);
  assert.equal(S.skipProblem(groups, list[1], { skipToQuestionId: "4" }), null);
  assert.match(S.skipProblem(groups, list[2], { skipToQuestionId: "1" }), /no longer after/);
  assert.match(S.skipProblem(groups, list[1], { skipToQuestionId: "gone" }), /deleted/);
  assert.match(S.skipProblem(groups, list[2], { skipToSectionId: "A" }), /no longer after/);
  assert.match(S.skipProblem(groups, list[0], { skipToSectionId: "X" }), /deleted/);
});

test("the scholar's path: optional questions may be left blank, skips only go forward, progress shows the section, and each section's intro is due on entering it", () => {
  const take = [
    { id: "1", sectionId: "A", questionType: "multiple_choice", choices: [{ id: "y", skipToQuestionId: null, endsSurvey: false }, { id: "n", skipToQuestionId: "4", endsSurvey: false }, { id: "back", skipToQuestionId: "1", endsSurvey: false }] },
    { id: "2", sectionId: "A", questionType: "open_ended", isOptional: true, choices: [] },
    { id: "3", sectionId: "B", questionType: "likert", choices: [] },
    { id: "4", sectionId: "C", questionType: "open_ended", choices: [] },
  ];
  assert.equal(S.canContinue(take[1], undefined), true);
  assert.equal(S.canContinue(take[2], undefined), false);
  assert.equal(S.resolveNextIndex(take, 0, { choiceId: "n" }), 3);
  assert.equal(S.resolveNextIndex(take, 0, { choiceId: "back" }), 1);
  assert.deepEqual(S.buildInitialPath(take, { 1: { choiceId: "n" } }), [0, 3]);
  assert.deepEqual(S.buildInitialPath(take, { 1: { choiceId: "a choice that was removed" } }), [0]);
  assert.equal(S.progressLabel(sections, take, 2), "Section 2 of 3 · Question 3 of 4");
  assert.equal(S.progressLabel([], take, 2), "Question 3 of 4");
  assert.equal(S.introSectionId(take, [0]), "A");
  assert.equal(S.introSectionId(take, [0, 1]), null);
  assert.equal(S.introSectionId(take, [0, 3]), "C");
});

test("the screens use these rules and ask before deleting: confirmations show the answers affected, bulk upload takes a Section column, and the editor writes only through the safe database calls", () => {
  const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
  const editor = src("src/sead/components/survey/SurveyOutlineEditor.tsx");
  assert.match(editor, /Delete this question\?/); assert.match(editor, /Delete this section\?/); assert.match(editor, /answerCount/);
  assert.match(src("src/sead/pages/research/SurveyToolsSubtab.tsx"), /Surveys with answers can only be deactivated/);
  assert.match(src("src/sead/components/BulkSurveyQuestionUploadModal.tsx"), /"Section"/);
  assert.match(src("src/sead/components/SurveyQuestionEditorModal.tsx"), /Just fixing the wording/);
  assert.match(src("src/scholar/components/dashboard/SurveyResponseModal.tsx"), /progressLabel\(/);
  for (const f of ["src/sead/surveyEditorApi.ts", "src/sead/components/SurveyQuestionEditorModal.tsx", "src/sead/components/BulkSurveyQuestionUploadModal.tsx", "src/sead/components/survey/SurveyOutlineEditor.tsx"]) {
    assert.doesNotMatch(src(f), /from\("research_survey_(questions|choices)"\)/);
  }
});
console.log(`\n${passed} passed`);
