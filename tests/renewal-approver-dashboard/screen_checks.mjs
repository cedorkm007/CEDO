// tests/renewal-approver-dashboard/screen_checks.mjs — what the SDP Reconsideration Approver sees in Scholar Renewal.   Run:  node tests/renewal-approver-dashboard/screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const page = src("src/sead/ScholarRenewalPage.tsx"), dash = src("src/sead/renewal/RenewalDashboardTab.tsx");
check("the Dashboard tab is listed for the people who see the renewals AND for the SDP Reconsideration Approver", /t\.key === "dashboard" \? \(seesRenewals \|\| isSdpApprover\)/.test(page));
check("the Excel report is offered only to the people who had it (evaluator, Division Head, heads of SEAD)", /canExport=\{seesRenewals\}/.test(page) && /canExport = true/.test(dash) && /\{canExport && <button type="button" onClick=\{\(\) => void exportExcel\(\)\}/.test(dash) && /\{canExport && <details/.test(dash) && /<\/details>\}/.test(dash));
check("the approver's other tabs are unchanged (Applications, Renewed, Not applied, SDP Reconsideration)", /\(t\.key === "applications" \|\| t\.key === "renewed" \|\| t\.key === "notApplied"\) \? seesList/.test(page) && /t\.key === "sdpReconsideration" \? \(isEvaluator \|\| isSdpApprover\)/.test(page));
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
