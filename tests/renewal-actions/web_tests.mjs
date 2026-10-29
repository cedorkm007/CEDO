// tests/renewal-actions/web_tests.mjs — Scholar List: the "Action needed" and "Renewal status" columns (the words, who may click, the screens)
// Run:  node tests/renewal-actions/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raw-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const X = await bundle("actions", "src/lib/renewalActions.ts");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const row = (o = {}) => ({ eligibility: [], sdpReconsideration: null, sdpApplicable: true, sdpComplied: true, sdpMissing: null, gradesState: "ready", failed: 0, drp: 0, inc: 0, review: 0, ...o });
const facts = (o = {}) => ({ recordId: null, stage: null, isLate: false, appliedAt: null, docsToReview: 0, consultationRequired: false, consultationDoneAt: null, nextConsultation: null,
  gradesStatus: "none", dhReferralId: null, dhStatus: null, referralStatus: null, ...o });
const keys = (r, f) => X.neededActions(r, f).map(a => `${a.role}:${a.label}`);

console.log("What is waiting, and for whom");
test("nothing is shown before the facts are known", () => assert.deepEqual(X.neededActions(row(), null), []));
test("entered grades waiting go to the Grades Approver", () => assert.deepEqual(keys(row(), facts({ recordId: "r", stage: "waiting_grades", gradesStatus: "pending" })), ["grades_approver:Approve the entered grades"]));
test("a pending SDP reconsideration goes to the SDP Reconsideration Approver", () => assert.deepEqual(keys(row({ sdpReconsideration: "pending", sdpComplied: false }), facts({ recordId: "r", stage: "sdp_on_hold" })), ["sdp_approver:Decide the SDP reconsideration"]));
test("a case with the Division Head goes to the Division Head", () => assert.deepEqual(keys(row(), facts({ recordId: "r", stage: "needs_consultation_division_head", dhStatus: "forwarded_to_division_head", dhReferralId: "d" })), ["division_head:Decide the case"]));
test("a case marked 'with the Division Head' but without its referral shows no button", () => assert.deepEqual(keys(row(), facts({ recordId: "r", stage: "endorsed_division_head", dhStatus: "forwarded_to_division_head", dhReferralId: null })), []));
test("a scholar who has not applied and needs a consultation can be referred by the evaluator", () => assert.deepEqual(keys(row({ eligibility: ["consultation"] }), facts()), ["evaluator:Refer for consultation"]));
test("... but not once a referral exists", () => assert.deepEqual(keys(row({ eligibility: ["consultation"] }), facts({ referralStatus: "awaiting_booking" })), []));
test("... and not when the scholar applied (the application leads to the consultation by itself)", () => assert.deepEqual(keys(row({ eligibility: ["consultation"] }), facts({ recordId: "r", stage: "needs_study_plan_consultation" })), []));
test("a scholar who has not applied and needs nothing has nothing waiting", () => assert.deepEqual(keys(row({ eligibility: ["ready"] }), facts()), []));
test("the evaluator's steps follow the stage", () => {
  const at = stage => keys(row(), facts({ recordId: "r", stage }));
  assert.deepEqual(at("late_pending"), ["evaluator:Decide the late application"]);
  for (const s of ["ready_for_confirmation", "reconsidered", "division_head_approved"]) assert.deepEqual(at(s), ["evaluator:Confirm the renewal"]);
  assert.deepEqual(at("ready_to_endorse"), ["evaluator:Endorse to the Division Head"]);
  assert.deepEqual(at("review_needed"), ["evaluator:Review the application"]);
  assert.deepEqual(at("inc_deadline_passed"), ["evaluator:Decide on the INC"]);
  assert.deepEqual(at("needs_consultation_division_head"), ["evaluator:Send to the Division Head"]);
  for (const s of ["renewed", "removed", "returned", "waiting_grades", "sdp_on_hold", "endorsed_division_head", "inc_waiting_compliance", "late_declined", "not_required"]) assert.deepEqual(at(s), [], s);
});
test("documents waiting for review are an action of the evaluator", () => {
  assert.deepEqual(keys(row(), facts({ recordId: "r", stage: "needs_study_plan_consultation", docsToReview: 1 })), ["evaluator:Review 1 document"]);
  assert.deepEqual(keys(row(), facts({ recordId: "r", stage: "needs_study_plan_consultation", docsToReview: 3 })), ["evaluator:Review 3 documents"]);
});
test("a scholar can have several things waiting, each for its own staff, grades first", () => {
  const k = keys(row({ sdpReconsideration: "pending", sdpComplied: false }), facts({ recordId: "r", stage: "waiting_grades", gradesStatus: "pending", docsToReview: 2 }));
  assert.deepEqual(k, ["grades_approver:Approve the entered grades", "sdp_approver:Decide the SDP reconsideration", "evaluator:Review 2 documents"]);
});
test("returned grades wait for the scholar, not for staff", () => assert.deepEqual(keys(row(), facts({ recordId: "r", stage: "waiting_grades", gradesStatus: "returned" })), []));

console.log("Only the staff assigned can click");
const none = X.NO_ROLES;
const A = { key: "approve_grades", role: "grades_approver", label: "x" }, S = { key: "decide_sdp", role: "sdp_approver", label: "x" }, D = { key: "decide_case", role: "division_head", label: "x" }, E = { key: "open_application", role: "evaluator", label: "x" };
test("nobody can click without a role", () => { for (const a of [A, S, D, E]) assert.equal(X.canDoAction(a, none), false); });
test("each role can click only its own actions", () => {
  const v = o => ({ ...none, ...o });
  assert.deepEqual([A, S, D, E].map(a => X.canDoAction(a, v({ gradesApprover: true }))), [true, false, false, false]);
  assert.deepEqual([A, S, D, E].map(a => X.canDoAction(a, v({ sdpApprover: true }))), [false, true, false, false]);
  assert.deepEqual([A, S, D, E].map(a => X.canDoAction(a, v({ divisionHead: true }))), [false, false, true, false]);
  assert.deepEqual([A, S, D, E].map(a => X.canDoAction(a, v({ evaluator: true }))), [false, false, false, true]);
});
test("an account with two roles can click both", () => assert.deepEqual([A, E, S].map(a => X.canDoAction(a, { ...none, evaluator: true, gradesApprover: true })), [true, true, false]));
test("those who cannot click are told who it is waiting for", () => {
  assert.equal(X.waitingForText(A), "Waiting for the Grades Approver");
  assert.equal(X.waitingForText(S), "Waiting for the SDP Reconsideration Approver");
  assert.equal(X.waitingForText(D), "Waiting for the Division Head");
  assert.equal(X.waitingForText(E), "Waiting for the Scholar Renewal Evaluator");
});

console.log("The Renewal status summary");
test("a scholar who has not applied", () => {
  const s = X.renewalSummary(row({ eligibility: ["ready"] }), facts());
  assert.equal(s.headline, "Has not applied yet");
  assert.equal(s.details[0], "SDP complied");
  assert.equal(s.tone, "plain");
});
test("an application says how far it is", () => {
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "ready_for_confirmation" })).headline, "Applied: Ready to confirm");
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "renewed" })).headline, "Renewed");
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "removed" })).headline, "Removed");
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "ready_for_confirmation", isLate: true })).headline, "Applied: Ready to confirm (late)");
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "late_pending", isLate: true })).headline, "Applied: Late — needs acceptance");
});
test("the tone follows the stage", () => {
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "renewed" })).tone, "good");
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "removed" })).tone, "bad");
  assert.equal(X.renewalSummary(row(), facts({ recordId: "r", stage: "waiting_grades" })).tone, "warn");
  assert.equal(X.renewalSummary(row(), facts()).tone, "plain");
});
test("the SDP part", () => {
  const sdp = (r, f = facts()) => X.renewalSummary(row(r), f).details[0];
  assert.equal(sdp({}), "SDP complied");
  assert.equal(sdp({ sdpComplied: false, sdpMissing: "x" }), "SDP not complied");
  assert.equal(sdp({ sdpComplied: false, sdpReconsideration: "pending" }), "SDP reconsideration requested");
  assert.equal(sdp({ sdpComplied: true, sdpReconsideration: "approved" }), "SDP complied by reconsideration");
  assert.equal(sdp({ sdpComplied: false, sdpReconsideration: "denied" }), "SDP reconsideration not approved");
  assert.equal(sdp({ sdpComplied: null }), "SDP not checked");
  assert.ok(!X.renewalSummary(row({ sdpApplicable: false }), facts()).details.some(d => /^SDP/.test(d)), "no SDP line for a term with no SDP requirement");
});
test("the grades part", () => {
  const g = (r, f) => X.renewalSummary(row(r), facts(f)).details.find(d => /rades/.test(d));
  assert.equal(g({}, { gradesStatus: "school" }), "Grades uploaded by the school: All passed");
  assert.equal(g({ failed: 2, inc: 1 }, { gradesStatus: "school" }), "Grades uploaded by the school: 2 failed · 1 INC");
  assert.equal(g({}, { gradesStatus: "approved" }), "Entered grades approved: All passed");
  assert.equal(g({ gradesState: "waiting" }, { gradesStatus: "pending" }), "Entered grades waiting for approval");
  assert.equal(g({ gradesState: "waiting" }, { gradesStatus: "returned" }), "Entered grades returned to the scholar");
  assert.equal(g({ gradesState: "waiting" }, { gradesStatus: "none" }), "Grades not in yet");
  assert.equal(g({ gradesState: "review" }, { gradesStatus: "none" }), "Grades need review");
});
test("the consultation part", () => {
  const c = (f, r = {}) => X.renewalSummary(row(r), facts(f)).details.slice(2);
  assert.deepEqual(c({}), []);
  assert.deepEqual(c({ referralStatus: "awaiting_booking" }), ["Referred: waiting for the scholar to book"]);
  assert.deepEqual(c({ recordId: "r", stage: "needs_study_plan_consultation", consultationRequired: true }), ["Consultation not booked yet"]);
  assert.deepEqual(c({ recordId: "r", stage: "needs_study_plan_consultation", consultationRequired: true, consultationDoneAt: "2026-10-20T01:00:00Z" }), ["Consultation done"]);
  assert.deepEqual(c({}, { eligibility: ["consultation"] }), ["Needs a consultation referral"]);
  assert.match(c({ recordId: "r", stage: "needs_study_plan_consultation", consultationRequired: true, nextConsultation: "2026-11-03T01:00:00Z" })[0], /^Consultation Nov 3, /);
});
test("without the facts the summary shows a dash and never breaks", () => assert.equal(X.renewalSummary(row(), null).headline, "—"));

console.log("The screens");
const tab = src("src/sead/renewal/RenewalScholarListTab.tsx"), page = src("src/sead/ScholarRenewalPage.tsx"), api = src("src/sead/renewalScholarListApi.ts");
test("the table has the two new columns; the scholar's ID, status, school, program and year level share the first cell", () => {
  for (const h of ["Scholar", "SDP status", "Grades", "Renewal eligibility", "Renewal status", "Action needed"]) assert.ok(tab.includes(`"${h}"`), h);
});
test("the narrow-screen cards show both columns too", () => assert.ok(tab.includes(`<dt className="text-slate-600">Renewal status</dt>`) && tab.includes(`<dt className="text-slate-600">Action needed</dt>`)));
test("the Action needed cell lets only the assigned staff click, and tells the others who it waits for", () => {
  assert.ok(/canDoAction\(a, viewer\)\s*\?/.test(tab));
  assert.ok(tab.includes("waitingForText(a)"));
});
test("each button opens its own screen: entered grades, SDP reconsideration, the Division Head's case, the referral form, the application", () => {
  assert.ok(/only=\{\{ scholarIdNumber: acting\.row\.scholarIdNumber/.test(tab) && tab.includes("<RenewalEnteredGradesTab") && tab.includes("<RenewalSdpReconsiderationTab"));
  assert.ok(tab.includes('<ReferralFormPanel mode="approve" referralId={acting.facts.dhReferralId}'));
  assert.ok(tab.includes('<ReferralFormModal mode="create" scholar={referring}'));
  assert.ok(tab.includes('a.key === "open_application"') && tab.includes("onOpenRecord(f.recordId)"));
});
test("the facts are asked for the scholars of the page, and a missing database update is explained", () => {
  assert.ok(tab.includes("fetchScholarActions(schoolYear, term, l.rows.map(x => x.scholarIdNumber))"));
  assert.ok(tab.includes("supabase_migration_renewal_actions_needed.sql"));
  assert.ok(api.includes('rpc("renewal_scholar_actions"') && api.includes("isMissing") );
});
test("only the evaluator refreshes the check", () => {
  assert.ok(tab.includes("{viewer.evaluator && <button onClick={() => void refresh()}"));
  assert.ok(tab.includes("viewer.evaluator && options && options.scholars > 0 && options.checked === 0"));
});
test("the approval screens have a one-scholar mode with no filters that closes after the decision", () => {
  for (const f of ["src/sead/renewal/RenewalEnteredGradesTab.tsx", "src/sead/renewal/RenewalSdpReconsiderationTab.tsx"]) {
    const t = src(f);
    assert.ok(t.includes("only?: { scholarIdNumber: string; onDone: () => void }"), f);
    assert.ok(t.includes("useState(only?.scholarIdNumber ?? \"\")"), f);
    assert.ok((t.match(/\{!only && /g) ?? []).length >= 3, f);
    assert.ok(t.includes("only?.onDone()"), f);
  }
});
test("the Scholar List tab is shown to the evaluator, the Division Head and the two approvers, and they get the windows", () => {
  assert.ok(page.includes("const seesList = isEvaluator || isDivisionHead || isSdpApprover || isGradesApprover"));
  assert.ok(page.includes('t.key === "scholarList" ? seesList'));
  assert.ok(page.includes("if (!seesRenewals && !seesList) return;"));
  assert.ok(page.includes("viewer={viewer} onOpenRecord={setDetailId} onChanged={bump}"));
});
test("the application opens only for the evaluator (the detail page keeps its own check)", () => assert.ok(page.includes("canAct={canAct && isEvaluator}")));

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
