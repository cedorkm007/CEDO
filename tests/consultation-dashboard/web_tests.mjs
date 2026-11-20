// tests/consultation-dashboard/web_tests.mjs — Consultation Tool, Main Dashboard: where a number leads (the tab and its filters), the one-line tab names, and the screen (4 checks)
// Run:  node tests/consultation-dashboard/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
const bundle = async (entry, name) => { const f = path.join(tmp, name); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" }); return import(pathToFileURL(f).href); };
const L = await bundle("src/lib/dashboardLinks.ts", "links.mjs"), D = await bundle("src/lib/dailyRecordsView.ts", "daily.mjs"), P = await bundle("src/lib/probationView.ts", "prob.mjs");

// 1. where a number leads: the tab reads the link back as exactly the filters that make its total equal the number
const ME = "0b0f2f9e-1c3a-4e0e-9a43-111111111111", TODAY = "2026-11-19";
const ksb = L.dashboardTarget("ksb", TODAY, null), home = L.dashboardTarget("home", TODAY, ME), served = L.dashboardTarget("served", TODAY, ME), prob = L.dashboardTarget("probationary", TODAY, null);
const rk = D.readRemembered(ksb.value), rh = D.readRemembered(home.value), rs = D.readRemembered(served.value), rp = P.readRememberedProbation(prob.value);
check("1 pressing KSB Client / Home Visited opens Daily Records with that Visit type only; Clients Served opens Daily Records from the 1st of the month to today for every consultant; Probationary opens Probationary Monitoring with no filter; each tab reads the link as its own remembered view",
  ksb.tab === "daily-records" && ksb.storageKey === D.REMEMBER_KEY && JSON.stringify(rk.filters.visitTypes) === '["KSB Client"]' && rk.filters.from === "" && rk.filters.consultantIds.length === 0 && rk.page === 1
  && JSON.stringify(rh.filters.visitTypes) === '["Home Visit"]' && rs.filters.from === "2026-11-01" && rs.filters.to === TODAY && rs.filters.consultantIds.length === 0 && rs.filters.visitTypes.length === 0
  && L.dashboardTarget("served", TODAY, null) !== null && prob.tab === "probation-monitoring" && prob.storageKey === P.PROBATION_REMEMBER_KEY && rp.filters.attention.length === 0 && rp.filters.kind === "" && rp.filters.search === "" && rp.page === 1);

// 2. the tab bar
const page = src("src/sead/ScholarCounselingToolPage.tsx");
check("2 every tab name stays on ONE line (no wrapping; the bar scrolls sideways on a narrow screen instead), and a number on the dashboard opens its tab after writing the tab's remembered view and starting that tab again",
  page.includes("whitespace-nowrap") && page.includes("overflow-x-auto") && page.includes("shrink-0") && page.includes("function openTarget(t: DashboardTarget)") && page.includes("window.sessionStorage.setItem(t.storageKey, t.value)")
  && page.includes("<ScholarCounselingTab key={dailyKey} />") && page.includes("<ProbationMonitoringTab key={probationKey} />") && page.includes("onOpenTarget={openTarget}"));

// 3. the screen
const tab = src("src/sead/pages/ScholarCounselingDashboardTab.tsx"), api = src("src/sead/referralApi.ts");
check("3 the dashboard reads its numbers in one call, shows grey placeholders while they load, makes the numbers press-able (to the tab that lists them), and reads Scholars to be Consulted and Approved Referrals page by page with the true total (and a search for the approved ones); the oldest case of the WHOLE queue is the one that can be taken",
  tab.includes("fetchDashboardCounts()") && tab.includes("fetchQueuePage(queuePage)") && tab.includes("fetchApprovedPage(approvedSearch, approvedPage)") && tab.includes("animate-pulse") && (tab.match(/<ServerPagination/g) ?? []).length === 2
  && tab.includes("}, 300)") && tab.includes("(queuePage - 1) * DASHBOARD_PAGE_SIZE + i === 0") && tab.includes("open(\"probationary\")") && tab.includes("open(\"served\")") && tab.includes("scrollToQueue")
  && !tab.includes("fetchReferralQueue") && !tab.includes("fetchApprovedReferrals") && !tab.includes("fetchDashboardSummary"));
check("4 before the database update the dashboard still works (it falls back to the older counts and the full lists), and the new calls are the paged ones",
  api.includes("scholar_counseling_dashboard_counts") && api.includes("scholar_counseling_queue_page") && api.includes("scholar_counseling_approved_page") && /fetchDashboardCounts[\s\S]*?isMissingFn\(error\)[\s\S]*?fetchDashboardSummary\(\)/.test(api)
  && /fetchQueuePage[\s\S]*?fetchReferralQueue\(\)/.test(api) && /fetchApprovedPage[\s\S]*?fetchApprovedReferrals\(\)/.test(api));
console.log(`\n${passed} passed`);
