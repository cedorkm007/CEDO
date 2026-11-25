// tests/daily-records-edit/web_tests.mjs — Daily Records: editing the findings and recommendations (3 checks, short on purpose)
// Run:  node tests/daily-records-edit/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dre-"));
const outfile = path.join(tmp, "edit.mjs");
await build({ entryPoints: [path.join(root, "src/lib/dailyRecordEdit.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const E = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("the Edit button is for the person who wrote the record only; a record that was never edited says nothing, an edited one says when, by whom and how many times", () => {
  assert.equal(E.canEditRecord("u1", "u1"), true);
  assert.equal(E.canEditRecord("u1", "u2"), false);
  assert.equal(E.canEditRecord("u1", null), false);
  assert.equal(E.canEditRecord(null, "u1"), false);
  assert.equal(E.editedLine({ editCount: 0, lastEditedAt: null, editedByName: "" }), null);
  assert.equal(E.editedLine({ editCount: 1, lastEditedAt: "2026-11-25T02:00:00Z", editedByName: "Maria Cruz" }), "Edited · Nov 25, 2026 by Maria Cruz");
  assert.equal(E.editedLine({ editCount: 3, lastEditedAt: "2026-11-25T02:00:00Z", editedByName: "Maria Cruz" }), "Edited · Nov 25, 2026 by Maria Cruz · 3 times");
});
test("only a real change can be saved (spaces at the ends do not count), and over-long text is refused with a clear message (20,000 characters each, 500 for the reason)", () => {
  const rec = { findings: "A", staffRecommendations: "B" };
  assert.equal(E.editChanged(rec, "  A ", "B "), false);
  assert.equal(E.editChanged(rec, "A2", "B"), true);
  assert.equal(E.textProblem("x".repeat(20000), "", ""), "");
  assert.match(E.textProblem("x".repeat(20001), "", ""), /findings are too long.*20,000/);
  assert.match(E.textProblem("", "y".repeat(20001), ""), /staff recommendations are too long/);
  assert.match(E.textProblem("", "", "r".repeat(501)), /reason is too long.*500/);
});
test("the pop-up opens read-only with an Edit button (writer only), saves through the database function with the version that was open, keeps the typed text on a failure or a clash, asks before discarding, and the list row is updated in place", () => {
  const modal = src("src/sead/components/DailyRecordDetailModal.tsx"), tab = src("src/sead/pages/ScholarCounselingTab.tsx"), api = src("src/sead/scholarCounselingApi.ts"), hist = src("src/sead/components/DailyRecordHistoryModal.tsx");
  assert.ok(modal.includes("const mine = canEditRecord(record.consultedById, meId)") && modal.includes("{mine && <button type=\"button\" onClick={startEdit}"));
  assert.ok(modal.includes("updateDailyRecord(record.id, findings, recs, reason, record.editCount)") && api.includes('rpc("counseling_update_daily_record"') && api.includes("p_expected_edit_count: expectedEditCount"));
  assert.ok(modal.includes("Your text is still in the boxes") && modal.includes("Load the latest text") && modal.includes("Discard your changes to this record?"));
  assert.ok(modal.includes("rows={8}") && modal.includes("maxLength={EDIT_TEXT_LIMIT}") && modal.includes("(optional)") && modal.includes("View history"));
  assert.ok(tab.includes("onChanged={r => { setViewing(r); setRows(list => (list ? list.map(x => (x.id === r.id ? r : x)) : list)); }}") && tab.includes("meId={meId}"));
  assert.ok(hist.includes("can only grow") && hist.includes("Before") && hist.includes("After") && api.includes('rpc("counseling_record_history"'));
});
console.log(`\n${passed} passed`);
