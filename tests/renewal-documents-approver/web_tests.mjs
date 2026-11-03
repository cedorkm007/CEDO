// tests/renewal-documents-approver/web_tests.mjs — the Renewal Documents Approver tag, the Documents tab and who sees which buttons
// Run:  node tests/renewal-documents-approver/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docapp-"));
const bundle = async (entry, name) => {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
};
const Access = await bundle("src/lib/renewalAccess.ts", "access.mjs");
const Actions = await bundle("src/lib/renewalActions.ts", "actions.mjs");
const Tags = await bundle("src/app/staffToolTags.ts", "tags.mjs");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };
const user = (tags = [], over = {}) => ({ tags, role: "staff", division: "SEAD", username: "someone", ...over });

console.log("The tag");
test("it.admin1 can give the Renewal Documents Approver tag from the Staff Accounts page (it is in the list of tags, once)", () => {
  const t = Tags.STAFF_TOOL_TAGS.filter(x => x.key === "renewal_documents_approver");
  assert.equal(t.length, 1); assert.equal(t[0].label, "Renewal Documents Approver");
  assert.ok(/study plan/i.test(t[0].description) && /INC letter/i.test(t[0].description) && /clearance/i.test(t[0].description) && /at least one account/i.test(t[0].description));
  assert.equal(new Set(Tags.STAFF_TOOL_TAGS.map(x => x.key)).size, Tags.STAFF_TOOL_TAGS.length);
});

console.log("\nWho can approve and who can see the tool");
test("only the tag approves; the evaluator, the IT admin and the heads do not", () => {
  assert.equal(Access.canApproveRenewalDocuments(user(["renewal_documents_approver"])), true);
  for (const u of [user(["scholar_renewal_evaluator"]), user([], { username: "it.admin1" }), user(["sead_division_head"]), user(["scholar_grades_approver"]), user([], { role: "super_admin" })]) assert.equal(Access.canApproveRenewalDocuments(u), false);
});
test("an account with only the tag opens Scholar Renewal; an account with no tag does not", () => {
  assert.equal(Access.canSeeScholarRenewal(user(["renewal_documents_approver"])), true); assert.equal(Access.canSeeScholarRenewal(user([])), false);
});
test("the page is given the approver's flag from the user's tags", () => {
  const app = src("src/app/App.tsx");
  assert.ok(app.includes("canApproveRenewalDocuments") && app.includes("isDocumentsApprover={canApproveRenewalDocuments(currentUser)}"));
});

console.log("\nThe 'Review N documents' action");
const row = { eligibility: [], sdpReconsideration: null, sdpApplicable: true, sdpComplied: true, sdpMissing: null, gradesState: "ready", failed: 0, drp: 0, inc: 1, review: 0 };
const facts = (over = {}) => ({ recordId: "r1", stage: "needs_inc_letter_consultation", isLate: false, appliedAt: null, docsToReview: 2, consultationRequired: false, consultationDoneAt: null, nextConsultation: null, gradesStatus: "school", dhReferralId: null, dhStatus: null, referralStatus: null, ...over });
test("the action belongs to the Renewal Documents Approver and opens the Documents tab, not the application", () => {
  const a = Actions.neededActions(row, facts()).find(x => /Review 2 documents/.test(x.label));
  assert.ok(a); assert.equal(a.role, "documents_approver"); assert.equal(a.key, "review_documents");
  assert.equal(Actions.STAFF_ROLE_LABEL.documents_approver, "Renewal Documents Approver");
});
test("only the approver can press it; the evaluator sees who it is waiting for", () => {
  const a = Actions.neededActions(row, facts())[0];
  const evaluator = { ...Actions.NO_ROLES, evaluator: true }, approver = { ...Actions.NO_ROLES, documentsApprover: true };
  assert.equal(Actions.canDoAction(a, approver), true); assert.equal(Actions.canDoAction(a, evaluator), false);
  assert.equal(Actions.waitingForText(a), "Waiting for the Renewal Documents Approver");
});
test("a single document reads 'Review 1 document'", () => assert.ok(Actions.neededActions(row, facts({ docsToReview: 1 })).some(a => a.label === "Review 1 document")));

console.log("\nThe screens");
const page = src("src/sead/ScholarRenewalPage.tsx"), tab = src("src/sead/renewal/RenewalDocumentsTab.tsx"), detail = src("src/sead/renewal/RenewalDetailView.tsx"), list = src("src/sead/renewal/RenewalListTab.tsx"), api = src("src/sead/renewalDocumentsApi.ts");
test("a Documents tab is shown to the evaluator (to read) and to the approver, and opens first for an account that only has the tag", () => {
  assert.ok(page.includes('t.key === "documents" ? (isEvaluator || isDocumentsApprover)') && page.includes('{ key: "documents", label: "Documents"') && page.includes('isDocumentsApprover ? "documents" : "certificate"'));
  assert.ok(page.includes('<RenewalDocumentsTab canApprove={isDocumentsApprover}'));
});
test("the approver also sees the lists, and 'Review documents' takes them to the Documents tab", () => {
  assert.ok(page.includes("isGradesApprover || isDocumentsApprover;") && page.includes('onGoToDocuments={() => setTab("documents")}') && list.includes('a.key === "review_documents"'));
});
test("the Documents tab: filters To approve / Returned / Approved / All with numbers, a search, the file opens from the list, Approve and Return only for the approver", () => {
  for (const s of ['label: "To approve"', 'label: "Returned"', 'label: "Approved"', 'label: "All"', 'aria-label="Search scholars"', "getStaffRenewalDocumentUrl(d.storagePath)", "canApprove ? (", "Waiting for the Renewal Documents Approver"]) assert.ok(tab.includes(s), s);
  assert.ok(tab.includes("reviewDocument(reviewing.doc.id, reviewing.approve, c)") && tab.includes("required={!reviewing.approve} minLength={5}"));
});
test("the list is read with the three read functions only; before the database update the tab says so", () => {
  assert.deepEqual([...api.matchAll(/rpc\("([a-z_]+)"/g)].map(m => m[1]).sort(), ["renewal_documents_counts", "renewal_documents_queue"]);
  assert.ok(tab.includes("The Documents tab needs the latest database update"));
});
test("the application page: Approve / Return buttons only for the approver; the evaluator is told who approves", () => {
  assert.ok(detail.includes('canReviewDocuments && d.status === "submitted"') && detail.includes("Waiting for the Renewal Documents Approver") && page.includes("canReviewDocuments={isDocumentsApprover}"));
  assert.equal(detail.includes('canAct && d.status === "submitted"'), false);
});
test("readable text in the new tab: nothing under 13px, no pale grey words", () => {
  assert.equal(/text-\[(?:9|10|11|12)(?:\.\d+)?px\]/.test(tab), false); assert.equal(/text-slate-(?:300|400|500)\b/.test(tab), false);
});

console.log("\nThe database files");
test("the file and its undo exist; no table is changed", () => {
  assert.ok(fs.existsSync(path.join(root, "supabase_migration_renewal_documents_approver.sql")) && fs.existsSync(path.join(root, "undo_renewal_documents_approver.sql")));
  const sql = src("supabase_migration_renewal_documents_approver.sql").replace(/--.*$/gm, "");
  assert.equal(/(alter table|drop table|delete from|truncate|create table|insert into)/i.test(sql), false);
  assert.ok(src("supabase_migration_renewal_documents_approver.sql").includes("until at least one account has the tag, NOBODY can approve") || /IMPORTANT: until at least one account has the tag/.test(src("supabase_migration_renewal_documents_approver.sql")));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
