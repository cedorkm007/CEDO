// tests/program-info-snapshots/screen_checks.mjs — Scholarship Program Information: view by semester + the renewal note.   Run:  node tests/program-info-snapshots/screen_checks.mjs
import fs from "node:fs";
let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const src = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const page = src("src/sead/pages/ScholarshipProgramInfoPage.tsx"), api = src("src/sead/seadApi.ts"), panel = src("src/sead/components/ScholarListPanel.tsx");

console.log("The note while a renewal is open");
check("the page asks the database whether a renewal window is open and shows the note only then", /fetchRenewalOngoing\(\)/.test(page) && /\{renewalOngoing && \(/.test(page) && /subject to change/.test(page));
check("the note says it on the whole page (above both top tabs), not only on one tab", page.indexOf("renewal-ongoing-note") < page.indexOf("<GraduationCap size={14} /> Mainstream Scholars"));

console.log("\nThe picker");
check("there is a View by semester choice with Live first, then the semesters the database offers (newest first)", /View by semester/.test(page) && /<option value="live">Live/.test(page) && /fetchProgramPeriods\(\)/.test(page) && /sorted\.map\(r =>/.test(page) && /localeCompare/.test(page));
check("each semester is named for what it is: before the renewal, or renewed scholars", /before the renewal/.test(page) && /renewed scholars/.test(page));
check("choosing a semester reloads everything under it (the body is remounted per semester)", /<MainstreamBody key=\{periodKey\(period\)\} period=\{period\} \/>/.test(page));
check("the before-the-renewal copy says it does not change; the renewal semester says it fills in and is subject to change", /does not change when scholars change today/.test(page) && /It fills in as renewals are confirmed, so the numbers are subject to change/.test(page));
check("there is no manual save button or dialog any more", !/Save today/.test(page) && !/SaveSnapshotModal/.test(page) && !/saveSnapshot/.test(api));

console.log("\nEvery number and list goes through the chosen semester");
const fetchers = ["fetchScholarshipStatusCounts(period)", "fetchScholarsByBarangay(period)", "fetchScholarsBySchool(period)", "fetchScholarsBySchoolYearLevel(school, period)", "fetchScholarsBySchoolYearLevelCourse(selectedSchool, yearLevel, period)",
  "fetchScholarsByYearLevelForStatus(status, period)", "fetchScholarsBySchoolForStatus(status, period)", "fetchScholarsByBarangayForStatus(status, period)", "fetchScholarsByCourseForStatus(status, period)", "fetchAllScholarsInformationForExport(filters, period)", "fetchAllScholarsInformationForExport({ barangay }, period)"];
for (const f of fetchers) check(f, page.includes(f));
check("the school list passes the semester too", /courseExact: course \}, period\)/.test(page));
check("without a semester the old (live) functions are used, unchanged", /period \? await supabase\.rpc\("scholarship_status_counts_snapshot"[^]*?: await supabase\.rpc\("scholarship_status_counts"\)/.test(api) && /: supabase\.from\("scholars"\)\.select\(SCHOLAR_INFORMATION_SELECT\)/.test(api));
check("a semester is read from the copy table with the same filters", /from\("scholar_period_snapshots"\)\.select\(SCHOLAR_INFORMATION_SELECT\)\.eq\("school_year", period\.schoolYear\)\.eq\("term", period\.term\)/.test(api));

console.log("\nPer-scholar profile files");
check("the three lists pass profilesAvailable={!period}: a semester offers the list download but not today's profile file", (page.match(/profilesAvailable=\{!period\}/g) ?? []).length === 3 && /profilesAvailable = true/.test(panel) && /!profilesAvailable \?/.test(panel));
check("Financial Assistance is not touched", /<FinancialAssistanceSummaryTab \/>/.test(page));

console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
