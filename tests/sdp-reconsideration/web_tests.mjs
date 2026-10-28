// tests/sdp-reconsideration/web_tests.mjs — the website side of SDP reconsideration (helpers, who sees what, the application form, the approvers' tab)
// Run:  node tests/sdp-reconsideration/web_tests.mjs
// No database or browser needed.
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdprc-"));
async function bundle(name, rel) {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(root, rel)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", alias: { "@": path.join(root, "src") } });
  return import(pathToFileURL(outfile).href);
}
const R = await bundle("renewal", "src/lib/renewal.ts");
const A = await bundle("access", "src/lib/renewalAccess.ts");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("The words the scholar and the approver read");
test("what is lacking, in total and in words (singular and plural, only the categories that lack something)", () => {
  assert.equal(R.sdpLackingTotal({ community_service: 2, community_volunteerism: 0, formation_program: 1 }), 3);
  assert.equal(R.sdpLackingTotal(null), 0);
  assert.equal(R.sdpLackingText({ community_service: 2, community_volunteerism: 0, formation_program: 1 }), "Institutional Volunteerism: 2 more credits; Formation Program: 1 more credit");
  assert.equal(R.sdpLackingText({}), "nothing");
});
test("the implication tells a scholar what approval means: complied for the semester checked, the lacking credits added to the next one", () => {
  const s = R.sdpReconsiderationImplication({ basis_school_year: "2026-2027", basis_term: "1st Semester", sdp: { applicable: true, complied: false, missing: "x", lacking: { formation_program: 2 }, next_school_year: "2026-2027", next_semester: "2nd Semester" } });
  assert.match(s, /treated as complied with the SDP for 1st Semester 2026-2027/);
  assert.match(s, /Formation Program: 2 more credits/);
  assert.match(s, /added to your SDP requirement for 2nd Semester 2026-2027/);
});
test("the status words: waiting, approved, not approved, not needed", () => {
  assert.deepEqual(R.sdpReconsiderationStatusText("pending"), { text: "Waiting for a decision", tone: "warn" });
  assert.deepEqual(R.sdpReconsiderationStatusText("approved"), { text: "Approved", tone: "good" });
  assert.deepEqual(R.sdpReconsiderationStatusText("denied"), { text: "Not approved", tone: "bad" });
  assert.equal(R.sdpReconsiderationStatusText("not_needed").tone, "plain");
});

console.log("\nWho sees what");
test("it.admin1 and an account with the tag can decide; the evaluator, the Division Head and others cannot", () => {
  const u = (tags, extra = {}) => ({ tags, role: "staff", division: "SEAD", username: "x", ...extra });
  assert.equal(A.canDecideSdpReconsideration(u([], { username: "it.admin1" })), true);
  assert.equal(A.canDecideSdpReconsideration(u(["sdp_reconsideration_approver"])), true);
  assert.equal(A.canDecideSdpReconsideration(u(["scholar_renewal_evaluator"])), false);
  assert.equal(A.canDecideSdpReconsideration(u(["sead_division_head"])), false);
  assert.equal(A.canDecideSdpReconsideration(u([])), false);
});
test("an appointed approver can open Scholar Renewal even with no other renewal tag", () => {
  assert.equal(A.canSeeScholarRenewal({ tags: ["sdp_reconsideration_approver"], role: "staff", division: "OTHER", username: "x" }), true);
  assert.equal(A.canSeeScholarRenewal({ tags: [], role: "staff", division: "OTHER", username: "x" }), false);
});
test("it.admin1 gives the tag from the Staff Accounts page (it is in the list of tool tags)", () => {
  const tags = src("src/app/staffToolTags.ts");
  assert.match(tags, /key: "sdp_reconsideration_approver"/);
  assert.match(tags, /label: "SDP Reconsideration Approver"/);
});

console.log("\nThe screens");
test("the application form shows the lacking credits and the implication, and asks the scholar to tick the choice; the choice is only sent when it was offered and ticked", () => {
  const p = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.match(p, /Your SDP is not complete/);
  assert.match(p, /sdpReconsiderationImplication\(preview\)/);
  assert.match(p, /canAskReconsideration && askReconsideration/);
  assert.match(p, /requestSdpReconsideration: canAskReconsideration && askReconsideration/);
  const api = src("src/scholar/renewalApi.ts");
  assert.match(api, /p_request_sdp_reconsideration: true/);
  assert.ok(api.indexOf("requestSdpReconsideration ? await") > 0, "the older call is used when no request is made");
});
test("the scholar's renewal tile shows waiting / approved / not approved, with the reason and the next-semester effect", () => {
  const p = src("src/scholar/components/dashboard/RenewalPanel.tsx");
  assert.match(p, /SDP reconsideration: waiting for a decision/);
  assert.match(p, /SDP reconsideration approved/);
  assert.match(p, /SDP reconsideration was not approved/);
  assert.match(p, /Complied through your approved SDP reconsideration/);
});
test("the scholar's SDP tab asks for 3 plus what is owed, and says why", () => {
  const p = src("src/scholar/components/dashboard/SDPPanel.tsx");
  assert.match(p, /fetchScholarSDPRequirements/);
  assert.match(p, /\{count\}\/\{need\}/);
  assert.match(p, /credit that was lacking last semester/);
});
test("the Scholar Renewal page has an SDP Reconsideration tab for the evaluator (read-only) and the approvers, and an approver-only account opens on it", () => {
  const page = src("src/sead/ScholarRenewalPage.tsx");
  assert.match(page, /key: "sdpReconsideration", label: "SDP Reconsideration"/);
  assert.match(page, /t\.key === "sdpReconsideration" \? \(isEvaluator \|\| isSdpApprover\)/);
  assert.match(page, /isSdpApprover \? "sdpReconsideration" : "certificate"/);
  assert.match(page, /<RenewalSdpReconsiderationTab refreshKey=\{refreshKey\} onChanged=\{bump\} \/>/);
  assert.match(src("src/app/App.tsx"), /isSdpApprover=\{canDecideSdpReconsideration\(currentUser\)\}/);
});
test("the approvers' tab has approve and deny (a denial needs a reason), the credits view, the history of earlier requests, and shows the buttons only to those who may decide", () => {
  const tab = src("src/sead/renewal/RenewalSdpReconsiderationTab.tsx");
  assert.match(tab, /required=\{!deciding\.approve\}/, "a reason is required only for a denial");
  assert.match(tab, /\{r\.canDecide && \(/);
  assert.match(tab, /View SDP credits/);
  assert.match(tab, /Earlier requests/);
  assert.match(tab, /added to their SDP requirement for/);
  assert.equal(/text-slate-[45]00/.test(tab) || /text-slate-[45]00/.test(src("src/sead/sdpReconsiderationApi.ts")), false, "no faint text");
  const api = src("src/sead/sdpReconsiderationApi.ts");
  for (const fn of ["sdp_reconsideration_list", "sdp_reconsideration_counts", "renewal_sdp_reconsideration_decide"]) assert.ok(api.includes(`rpc("${fn}"`), fn);
  assert.match(api, /PGRST202/);
});
test("the evaluator's application page, the Scholar List and SDP Monitoring show the reconsideration / the extra credits owed", () => {
  assert.match(src("src/sead/renewal/RenewalDetailView.tsx"), /SDP reconsideration: \{sdpReconsiderationStatusText/);
  const list = src("src/sead/renewal/RenewalScholarListTab.tsx");
  assert.match(list, /Reconsideration requested/); assert.match(list, /by SDP reconsideration/); assert.match(list, /Reconsideration not approved/);
  const mon = src("src/sead/pages/SDPMonitoringTab.tsx");
  assert.match(mon, /const goal = SDP_CATEGORY_CREDIT_GOAL \+ owed/);
  assert.match(mon, /owed=\{owed\.get\(s\.scholarIdNumber\)\?\.communityService\}/);
  assert.match(src("src/sead/sdpMonitorApi.ts"), /scholars_sdp_extra_required/);
});

console.log("\nThe database files");
test("four files and their undo files exist; file A changes no existing table; none deletes anything; the three tables / functions that matter are there", () => {
  const files = ["a_tables", "b_sdp_rules", "c_renewal", "d_lists"].map(n => src(`supabase_migration_sdp_reconsideration_${n}.sql`));
  const all = files.map(f => f.replace(/--.*$/gm, "")).join("\n");
  assert.equal(/alter table public\.(?!sdp_reconsideration_)/i.test(all), false);
  assert.equal(/\b(delete from|truncate|drop table)\b/i.test(all), false);
  for (const n of ["a", "b", "c", "d"]) assert.ok(fs.existsSync(path.join(root, `undo_sdp_reconsideration_${n}.sql`)), `undo ${n}`);
  assert.match(all, /create table if not exists public\.sdp_reconsideration_requests/);
  assert.match(all, /create table if not exists public\.sdp_reconsideration_debts/);
  assert.match(all, /function public\.renewal_sdp_reconsideration_decide/);
  assert.match(all, /function public\.can_decide_sdp_reconsideration/);
});

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "All " + passed + " tests passed"}`);
