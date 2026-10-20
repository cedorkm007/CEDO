// tests/sdp-update/phase5_screen_checks.mjs — what the Phase 5 screens must do (reads the source files, no browser needed).
// Run:  node tests/sdp-update/phase5_screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}`); } };
const tab = fs.readFileSync("src/sead/pages/SDPMonitoringTab.tsx", "utf8"), api = fs.readFileSync("src/sead/sdpMonitorApi.ts", "utf8");
const attendance = tab.slice(tab.indexOf("function AttendanceSection"), tab.indexOf("function QRAttendanceSection"));
const checklist = tab.slice(tab.indexOf("function ChecklistSection()"));

check("the manual Credit form has a semester choice that defaults to the current grading period", /<PeriodSelect label="Counts in"/.test(attendance) && /effectiveCreditKey = creditKey && [^;]+ : sdpPeriods\.currentKey/.test(attendance));
check("“Credit these scholars” has a semester choice, and the question before it names the chosen semester", /<PeriodSelect label="Count them in"/.test(attendance) && /Their credit is counted in \$\{creditPeriodLabel\}/.test(attendance));
check("the chosen semester is sent to the database (and the current semester is sent as “no choice”, so it still works before the database update)", /creditAttendedScholars\(activity\.id, chosenPeriod\(\)\)/.test(attendance) && /creditAttendance\(activity\.id, scholarIdNumber, newDate, chosenPeriod\(\)\)/.test(attendance) && /effectiveCreditKey === sdpPeriods\.currentKey \? null/.test(attendance) && /p_school_year: period\.schoolYear, p_semester: period\.semester/.test(api));
check("every credit in the Credited Scholars list shows the semester it counts in", /\{a\.schoolYear && a\.semester \? `\$\{a\.schoolYear\} · \$\{termLabel\(a\.semester\)\}` : "No semester"\}/.test(attendance));
check("each credit has a “Change semester” choice that asks before moving it, and says nothing is added or removed", /Change semester/.test(attendance) && /Nothing is added or removed, and the change is written to the history/.test(attendance) && /moveCreditSemester\(entry\.id, target\)/.test(attendance));
check("the history names a semester change", /semester_move: "semester changed"/.test(tab));
check("the Checklist shows a banner when the semester chosen is not the current period, in the wording you gave, with a way back", /You are viewing <strong>\{termLabel\(chosen\.term\)\} \{chosen\.schoolYear\}<\/strong>\. The current period is/.test(checklist) && /effectiveKey !== currentKey/.test(checklist) && /Show the current period/.test(checklist));
check("the banner is announced to screen readers and is readable (dark text on a light amber background)", /role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 [^"]*text-amber-950"/.test(checklist));
check("the moving and crediting tools only appear on the screens that already needed the SDP Monitoring tag (the Credited Scholars tab)", !/moveCreditSemester\(/.test(tab.slice(0, tab.indexOf("function AttendanceSection"))));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
