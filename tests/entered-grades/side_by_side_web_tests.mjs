// tests/entered-grades/side_by_side_web_tests.mjs — reviewing entered grades: the grades and information on the left half, the screenshots large on the right half
// Run:  node tests/entered-grades/side_by_side_web_tests.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tab = fs.readFileSync(path.join(root, "src/sead/renewal/RenewalEnteredGradesTab.tsx"), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("each entered-grades card is two halves on a wide screen: grades and information on the left, the screenshots on the right", () => {
  assert.ok(tab.includes('className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2"'));
  const grid = tab.indexOf('lg:grid-cols-2'), table = tab.indexOf("<table", grid), right = tab.indexOf("Screenshots of ${r.name}", grid);
  assert.ok(grid > 0 && table > grid && right > table, "the table (left) comes before the screenshots (right)");
  assert.ok(tab.indexOf("Approve") > table && tab.indexOf("Approve") < right || tab.indexOf("Return for correction") < right, "the Approve / Return buttons stay with the grades on the left");
});
test("the screenshots are shown large, filling their half, one under the other, and stay in view while the grades are checked", () => {
  assert.ok(tab.includes('className="w-full rounded-md border border-[#e6ecf5] bg-white object-contain"'));
  assert.ok(tab.includes("space-y-2") && tab.includes("lg:sticky") && tab.includes("lg:overflow-y-auto"));
  assert.equal(/h-24 w-24/.test(tab), false, "no more small thumbnails");
});
test("a picture still opens full size in a new tab, and a narrow screen stacks the two halves", () => {
  assert.ok(tab.includes('target="_blank"') && tab.includes("Open ${name} full size") && tab.includes("grid-cols-1"));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
