// tests/study-plan-generic/web_tests.mjs — one generic study plan form: one upload button for staff, always downloadable in the scholar portal (only how it is shown)
// Run:  node tests/study-plan-generic/web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const staff = src("src/sead/pages/RenewalStudyPlanFormsSection.tsx"), panel = src("src/scholar/components/dashboard/RenewalPanel.tsx"), forms = src("src/sead/pages/FormsManagementTab.tsx"), link = src("src/scholar/components/dashboard/StudyPlanFormLink.tsx");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("Staff: Forms Management > Renewal study plan");
test("there is ONE upload for the whole program: no list of schools, no row per school", () => {
  assert.equal((staff.match(/<TemplateRow\b/g) ?? []).length, 1);
  assert.equal(/schools\.map|StudyPlanSchool/.test(staff), false);
  assert.ok(staff.includes("Upload the study plan form") && staff.includes("There is one study plan form for all scholars."));
});
test("the file is saved as the default (every scholar's) template", () => {
  assert.ok(staff.includes("uploadStudyPlanTemplate(null, file)") && staff.includes("removeStudyPlanTemplate(null)"));
});
test("a template an earlier design kept for a single school is removed after the new form is saved (so no scholar gets an older school one), and only after the new file is safely saved", () => {
  const up = staff.slice(staff.indexOf("async function upload("), staff.indexOf("async function remove()"));
  assert.ok(up.indexOf("if (!r.ok)") > 0 && up.indexOf("removeStudyPlanTemplate(old.schoolId)") > up.indexOf("if (!r.ok)") && /leftovers = templates\.filter\(t => t\.schoolId !== null\)/.test(staff));
});
test("Replace and Remove (asks first) and View are still there", () => {
  assert.ok(staff.includes("Replace") && staff.includes("Remove it?") && staff.includes("onView(template)"));
});
test("the tab is named in the singular", () => assert.ok(forms.includes("Renewal study plan\n") || forms.includes("Renewal study plan<") || /<GraduationCap size=\{14\} \/> Renewal study plan\s/.test(forms)));

console.log("\nScholar: the Renewal tile");
test("a 'Study plan form' card with the download is on the Renewal tile in every state: loading, an error, no renewal open, and with renewals", () => {
  assert.equal((panel.match(/<StudyPlanCard \/>/g) ?? []).length, 4);
  assert.ok(panel.includes("function StudyPlanCard()") && panel.includes("<StudyPlanFormLink />"));
});
test("it does not depend on applying: the card is outside the window cards and the application", () => {
  const card = panel.slice(panel.indexOf("function StudyPlanCard()"), panel.indexOf("function WindowCard("));
  assert.equal(/record|applying|windows/.test(card.replace(/windows\b/, "")), false);
  assert.ok(card.includes("even before you apply for renewal"));
});
test("it uses the same download as before (the scholar's template, then a Forms-tab form, then a message), and no longer talks about each school having its own", () => {
  assert.ok(link.includes("fetchMyStudyPlanForm()") && link.includes("Download the study plan form"));
  assert.equal(/every school has its own template/.test(link), false);
});
test("the study plan row of the application documents still offers the download", () => {
  assert.ok(panel.includes('{req.kind === "study_plan" && <StudyPlanFormLink />}'));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
