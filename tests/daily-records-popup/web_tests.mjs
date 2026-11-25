// tests/daily-records-popup/web_tests.mjs — Daily Records, the larger pop-up: drafts, quick phrases, layout, Ctrl+S (3 checks, short on purpose)
// Run:  node tests/daily-records-popup/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "drp-"));
const outfile = path.join(tmp, "popup.mjs");
await build({ entryPoints: [path.join(root, "src/lib/recordPopup.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error" });
const P = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

test("a draft has its own name per record, appointment form and new record of a scholar; a stored draft that does not look right is ignored; the newer of two copies wins; spaces at the ends are not a change", () => {
  assert.equal(P.draftKey.edit("r1"), "edit:r1"); assert.equal(P.draftKey.slot("s1"), "slot:s1"); assert.equal(P.draftKey.newFor(" 2021-0001 "), "new:2021-0001");
  const good = JSON.stringify({ values: { findings: "a", hardCopy: true, junk: 5 }, savedAt: "2026-11-25T02:42:00Z", base: 2 });
  assert.deepEqual(P.parseStoredDraft(good), { values: { findings: "a", hardCopy: true }, savedAt: "2026-11-25T02:42:00Z", base: 2 });
  for (const bad of [null, "", "{", "[]", JSON.stringify({ values: {}, savedAt: "not a date" }), JSON.stringify({ savedAt: "2026-11-25T02:42:00Z" })]) assert.equal(P.parseStoredDraft(bad), null);
  const a = { values: {}, savedAt: "2026-11-25T02:00:00Z", base: null }, b = { values: {}, savedAt: "2026-11-25T03:00:00Z", base: null };
  assert.equal(P.newerDraft(a, b), b); assert.equal(P.newerDraft(b, a), b); assert.equal(P.newerDraft(null, a), a); assert.equal(P.newerDraft(null, null), null);
  assert.equal(P.differsFrom({ findings: " x ", n: false }, { findings: "x", n: false }), false);
  assert.equal(P.differsFrom({ findings: "x2" }, { findings: "x" }), true);
  assert.equal(P.savedAtLabel("2026-11-25T02:42:00Z"), "10:42 AM");
});
test("a quick phrase goes where the cursor is (on a new line when there is text before it), replaces a selection, and never makes the text longer than the limit; the first line of a text is cut for the list of previous visits", () => {
  assert.deepEqual(P.insertPhrase("", 0, 0, "Advised"), { ok: true, text: "Advised", caret: 7 });
  assert.deepEqual(P.insertPhrase("Met the scholar.", 16, 16, "Advised"), { ok: true, text: "Met the scholar.\nAdvised", caret: 24 });
  assert.deepEqual(P.insertPhrase("Met.\n", 5, 5, "Advised"), { ok: true, text: "Met.\nAdvised", caret: 12 });
  assert.equal(P.insertPhrase("Met XX the scholar", 4, 6, "Advised").text, "Met\nAdvised the scholar");
  assert.equal(P.insertPhrase("x".repeat(19995), 19995, 19995, "123456").ok, false);
  assert.equal(P.insertPhrase("x".repeat(19995), 19995, 19995, "123456").text, "x".repeat(19995));
  assert.equal(P.firstLine("\n\n  First line here  \nSecond"), "First line here");
  assert.equal(P.firstLine(""), "—");
  assert.equal(P.firstLine("y".repeat(200), 20).length, 20);
});
test("the pop-up adjusts to the screen (whole screen on a phone, as wide as the window up to 1400 px and as tall as it needs on a laptop, header and footer fixed, only the middle scrolls), has two columns from 1024 px, and Add and the record window both use it with Ctrl+S, the discard question, drafts, quick phrases and 8-line growing boxes; the appointment form keeps its INC deadline and prospectus fields", () => {
  const shell = src("src/sead/components/RecordModalShell.tsx"), add = src("src/sead/components/AddDailyRecordModal.tsx"), det = src("src/sead/components/DailyRecordDetailModal.tsx");
  const box = src("src/sead/components/RecordTextArea.tsx"), api = src("src/sead/scholarCounselingApi.ts"), hook = src("src/sead/components/useRecordDraft.ts"), side = src("src/sead/components/RecordSideSummary.tsx");
  assert.ok(shell.includes("h-[100dvh] w-full max-w-[1400px]") && shell.includes("sm:max-h-[calc(100dvh-1.5rem)]") && shell.includes("min-h-0 flex-1 overflow-y-auto") && shell.includes("shrink-0"));
  assert.equal(/92%|w-\[92|h-\[92/.test(shell), false, "no fixed 92% size: it follows the screen");
  assert.ok(shell.includes("(min-width: 1024px)") && shell.includes("grid-cols-[minmax(17rem,1fr)_2fr]") && shell.includes("<details"));
  for (const [name, code] of [["Add", add], ["Detail", det]]) {
    assert.ok(code.includes("<RecordModalShell") && code.includes("<RecordColumns") && code.includes("<RecordSideSummary") && code.includes("<RecordTextArea"), `${name}: the shared pieces`);
    assert.ok(code.includes("e.key.toLowerCase() === \"s\"") && code.includes("e.ctrlKey || e.metaKey"), `${name}: Ctrl+S / Cmd+S`);
    assert.ok(code.includes("Discard changes?") && code.includes("useRecordDraft(") && code.includes("useQuickPhrases(") && code.includes("QuickPhrasesManager"), `${name}: discard question, draft, phrases`);
  }
  assert.ok(add.includes("draftKey.slot(prefill.slotId)") && add.includes("draftKey.newFor(selected.scholarIdNumber)") && det.includes("draftKey.edit(record.id)"));
  assert.ok(add.includes("INC deadline — required") && add.includes("Prospectus hard copy received") && add.includes("saveConsultationRecord({") && add.includes("needsDeadline"), "the appointment extras are unchanged");
  assert.ok(box.includes("minRows = 8") && box.includes("scrollHeight") && box.includes("Insert…") && box.includes("EDIT_TEXT_LIMIT"));
  assert.ok(hook.includes("SERVER_DELAY_MS = 3000") && hook.includes("sessionStorage") && hook.includes("pagehide") && api.includes('rpc("counseling_draft_save"') && api.includes('rpc("counseling_phrases_list")') && api.includes('rpc("counseling_record_context"'));
  assert.ok(side.includes("Previous visits") && side.includes("Show more") && side.includes("stageTitle("));
});
console.log(`\n${passed} passed`);
