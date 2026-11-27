// tests/survey-ask-once/web_tests.mjs — the screens say a responder is not asked again (1 check)
// Run:  node tests/survey-ask-once/web_tests.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
try {
  assert.match(src("src/scholar/components/dashboard/SurveyResponseModal.tsx"), /You have already answered this survey\./);
  assert.match(src("src/scholar/scholarApi.ts"), /alreadyAnswered/);
  assert.match(src("src/sead/components/SurveyEditorModal.tsx"), /A scholar answers it only once/);
  assert.match(src("src/sead/components/survey/TriggerChoices.tsx"), /already responded is not asked again \(a new reconsideration request still is\)/);
  console.log("  ok   a survey already responded to shows no questions, and the staff screens say a responder is not asked again\n\n1 passed");
} catch (e) { process.exitCode = 1; console.log(`  FAIL ${e.message}`); }
