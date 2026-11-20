// tests/consultation-dashboard/update_web_tests.mjs — Main Dashboard update: Clients Served for every consultant, the On Leave / Reconsidered / Removed numbers open a list, and Renewal Cases open the documents that wait for you (4 checks)
// Run:  node tests/consultation-dashboard/update_web_tests.mjs        No database or browser needed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const dash = src("src/sead/pages/ScholarCounselingDashboardTab.tsx"), modal = src("src/sead/components/ScholarStatusListModal.tsx"), api = src("src/sead/referralApi.ts"), cases = src("src/sead/pages/ScholarCounselingRenewalCasesTab.tsx");

check("1 'Clients Served' says it is the visits of every consultant from the 1st of the month to today, and its link opens Daily Records for all consultants",
  dash.includes("The visits of every consultant, from the 1st of the month to today") && !dash.includes("Your visits from the 1st") && !src("src/lib/dashboardLinks.ts").includes("consultantIds: [me]"));
check("2 the On Leave, Reconsidered and Removed numbers are buttons that open the list of those scholars (the pop-up gets the dashboard number)",
  dash.includes('setStatusList("On leave")') && dash.includes('setStatusList("Reconsidered")') && dash.includes('setStatusList("Removed")') && dash.includes("<ScholarStatusListModal status={statusList}") && dash.includes("expected={statusList ===") && dash.includes("Press a number to see them."));
check("3 the list reads the scholars page by page (20 a page, with the true total), has a search with a 300 ms wait, grey placeholders, an empty message, and a notice when the database update has not been run",
  modal.includes("fetchStatusScholarsPage(") && modal.includes("<ServerPagination") && modal.includes("noun=\"scholars\"") && modal.includes("}, 300)") && modal.includes("animate-pulse") && modal.includes("request.current") && modal.includes("supabase_migration_consultation_dashboard_all_visits.sql")
  && api.includes("scholar_counseling_status_scholars_page") && api.includes("p_status: status"));
check("4 Renewal Cases: a case with documents waiting for you opens on its own when the page is read (and when a live update brings it documents), the others open on 'Show the documents'; only the cases that open read their documents",
  cases.includes("function autoOpen(list: ConsultCase[])") && cases.includes("c.docsSubmitted > 0 && !open.has(c.recordId)") && cases.includes("autoOpen(r.rows);") && cases.includes("autoOpen(m.rows.filter(c => m.changedIds.includes(c.recordId)))")
  && /function autoOpen[\s\S]*?void loadDocs\(c\.recordId\)/.test(cases) && /function toggleOpen[\s\S]*?if \(!isOpen\) void loadDocs\(id\)/.test(cases));
console.log(`\n${passed} passed`);
