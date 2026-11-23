// tests/sdp-eligible/web_tests.mjs — Credited Scholars > Not credited > "Eligible, did not attend": the words, and the screen (3 checks)
// Run:  node tests/sdp-eligible/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdpe-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/sdpCreditedView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const V = await import(pathToFileURL(f).href);

check("1 the words: a scholar who never scanned reads 'Did not attend', one who scanned once and never finished reads 'Scanned once, did not finish'; year level and barangay read together; the note says who is eligible and that crediting by hand is still possible; a scholar-submitted activity says it has no list",
  V.eligibleStatusText(null) === "Did not attend" && V.eligibleStatusText("") === "Did not attend" && V.eligibleStatusText("incomplete") === "Scanned once, did not finish" && V.placeText("2nd Year", "Bugo") === "2nd Year · Bugo" && V.placeText("", " ") === "—" && V.placeText("1st Year", null) === "1st Year"
  && /year level and barangay or cluster/.test(V.ELIGIBLE_NOTE) && /credited by hand/.test(V.ELIGIBLE_NOTE) && /submitted by a scholar/.test(V.ELIGIBLE_NOT_APPLICABLE));

const panel = src("src/sead/components/CreditedScholarsPanel.tsx"), tab = src("src/sead/pages/SDPMonitoringTab.tsx"), api = src("src/sead/sdpCreditedApi.ts");
check("2 under 'Not credited' there are two buttons with their numbers, 'Attended, not credited' and 'Eligible, did not attend'; the eligible one is switched off for an activity a scholar submitted; the last list stays open while the pop-up is open; the list is read page by page with the search, shows Scholar | Scholar ID | Year level | Barangay, and has no tick boxes or credit buttons (those belong to the attended list)",
  panel.includes('aria-label="Which scholars"') && panel.includes("Attended, not credited") && panel.includes("Eligible, did not attend") && panel.includes('eligibleSummary?.applicable === false') && panel.includes("disabled={key === \"eligible\"")
  && tab.includes("const [notCreditedFilter, setNotCreditedFilter]") && tab.includes("notFilter={notCreditedFilter} onNotFilterChange={setNotCreditedFilter}")
  && panel.includes("fetchEligiblePage(activity.id, search, page, pageSize)") && panel.includes("Year level</th>") && panel.includes("Barangay</th>") && panel.includes("{side === \"not_credited\" && !onEligible && (summary?.creditable ?? 0) > 0 && (")
  && panel.includes("Every eligible scholar attended or has a credit.") && panel.includes("No eligible scholar matches this search."));
check("3 the rest of the tab does not depend on the new database update: before it is run the eligible button simply shows a notice (the number and list of 'Attended, not credited' and 'Credited' still work); the calls ask only the two new functions",
  panel.includes("setEligibleMissing(true)") && panel.includes("ELIGIBLE_SQL") && /if \(!r\.ok\) \{ if \(r\.missing\) setMissing\(true\); return; \}\s+setSummary\(r\.summary\);\s+if \(e\.ok\)/.test(panel)
  && api.includes('"sdp_eligible_summary"') && api.includes('"sdp_eligible_did_not_attend_page"') && api.includes("p_activity_id: activityId, p_search: search.trim(), p_limit: pageSize"));
console.log(`\n${passed} passed`);
