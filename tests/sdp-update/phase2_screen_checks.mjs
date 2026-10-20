// tests/sdp-update/phase2_screen_checks.mjs — what the Phase 2 Checklist screen must do (reads the source files, no browser needed).
// Run:  node tests/sdp-update/phase2_screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };
const tab = fs.readFileSync("src/sead/pages/SDPMonitoringTab.tsx", "utf8"), api = fs.readFileSync("src/sead/sdpMonitorApi.ts", "utf8");
const section = tab.slice(tab.indexOf("function ChecklistSection()"));

check("the Checklist asks the database for ONE page of 50 (not everyone) when the database update is installed", /fetchSdpChecklistPage\(\{/.test(section) && /const CHECKLIST_PAGE_SIZE = 50;/.test(tab) && /pageSize: CHECKLIST_PAGE_SIZE/.test(section));
check("search, filter and sort are sent to the database", /search, filter, sortKey: sortState\.key/.test(section) && /p_search: q\.search, p_filter: q\.filter/.test(api) && /p_sort: q\.sortKey \? CHECKLIST_SORT_NAMES\[q\.sortKey\] : "default"/.test(api));
check("typing waits 300 ms before asking the database", /window\.setTimeout\(\(\) => setSearch\(searchInput\), 300\)/.test(section));
check("a slow, older answer never replaces a newer one", /const id = \+\+requestId\.current;/.test(section) && /if \(id !== requestId\.current\) return;/.test(section));
check("the three counts load separately and show … until they arrive", /fetchSdpChecklistSummary\(/.test(section) && /n === null \? "…"/.test(section));
check("while a page loads, placeholder rows (a skeleton) are shown instead of the word Loading", /animate-pulse/.test(section) && !/>Loading…</.test(section));
check("if the database update is not installed the screen falls back to the earlier way (everyone, searched and sorted in the browser)", /if \(result\.missing\) \{ setServerPaging\(false\); return; \}/.test(section) && /fetchScholarsSdpCompliance\(\{/.test(section) && /isMissingFunction\(error\)/.test(api));
check("a failed page shows the reason in a visible message", /role="alert"[^>]*>Could not load the checklist/.test(section));
check("the page is only worked out when asked for: SDP History is read when View is clicked, not for every row", /<SDPHistoryModal/.test(section) && /onClick=\{\(\) => setViewingScholar\(/.test(section));
check("the sort arrows still use the same column names the database understands", ["scholarIdNumber", "name", "communityService", "communityVolunteerism", "formationProgram", "result"].every(k => api.includes(`${k}: "`)));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
