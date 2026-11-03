// tests/inc-documents/web_tests.mjs — the INC documents in the application form, the clearance, and the INC deadline date in the Daily Record
// Run:  node tests/inc-documents/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "incdoc-"));
const outfile = path.join(tmp, "renewal.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewal.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const R = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The words and the rules");
test("the clearance is a kind of document with a label; the three INC documents are listed with where to get them", () => {
  assert.equal(R.DOC_LABEL.clearance, "Clearance");
  assert.deepEqual(R.INC_FORM_DOCS.map(d => d.kind), ["inc_letter", "study_plan", "clearance"]);
  assert.ok(/Guidance office or School coordinator/.test(R.INC_FORM_DOCS.find(d => d.kind === "clearance").hint));
});
test("the study plan, the INC letter and the clearance need the evaluator's approval; the prospectus does not", () => {
  assert.deepEqual([...R.DOC_NEEDS_APPROVAL].sort(), ["clearance", "inc_letter", "study_plan"]);
});
test("a missing or pending clearance blocks booking, and the scholar is told to upload it", () => {
  assert.equal(R.consultBlockedBy("clearance_missing"), "clearance"); assert.equal(R.consultBlockedBy("clearance_pending"), "clearance"); assert.equal(R.consultBlockedBy("ok"), null);
});
const ev = { grades_in_form: true, grades: { state: "ready", school_submitted: true, self_status: null, reason: "", counts: { inc: 1 }, failed_subjects: [], inc_subjects: [], review_subjects: [] }, sdp: { applicable: true, complied: true, missing: null } };
test("the Next button stays closed while any of the three documents has no file, and opens when all three have one", () => {
  const closed = R.renewalNextGate(ev, { gradesEntered: false, reconsiderationAsked: false, incDocsNeeded: true, incDocsReady: false });
  assert.equal(closed.open, false); assert.equal(closed.blocker, "documents");
  assert.equal(R.renewalNextGate(ev, { gradesEntered: false, reconsiderationAsked: false, incDocsNeeded: true, incDocsReady: true }).open, true);
});
test("without an INC the documents are not asked for", () => assert.equal(R.renewalNextGate(ev, { gradesEntered: false, reconsiderationAsked: false, incDocsNeeded: false, incDocsReady: false }).open, true));
test("the grades and the SDP are still checked first", () => {
  assert.equal(R.renewalNextGate({ ...ev, sdp: { applicable: true, complied: false, missing: "x", lacking: { community_service: 1 } } }, { gradesEntered: false, reconsiderationAsked: false, incDocsNeeded: true, incDocsReady: true }).blocker, "sdp");
});

console.log("\nThe application form");
const panel = src("src/scholar/components/dashboard/RenewalPanel.tsx"), api = src("src/scholar/renewalApi.ts");
test("a scholar with an INC (in the school's grades, or an INC mark among the grades entered) sees three separate upload buttons", () => {
  assert.ok(panel.includes("(preview.grades?.counts?.inc ?? 0) > 0 || enteredInc || serverNeedsInc") && panel.includes('reservedMark(r.grade) === "INC"'));
  assert.ok(panel.includes("INC_FORM_DOCS.map(d => (") && panel.includes("<IncDocPicker") && panel.includes("You cannot submit without them."));
  assert.ok(panel.includes("aria-label={`Upload ${label}`}"), "each document has its own upload button");
});
test("Next follows the gate with the documents; the review step lists them; they are sent with the application", () => {
  assert.ok(panel.includes("reconsiderationAsked: wantsReconsideration, incDocsNeeded, incDocsReady"));
  assert.ok(panel.includes("INC documents: <strong>") && panel.includes("incDocuments: incDocsNeeded ?"));
  assert.ok(panel.includes("You cannot go on yet: upload the INC letter, the study plan and the clearance"));
});
test("when the database finds an INC the form did not, the scholar is taken back to the documents", () => {
  assert.ok(panel.includes("/You have an INC/.test(r.error)") && panel.includes("setServerNeedsInc(true)") && panel.includes("setStep(2)"));
});
test("the documents are uploaded first under the window and removed again if the application is refused; the database call carries them", () => {
  assert.ok(api.includes("/inc-docs/${d.kind}/") && api.includes("p_inc_documents: uploadedDocs") && api.includes("const undo = async () =>"));
  assert.ok(api.includes("validateRenewalFile(f, 0)"));
});
test("the booking screen and the staff review treat the clearance like the study plan and the INC letter", () => {
  assert.ok(panel.includes("DOC_NEEDS_APPROVAL.includes(req.kind)"));
  assert.ok(src("src/sead/renewal/RenewalDetailView.tsx").includes("DOC_NEEDS_APPROVAL.includes(d.kind)"));
});

console.log("\nThe Daily Record");
const modal = src("src/sead/components/AddDailyRecordModal.tsx"), appts = src("src/sead/appointmentsApi.ts");
test("the INC deadline is a date field in the same form as the findings and recommendations (no more 'days given')", () => {
  assert.ok(modal.includes('type="date" min={dayAfterVisit} value={incDeadline}') && modal.includes("INC deadline — required"));
  assert.equal(modal.includes("Days given to comply"), false);
  assert.ok(modal.indexOf("INC deadline — required") < modal.indexOf("Findings") && modal.includes("Staff Recommendations") || modal.includes("Recommendations"));
});
test("a deadline that is not after the consultation date is refused before sending", () => assert.ok(modal.includes("incDeadline < dayAfterVisit") && modal.includes("Choose the INC deadline: a date after the consultation date.")));
test("the deadline is sent as a date; before the database update the days in between are sent instead", () => {
  assert.ok(appts.includes("p_inc_deadline: input.incDeadline") && appts.includes("p_days_given: days"));
});

console.log("\nThe database files");
test("two files and their undo files exist; no table is dropped or emptied", () => {
  for (const f of ["supabase_migration_inc_docs_a_clearance_kind.sql", "supabase_migration_inc_docs_b_functions.sql", "undo_inc_docs_a.sql", "undo_inc_docs_b.sql"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  const all = ["supabase_migration_inc_docs_a_clearance_kind.sql", "supabase_migration_inc_docs_b_functions.sql"].map(src).join("\n").replace(/--.*$/gm, "");
  assert.equal(/(drop table|delete from|truncate)/i.test(all), false);
  assert.ok(src("supabase_migration_inc_docs_a_clearance_kind.sql").includes("set lock_timeout = '5s'"));
});

console.log("\nThe file names");
test("the three INC documents are renamed 'Document - Last name, First name - ID' with the original extension", () => {
  assert.equal(R.renamedDocumentName("study_plan", "Dela Cruz", "Juan", "2024-0001", "scan 123.PDF"), "Study Plan - Dela Cruz, Juan - 2024-0001.pdf");
  assert.equal(R.renamedDocumentName("inc_letter", "Dela Cruz", "Juan", "2024-0001", "IMG_5.jpeg"), "INC Letter - Dela Cruz, Juan - 2024-0001.jpeg");
  assert.equal(R.renamedDocumentName("clearance", "Dela Cruz", "Juan", "2024-0001", "c.png"), "Clearance - Dela Cruz, Juan - 2024-0001.png");
});
test("a second file of the same kind gets (2); a missing name falls back to the ID; characters a file name cannot hold are dropped", () => {
  assert.equal(R.renamedDocumentName("clearance", "Reyes", "Ana", "T-1", "a.pdf", 2), "Clearance - Reyes, Ana - T-1 (2).pdf");
  assert.equal(R.renamedDocumentName("study_plan", "", "", "T-1", "a.pdf"), "Study Plan - T-1.pdf");
  assert.equal(R.renamedDocumentName("inc_letter", "O/Brien:", "Sean?", "T-1", "a"), "INC Letter - O Brien, Sean - T-1");
});
test("the other kinds keep the scholar's own file name", () => assert.equal(R.renamedDocumentName("prospectus", "Reyes", "Ana", "T-1", "a.pdf"), null));
test("the application form and the later upload both rename before uploading", () => {
  const api = src("src/scholar/renewalApi.ts");
  assert.ok(api.includes('renamedFile(orig, d.kind, who, args.scholarIdNumber ?? "", i + 1)') && api.includes("renamedFile(args.file, args.kind, await myNameForFiles(), args.scholarIdNumber, args.existingOfKind + 1)"));
  assert.ok(api.includes("file_name: file.name"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
