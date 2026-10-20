// tests/sdp-update/phase1_screen_checks.mjs — what the Phase 1 screens must still do (reads the source files, no browser needed).
// Run:  node tests/sdp-update/phase1_screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };
const read = f => fs.readFileSync(f, "utf8");
const tab = read("src/sead/pages/SDPMonitoringTab.tsx"), api = read("src/sead/sdpMonitorApi.ts");

check("the Credited Scholars tab shows the history section, reloaded whenever the list reloads", /<CreditHistorySection activityId=\{activity\.id\} refreshKey=\{historyKey\} \/>/.test(tab) && /setHistoryKey\(k => k \+ 1\)/.test(tab));
check("the history is left out (not an error) when the database update has not been run", /if \(error \|\| !data\) return null;/.test(api) && /if \(entries === null\) return null;/.test(tab));
check("the history is read-only on screen: no edit or delete control is offered", !/CreditHistorySection[\s\S]{0,2500}(Trash2|onClick=\{\(\) => remove)/.test(tab.slice(tab.indexOf("function CreditHistorySection"), tab.indexOf("function localDatePart"))));
check("no screen calls generate_attendance_codes directly (it is closed to the website on purpose)", !fs.readdirSync("src", { recursive: true }).filter(f => /\.(ts|tsx)$/.test(String(f))).some(f => /generate_attendance_codes/.test(read(`src/${f}`))));
check("the history is fetched from the new table only through select (the website never writes to it)", !/sdp_credit_history"\)\s*\.(insert|update|delete|upsert)/.test(api));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
