// tests/scholar-sdp-load/web_tests.mjs — the scholar's SDP activity list loads faster (only how it is fetched and drawn)
// Run:  node tests/scholar-sdp-load/web_tests.mjs        No database or browser needed.
import assert from "node:assert/strict";
import fs from "node:fs";
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const api = src("src/scholar/sdpApi.ts"), panel = src("src/scholar/components/dashboard/SDPPanel.tsx");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

console.log("What is downloaded");
test("the list asks only for the columns the scholar screens use, not every column", () => {
  const cols = api.match(/const SDP_LIST_COLUMNS = "([^"]+)"/)[1].split(",").map(s => s.trim());
  assert.ok(cols.length > 15 && cols.includes("name") && cols.includes("date_time") && cols.includes("recurring_dates") && cols.includes("pubmat_path") && cols.includes("rationale"));
  assert.ok(api.includes("ask(SDP_LIST_COLUMNS)"));
});
test("the big planning fields (nature, source of fund, objectives, partners, role, work plan, program flow, budget) are NOT downloaded", () => {
  const cols = api.match(/const SDP_LIST_COLUMNS = "([^"]+)"/)[1].split(",").map(s => s.trim());
  for (const heavy of ["nature", "source_of_fund", "objectives", "target_partners", "specific_role", "work_plan", "program_flow", "budget_items"]) assert.equal(cols.includes(heavy), false, heavy);
});
test("the scholar screens never read those fields (so nothing is lost)", () => {
  const scholarFiles = ["src/scholar/components/dashboard/SDPPanel.tsx", "src/scholar/components/dashboard/CalendarAndActivitiesPanel.tsx", "src/scholar/components/dashboard/activityCardKit.tsx", "src/scholar/components/dashboard/ProgressCameraModal.tsx"];
  for (const f of scholarFiles) assert.equal(/\.(nature|sourceOfFund|objectives|targetPartners|specificRole|workPlan|programFlow|budgetItems)\b/.test(src(f)), false, f);
});
test("if a column is missing (a database update not run yet) it falls back to the earlier way instead of showing an empty list", () => {
  assert.ok(api.includes('if (error) ({ data, error } = await ask("*"));'));
});

console.log("\nHow it is drawn");
test("the list is shown as soon as it arrives: the credit boxes load separately (with grey placeholders meanwhile)", () => {
  assert.ok(panel.includes("const listPart = Promise.all([fetchApprovedSDPActivities()") && panel.includes("const creditsPart = Promise.all([fetchScholarSDPProgress()"));
  assert.ok(panel.includes("setLoading(false);") && panel.includes("setCreditsLoading(false);") && panel.includes("animate-pulse"));
});
test("coming back to the tab shows the last list at once and refreshes quietly (kept per scholar)", () => {
  assert.ok(panel.includes("let sdpListMemory") && panel.includes("sdpListMemory.scholar === scholarIdNumber") && panel.includes("useState(!remembered)"));
});
test("a card far off the screen is not drawn until the scholar scrolls near it, its picture loads lazily, and there is no hover animation script per card", () => {
  assert.ok(panel.includes('contentVisibility: "auto"') && panel.includes('loading="lazy"') && panel.includes('decoding="async"'));
  assert.equal(panel.includes("<motion.button"), false);
});
test("everything a card showed before is still there (name, organization, sub-category, date, category, credits, badges)", () => {
  for (const s of ["act.name", "act.organization", "subCategoryLabel(act.subCategory)", "formatShortDate(", "categoryLabel", "act.credits", "AttendedBadge", "EndedBadge", "NextScheduleBadge"]) assert.ok(panel.includes(s), s);
});
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
