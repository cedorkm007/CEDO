// tests/sdp-update/phase4_screen_checks.mjs — what the Phase 4 screens must do (reads the source files, no browser needed).
// Run:  node tests/sdp-update/phase4_screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };
const read = f => fs.readFileSync(f, "utf8");
const tab = read("src/sead/pages/SDPMonitoringTab.tsx"), api = read("src/sead/sdpMonitorApi.ts"), shared = read("src/scholar/sdpApi.ts"), scholarApi = read("src/scholar/scholarApi.ts");
const panel = read("src/scholar/components/dashboard/SDPPanel.tsx"), cal = read("src/scholar/components/dashboard/CalendarAndActivitiesPanel.tsx");
const light = read("src/sead/components/LightweightActivityEditModal.tsx"), hist = read("src/sead/components/SDPHistoryModal.tsx");
const after = (src, marker) => src.slice(src.indexOf(marker));

check("each day of a recurring activity has an optional Sub-name next to date, From, To and venue (create and edit)", /Sub-name \(optional\)/.test(after(tab, "function DetailModal")) && /aria-label="Sub-name of this day"/.test(tab) && /Sub-name of this first day \(optional\)/.test(after(tab, "function NewActivityModal")));
check("the sub-name of a day is saved with the day (the first day in its own column, the others inside the list of days)", /subName: first\.subName/.test(tab) === false && /firstSubName = first\.subName\.trim\(\)/.test(tab) && /\.\.\.\(r\.subName\.trim\(\) \? \{ subName: r\.subName\.trim\(\) \} : \{\}\)/.test(tab) && /sub_name: fields\.subName\.trim\(\) \|\| null/.test(api));
check("a day with no sub-name shows only the main name (and its date)", /return sub \? `\$\{a\.name\} – \$\{sub\}` : a\.name;/.test(shared));
check("the codes of a recurring activity are made for ONE chosen day, when the activity is first set up and when more codes are added", /Codes for which day/.test(tab) && /enableAttendanceForActivity\(activity\.id, type, n, voucherHours, showDays \? dayChoice : null\)/.test(tab) && /addAttendanceVouchers\(session\.id, n, showDays \? dayChoice : null\)/.test(tab));
check("the codes view shows the day of each batch and of each code", /Batch \{batch\.number\}\{batch\.codes\[0\]\?\.dayDate/.test(tab) && /\{c\.dayDate && <p/.test(tab));
check("the CSV export has a day column", /"kind,code,day"/.test(tab));
check("the QR PDF prints the main name and the day on every code", /const dayLine = dayText\(activity, code\.dayDate\)/.test(tab) && /pdf\.splitTextToSize\(activity\.name/.test(tab));
check("the attendance roster lists the days each scholar was credited", /labels\.join\(" · "\)/.test(after(tab, "function QRAttendanceSection")));
check("the Credited Scholars list shows the day's sub-name with each credit", /\{activity\.name\} – \{sub\}/.test(after(tab, "function AttendanceSection")));
check("the credit history names the day of a credit", /savedDay/.test(tab) && /dayText\(activity, savedDay\)/.test(tab));
check("the scholar's SDP History window names each credited day (one row per credit)", /dayLabel\(schedule, day\)/.test(api) && /key=\{r\.rowKey\}/.test(hist));
check("the scholar portal names the day when a code is redeemed, in the activity list, in the calendar and on the SDP card", /daySubName \? `\$\{data\?\.activityName\} – \$\{data\.daySubName\}`/.test(scholarApi) && /dayLabel\(activity, manilaDay\(activity\.dateTime\)\)/.test(cal) && /nextDaySub/.test(panel));
check("a monitor can edit the sub-names of the days in their Edit Activity window", /Sub-names of the days \(optional\)/.test(light) && /showDayNames/.test(light));
check("before the database update the sub-name fields and the day choice are hidden and nothing about them is sent (the page works as before)", /isDayLabelsSupported\(\)/.test(tab) && /dayColumnsPresent = "sub_name" in data\[0\]/.test(api) && /mentionsDayColumn\(error\.message\)/.test(api) && /\/day_date\/i\.test\(error\.message\)/.test(api));
check("the counting does not depend on sub-names: nothing in the Checklist or the credit calculation reads them", !/sub_?name/i.test(after(tab, "function ChecklistSection")) && !/sub_name|subName/.test(read("supabase_migration_sdp_update_p2b_saved_results.sql")));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
