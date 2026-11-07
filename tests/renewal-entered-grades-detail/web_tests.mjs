// tests/renewal-entered-grades-detail/web_tests.mjs — the renewal detail (staff) shows the grades the scholar entered, approved, with their screenshots (only how it is shown)
// Run:  node tests/renewal-entered-grades-detail/web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const view = src("src/sead/renewal/RenewalDetailView.tsx"), api = src("src/sead/enteredGradesApi.ts"), tab = src("src/sead/renewal/RenewalEnteredGradesTab.tsx");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("Asking for it");
test("the detail asks for the entered grades only when the renewal is using them (the grades count as 'entered by the scholar'), so nothing extra is asked for school-graded scholars", () => {
  assert.ok(view.includes("r.detail.evaluation?.grades?.self_reported ? await fetchRecordEnteredGrades(recordId) : null"));
});
test("it uses the new read-only function; a missing database update (or any failure) just shows nothing", () => {
  assert.ok(api.includes('supabase.rpc("renewal_record_entered_grades", { p_record_id: recordId })') && /if \(error \|\| !data\) return null;/.test(api));
});

console.log("\nShowing it");
test("a block 'Grades entered by the scholar' lists code, subject, units and grade, who approved and when, inside the Grades section", () => {
  const sec = view.slice(view.indexOf("<Section title={`Grades — ${basis}`}>"), view.indexOf("detail.incItems.length > 0"));
  assert.ok(sec.includes("Grades entered by the scholar (") && sec.includes('scope="col" className="py-1 pr-2 font-bold">Code') && sec.includes(">Subject<") && sec.includes(">Units<") && sec.includes(">Grade<"));
  assert.ok(sec.includes("entered.decidedByLabel") && sec.includes("entered.decidedAt") && sec.includes("formatDateTime(entered.submittedAt)"));
});
test("the screenshots are listed with the same picture viewer as the Entered grades tab (turn, zoom, open full size)", () => {
  assert.ok(view.includes('import { Thumb } from "./RenewalEnteredGradesTab";') && /entered\.files\.map\(f => <Thumb key=\{f\.path\} path=\{f\.path\} name=\{f\.name\} \/>\)/.test(view));
  assert.ok(tab.includes("export function Thumb({ path, name }"));
});
test("it only shows while those are the grades that count: when the school's own grades replaced them the old note is shown instead (the block needs self_reported)", () => {
  assert.ok(view.includes("{g?.self_reported && entered && ("));
  assert.ok(view.includes("The scholar had entered grades that were approved; the school's own grades replaced them."));
});
test("the page still shows the counts and the failed / INC subjects below it, unchanged", () => {
  assert.ok(view.includes("(DRP counts as failed)") && view.includes("flagged.map(f =>"));
});
test("nothing is written from here: the new block only reads", () => {
  const sec = view.slice(view.indexOf("Grades entered by the scholar"), view.indexOf("The scholar had entered grades that were approved"));
  assert.equal(/\.rpc\(|\.update\(|\.upload\(|\.insert\(/.test(sec), false);
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
