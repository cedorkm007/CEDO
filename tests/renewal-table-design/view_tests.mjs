// tests/renewal-table-design/view_tests.mjs — Scholar Renewal table redesign: the wording/colours helpers (src/lib/renewalTableView.ts) and the table component (what it draws, what it calls)
// The redesign is VISUAL only: these tests also check that the data, the permissions and what each action does are still the old ones.
// Run:  node tests/renewal-table-design/view_tests.mjs     (no database or browser needed)
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rtd-"));
const outfile = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewalTableView.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const V = await import(pathToFileURL(outfile).href);
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
const table = src("src/sead/renewal/RenewalListTable.tsx"), tab = src("src/sead/renewal/RenewalListTab.tsx");
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("Name, year, status");
await test("the name is split at the first comma: surname (with the comma) on line 1, given names on line 2; no comma stays whole", () => {
  assert.deepEqual(V.splitName("Agtarap, John Paul Mandag"), { surname: "Agtarap,", given: "John Paul Mandag" });
  assert.deepEqual(V.splitName("Madonna"), { surname: "Madonna", given: "" });
});
await test("year: '1st Year' -> '1st Yr', empty -> a dash", () => {
  assert.equal(V.shortYear("1st Year"), "1st Yr"); assert.equal(V.shortYear("4th Year"), "4th Yr"); assert.equal(V.shortYear(""), "—"); assert.equal(V.shortYear(null), "—");
});
await test("status colours: Probationary amber, Reconsidered blue, Removed red, Regular and On leave gray", () => {
  assert.deepEqual(["Probationary", "Reconsidered", "Removed", "Regular", "On leave"].map(V.statusTone), ["amber", "blue", "red", "gray", "gray"]);
});

console.log("\nSDP column");
const sdp = (o, stage) => V.sdpView({ sdpApplicable: true, sdpComplied: null, sdpReconsideration: null, ...o }, stage);
await test("Complied is green, with no detail and no eye button", () => { const v = sdp({ sdpComplied: true }); assert.deepEqual([v.chip, v.detail, v.canView], [{ text: "Complied", tone: "green" }, null, false]); });
await test("complied by an approved reconsideration says so and keeps the eye button", () => { const v = sdp({ sdpComplied: true, sdpReconsideration: "approved" }); assert.equal(v.detail, "By SDP reconsideration"); assert.equal(v.canView, true); });
await test("Not complied is red; a pending request is the one detail line", () => { const v = sdp({ sdpComplied: false, sdpReconsideration: "pending" }); assert.deepEqual([v.chip, v.detail, v.canView], [{ text: "Not complied", tone: "red" }, "Reconsideration requested", true]); });
await test("a denied request says it was not approved", () => assert.equal(sdp({ sdpComplied: false, sdpReconsideration: "denied" }).detail, "Reconsideration not approved"));
await test("'SDP on hold' appears ONCE: as the amber 'On hold' chip when there is no request, never as a second badge", () => {
  assert.deepEqual(sdp({ sdpComplied: false }, "sdp_on_hold").chip, { text: "On hold", tone: "amber" });
  assert.equal(sdp({ sdpComplied: false, sdpReconsideration: "pending" }, "sdp_on_hold").chip.text, "Not complied");
});
await test("a Summer scholar is 'Not required (Summer)' gray", () => assert.deepEqual(V.sdpView({ sdpApplicable: false, sdpComplied: null, sdpReconsideration: null }).chip, { text: "Not required (Summer)", tone: "gray" }));
await test("the eye button is offered in the same cases as the old 'View SDP credits' link (not complied, or approved reconsideration; never when SDP is not required)", () => {
  for (const [o, want] of [[{ sdpComplied: false }, true], [{ sdpComplied: true }, false], [{ sdpComplied: true, sdpReconsideration: "approved" }, true], [{ sdpComplied: null }, false], [{ sdpComplied: null, sdpReconsideration: "approved" }, true]]) assert.equal(sdp(o).canView, want, JSON.stringify(o));
  assert.equal(V.sdpView({ sdpApplicable: false, sdpComplied: false, sdpReconsideration: "approved" }).canView, false);
});

console.log("\nGrades column");
const g = (o, e) => V.gradesView({ gradesState: "ready", graded: 2, total: 2, failed: 0, drp: 0, inc: 0, review: 0, ...o }, e);
await test("entered grades waiting for approval: amber 'Waiting for approval'", () => assert.deepEqual(g({}, "pending").chips[0], { text: "Waiting for approval", tone: "amber" }));
await test("failed / INC / DRP / to review keep their counts (red / amber)", () => {
  assert.deepEqual(g({ failed: 2 }).chips, [{ text: "2 failed", tone: "red" }]);
  assert.deepEqual(g({ inc: 1 }).chips, [{ text: "INC", tone: "amber" }]);
  assert.deepEqual(g({ drp: 1, review: 3 }).chips.map(c => c.text), ["1 DRP", "3 to review"]);
});
await test("no subjects: gray 'No subjects yet' and no count line; passed: green; approved entered grades: green 'Approved'", () => {
  assert.deepEqual([g({ total: 0, graded: 0, gradesState: "no_grades" }).chips[0], g({ total: 0, graded: 0, gradesState: "no_grades" }).detail], [{ text: "No subjects yet", tone: "gray" }, null]);
  assert.deepEqual(g({}).chips[0], { text: "All passed", tone: "green" });
  assert.deepEqual(g({}, "approved").chips[0], { text: "Approved", tone: "green" });
});
await test("the count the old column showed ('2 of 2 graded') is still there", () => assert.equal(g({ graded: 2, total: 2 }).detail, "2 of 2 graded"));

console.log("\nActions: two fixed slots + the rest");
const A = key => ({ key, role: "x", label: key });
await test("Decide SDP goes to slot 1, Approve grades to slot 2, every other action to the ⋮ menu (nothing is dropped)", () => {
  const s = V.actionSlots([A("decide_inc"), A("approve_grades"), A("decide_sdp"), A("review_documents")]);
  assert.equal(s.sdp.key, "decide_sdp"); assert.equal(s.grades.key, "approve_grades"); assert.deepEqual(s.rest.map(a => a.key), ["decide_inc", "review_documents"]);
  assert.deepEqual(V.actionSlots([]), { sdp: null, grades: null, rest: [] });
});
await test("slot labels are short; the full wording stays in the tooltip and the screen-reader label", () => {
  assert.deepEqual(V.SLOT_LABEL, { decide_sdp: "Decide SDP", approve_grades: "Approve grades" });
  assert.ok(table.includes("title={a.label}") && table.includes("aria-label={`${a.label} for ${p.r.name}`}"));
});

console.log("\nThe table component: visual layer only");
await test("it never changes what an action does: pressing calls onAct(a, row, facts) and the permission check is the old canDoAction(a, viewer)", () => {
  assert.ok(table.includes("p.onAct(a, p.r, f)") && table.includes("canDoAction(a, p.viewer)") && table.includes("waitingForText(a)"));
  assert.equal(/supabase|fetch[A-Z]|\.rpc\(/.test(table), false);
});
await test("a locked action stays visible (with who it waits for), not hidden", () => assert.ok(table.includes("aria-disabled=\"true\"") && table.includes("cursor-not-allowed")));
await test("the list tab still owns the data, the filters, the paging and the actions (act(), actionsOf, SdpCreditsModal, the modals)", () => {
  for (const k of ["async function act(", "const actionsOf = useCallback", "<SdpCreditsModal", "fetchRenewalList(", "<ListPagination", "fetchScholarActions("]) assert.ok(tab.includes(k), k);
  assert.ok(tab.includes("<RenewalListTable") && tab.includes("onAct={(a, row, f) => void act(a, row as RenewalListRow, f)}"));
});
await test("the 'SDP on hold' badge is gone from under the name", () => assert.ok(table.includes('r.stage === "sdp_on_hold"')));
await test("no word is cut in the middle: no break-all, no letter-level breaking in the table", () => assert.equal(/break-all|break-words|overflow-wrap:\s*anywhere|\[word-break/.test(table), false));
await test("one accent colour for links (#00709f); statuses are chips with TEXT, never colour alone", () => {
  assert.ok(table.includes("text-[#00709f]") && /function Chip\(/.test(table));
  assert.equal((table.match(/<Chip\b/g) ?? []).length >= 3, true);
});
await test("small text is at least 13px", () => assert.equal(/text-\[(1[0-2]|[0-9])(\.\d+)?px\]/.test(table), false));
await test("header: sticky, one line, small medium-weight muted; Scholar ID and Name stay fixed on the left; Actions header centred", () => {
  assert.ok(/const TH = "sticky top-0[^"]*whitespace-nowrap[^"]*text-\[13px\] font-medium text-slate-600/.test(table));
  assert.ok(table.includes("sticky left-0") && table.includes("left-[106px]") && table.includes("!text-center"));
});
await test("School and Program columns hide when narrow and show in a detail row; a phone gets cards, the primary action full width, 'N more' for the rest", () => {
  assert.ok(table.includes("hidden @min-[1350px]:table-cell") && table.includes("hidden @min-[1180px]:table-cell") && table.includes("aria-expanded={expanded}"));
  assert.ok(table.includes("@min-[760px]:hidden") && table.includes("others.length} more"));
});
await test("loading shows skeleton rows; an empty list shows the same message as before", () => assert.ok(table.includes("animate-pulse") && table.includes("t.emptyText")));
await test("the ⋮ menu is keyboard-reachable: a real button, Escape closes it, it has a label that lists the actions", () => assert.ok(table.includes('aria-haspopup="menu"') && table.includes('e.key === "Escape"') && table.includes("More actions for")));
await test("density (Comfortable / Compact) is remembered in the browser, and the page still works when the browser will not store it", () => assert.ok(tab.includes("localStorage.getItem(\"cedo.renewalTable.density\")") && tab.includes("catch { return \"comfortable\"; }")));
await test("School is hidden only when exactly one school is filtered", () => assert.ok(tab.includes("hideSchool={filters.schoolIds.length === 1}")));
await test("the Scholar List tab (which shares ActionCell / SdpCell / GradesCell) is untouched", () => assert.ok(src("src/sead/renewal/RenewalScholarListTab.tsx").includes("View SDP credits</button>")));

console.log(`\n${passed} passed`);
