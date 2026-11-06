// tests/renewal-draft/draft_tests.mjs — the scholar's renewal application and grade entry are saved on the device as they go (auto-save), so nothing is lost.
// Run:  node tests/renewal-draft/draft_tests.mjs        No database or browser needed (the real browser storage is checked on the screen in the local demo).
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { File } from "node:buffer";
globalThis.File ??= File;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "draft-"));
const outfile = path.join(tmp, "draft.mjs");
await build({ entryPoints: [path.join(root, "src/scholar/renewalDraft.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
const D = await import(pathToFileURL(outfile).href);
const src = f => fs.readFileSync(path.join(root, f), "utf8").split("\r\n").join("\n");
const panel = src("src/scholar/components/dashboard/RenewalPanel.tsx"), section = src("src/scholar/components/dashboard/SelfGradesSection.tsx"), store = src("src/lib/formDraft.ts");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const KINDS = ["inc_letter", "study_plan", "clearance"];
const png = () => new File([new Uint8Array([1, 2, 3])], "grades.png", { type: "image/png" });
const defaults = { school: "TEST School", program: "BS Test", yearLevel: "2nd Year" };
const blank = () => ({ step: 1, school: defaults.school, program: defaults.program, yearLevel: defaults.yearLevel, note: "", askReconsideration: false, gRows: [{ code: "", subject: "", units: "", grade: "" }], gFiles: [], gAck: false, incFiles: { inc_letter: [], study_plan: [], clearance: [] } });

console.log("What counts as something worth saving");
test("a form that was only opened has nothing to save", () => assert.equal(D.applyDraftHasContent(blank(), defaults), false));
test("a typed subject, a picked picture, a note, a changed school, the tick or the reconsideration choice each count", () => {
  const withRow = { ...blank(), gRows: [{ code: "", subject: "Math", units: "", grade: "" }] };
  assert.ok(D.applyDraftHasContent(withRow, defaults));
  assert.ok(D.applyDraftHasContent({ ...blank(), gFiles: [png()] }, defaults));
  assert.ok(D.applyDraftHasContent({ ...blank(), note: "hello" }, defaults));
  assert.ok(D.applyDraftHasContent({ ...blank(), school: "Other School" }, defaults));
  assert.ok(D.applyDraftHasContent({ ...blank(), gAck: true }, defaults));
  assert.ok(D.applyDraftHasContent({ ...blank(), askReconsideration: true }, defaults));
  assert.ok(D.applyDraftHasContent({ ...blank(), incFiles: { inc_letter: [png()], study_plan: [], clearance: [] } }, defaults));
});
test("grade entry after applying: the same rule", () => {
  assert.equal(D.selfGradesDraftHasContent({ rows: [{ code: "", subject: "", units: "", grade: "" }], keep: [], newFiles: [], ack: false }), false);
  assert.ok(D.selfGradesDraftHasContent({ rows: [{ code: "M1", subject: "", units: "", grade: "" }], keep: [], newFiles: [], ack: false }));
});

console.log("\nReading a draft back");
test("the typed grades and the picked pictures come back as they were", () => {
  const saved = { ...blank(), step: 2, gRows: [{ code: "MATH1", subject: "Algebra", units: "3", grade: "1.5" }, { code: "ENG1", subject: "English", units: "3", grade: "INC" }], gFiles: [png()], gAck: true, note: "my note" };
  const d = D.sanitizeApplyDraft(saved, KINDS);
  assert.deepEqual(d.gRows, saved.gRows); assert.equal(d.gFiles.length, 1); assert.equal(d.gFiles[0].name, "grades.png"); assert.equal(d.gAck, true); assert.equal(d.note, "my note");
});
test("a draft that was on the last step reopens on the second step, where what the system has is loaded again (it can never be sent without that)", () => {
  assert.equal(D.sanitizeApplyDraft({ ...blank(), step: 3 }, KINDS).step, 2);
  assert.equal(D.sanitizeApplyDraft({ ...blank(), step: 1 }, KINDS).step, 1);
});
test("damaged or foreign data is refused or repaired, never trusted", () => {
  assert.equal(D.sanitizeApplyDraft(null, KINDS), null); assert.equal(D.sanitizeApplyDraft("x", KINDS), null);
  const d = D.sanitizeApplyDraft({ step: 2, gRows: "nope", gFiles: ["not a file", 5], incFiles: { inc_letter: [{}] }, note: 7 }, KINDS);
  assert.equal(d.gRows.length, 1); assert.equal(d.gFiles.length, 0); assert.deepEqual(d.incFiles, { inc_letter: [], study_plan: [], clearance: [] }); assert.equal(d.note, "");
});
test("no more subjects, pictures or letters than the form allows", () => {
  const many = Array.from({ length: 80 }, () => ({ code: "A", subject: "B", units: "3", grade: "1.0" }));
  const d = D.sanitizeApplyDraft({ ...blank(), gRows: many, gFiles: Array.from({ length: 12 }, png), note: "x".repeat(5000) }, KINDS);
  assert.ok(d.gRows.length <= 25 && d.gFiles.length <= 5 && d.note.length === 1000);
});
test("the grade-entry draft keeps the list of pictures already sent, and drops anything that is not a name and a path", () => {
  const d = D.sanitizeSelfGradesDraft({ rows: [{ code: "M", subject: "S", units: "3", grade: "2" }], keep: [{ name: "a.png", path: "x/a.png" }, { name: 3 }, null], newFiles: [png()], ack: true });
  assert.deepEqual(d.keep, [{ name: "a.png", path: "x/a.png" }]); assert.equal(d.newFiles.length, 1); assert.equal(d.ack, true);
});
test("each scholar and each window (or application) has its own draft", () => {
  assert.notEqual(D.applyDraftKey("TEST-0001", "w1"), D.applyDraftKey("TEST-0002", "w1"));
  assert.notEqual(D.applyDraftKey("TEST-0001", "w1"), D.applyDraftKey("TEST-0001", "w2"));
  assert.notEqual(D.selfGradesDraftKey("TEST-0001", "r1"), D.applyDraftKey("TEST-0001", "r1"));
});

console.log("\nThe application form");
test("the application is saved as the scholar goes, and brought back when it opens", () => {
  assert.ok(panel.includes("useDraftAutosave<ApplyDraft>(draftKey, snapshot)") && panel.includes("loadDraft<unknown>(key)") && panel.includes("We brought back what you had already typed"));
});
test("everything typed or picked is in the draft: details, note, grades, screenshots, the tick, the reconsideration choice, the INC documents", () => {
  assert.ok(/\{ step, school, program, yearLevel, note, askReconsideration, gRows, gFiles, gAck, incFiles \}/.test(panel));
});
test("a sent application removes its draft; a refused one keeps everything", () => {
  const submit = panel.slice(panel.indexOf("async function submit()"), panel.indexOf("async function startOver()"));
  assert.ok(submit.indexOf("if (!r.ok)") > 0 && submit.indexOf("await draft.discard()") > submit.indexOf("if (!r.ok)"));
});
test("Cancel keeps the draft; 'Start over' asks first and removes it", () => {
  assert.ok(/onClick=\{onCancel\}/.test(panel) && !/discard\(\)[^]{0,80}onCancel/.test(panel));
  assert.ok(panel.includes("window.confirm(\"Start over?") && panel.includes("await draft.discard();\n    onStartOver();"));
});
test("a scholar who left in the middle finds the form open again (only for a window they can still apply to, and not once an application exists)", () => {
  assert.ok(panel.includes('const canResume = !record && data.state !== "upcoming" && data.state !== "closed";') && /if \(!off && d && applyDraftHasContent\([^]*?setApplying\(true\)/.test(panel));
  assert.ok(panel.includes('{hasContent ? "Close for now (your draft is kept)" : "Cancel"}'));
});
test("a saved draft is shown to the scholar: a line says it is saved on this device and when", () => {
  assert.ok(panel.includes('data-testid="draft-status"') && panel.includes("savedAtText(draft.savedAt)"));
});

console.log("\nEntering grades after applying (correct and send again)");
test("the same auto-save is used, a draft comes back, Cancel keeps it, sending removes it", () => {
  assert.ok(section.includes("useDraftAutosave<SelfGradesDraft>(draftKey, snapshot)") && section.includes("applyDraft(d, r.savedAt)"));
  assert.ok(section.includes("async function cancelEditing() { await draft.saveNow(); setEditing(false); }"));
  assert.ok(section.indexOf("await draft.discard();      // sent") > section.indexOf("if (!r.ok) { setError(r.error); return; }"));
});
test("a draft is dropped when grades can no longer be entered (the school uploaded, or they were approved)", () => {
  assert.ok(section.includes("if (!canEnterNow) { await draft.discard(); return; }") && /canEnterNow = [^;]*school_submitted/.test(section) && /canEnterNow = [^;]*"approved"/.test(section));
});

console.log("\nThe storage");
test("it uses the browser's IndexedDB (it can hold pictures), never sends anything, and every call is guarded so the form still works when storage is refused", () => {
  assert.ok(store.includes("indexedDB.open") && !/fetch\(|supabase|XMLHttpRequest/.test(store));
  assert.ok((store.match(/catch/g) ?? []).length >= 3);
});
test("it saves a moment after the last change, at once when the page is hidden or closed, and keeps a draft for 30 days", () => {
  assert.ok(store.includes('"visibilitychange"') && store.includes('"pagehide"') && /DRAFT_MAX_AGE_MS = 30 \* 24/.test(store));
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
