// tests/consultation-paging/web_tests.mjs — Consultation Tool, Daily Records: the rules of the list (quick picks, "Showing 1–50 of 3,482", page numbers, what is remembered, the export file) and the screen (6 checks)
// Run:  node tests/consultation-paging/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "page-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/dailyRecordsView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const V = await import(pathToFileURL(f).href);

check("1 the quick picks: Today, This week (Monday to today), This month (the 1st to today), This semester (since the day the semester was set); this semester is not offered when that day is not known",
  JSON.stringify(V.quickRange("today", "2026-11-19", null)) === '{"from":"2026-11-19","to":"2026-11-19"}' && JSON.stringify(V.quickRange("week", "2026-11-19", null)) === '{"from":"2026-11-16","to":"2026-11-19"}'
  && JSON.stringify(V.quickRange("week", "2026-11-22", null)) === '{"from":"2026-11-16","to":"2026-11-22"}' && JSON.stringify(V.quickRange("month", "2026-11-19", null)) === '{"from":"2026-11-01","to":"2026-11-19"}'
  && JSON.stringify(V.quickRange("semester", "2026-11-19", "2026-08-03")) === '{"from":"2026-08-03","to":"2026-11-19"}' && V.quickRange("semester", "2026-11-19", null) === null);
check("2 the true total is shown with the first and last number of the page ('Showing 1–50 of 3,482 records'), the last page is shorter, one record is singular, and nothing says 'No records'",
  V.showingText(1, 50, 3482) === "Showing 1–50 of 3,482 records" && V.showingText(70, 50, 3482) === "Showing 3,451–3,482 of 3,482 records" && V.showingText(1, 50, 1) === "Showing 1–1 of 1 record" && V.showingText(1, 50, 0) === "No records" && V.pageCount(3482, 50) === 70 && V.pageCount(0, 50) === 1);
check("3 the page numbers always show the first, the last and the ones around the current page, with … for the gaps (1 … 4 5 6 … 70); a short list shows every number",
  JSON.stringify(V.pageNumbers(5, 70)) === JSON.stringify([1, 2, 3, 4, 5, 6, "…", 69, 70]) && JSON.stringify(V.pageNumbers(30, 70)) === JSON.stringify([1, 2, "…", 29, 30, 31, "…", 69, 70]) && JSON.stringify(V.pageNumbers(1, 70)) === JSON.stringify([1, 2, "…", 69, 70]) && JSON.stringify(V.pageNumbers(3, 5)) === "[1,2,3,4,5]"
  && JSON.stringify(V.pageNumbers(4, 9)) === JSON.stringify([1, 2, 3, 4, 5, "…", 8, 9]));
const saved = JSON.stringify({ filters: { search: "ana", from: "2026-09-01", to: "bad", visitTypes: ["Office", 5], statuses: [], consultantIds: ["x"] }, sortKey: "name", sortDir: "asc", page: 7 });
const back = V.readRemembered(saved);
check("4 the page, the filters, the search and the sort are remembered and read back safely (a bad date, a wrong type or broken text never breaks the list)",
  back.filters.search === "ana" && back.filters.from === "2026-09-01" && back.filters.to === "" && back.filters.visitTypes.join() === "Office" && back.sortKey === "name" && back.sortDir === "asc" && back.page === 7
  && V.readRemembered("{oops") === null && V.readRemembered(null) === null && V.readRemembered('{"filters":{},"page":-3}').page === 1 && V.readRemembered('{"filters":{}}').sortKey === "date");
const rec = { scholarIdNumber: "2409-01020", name: "ABA, RACHEL", course: "BSMA", yearLevel: "3rd Year", school: "CU", dateVisited: "2026-09-15", visitType: "Office", status: "Regular", consultedByName: "TEST Counselor", failedSubjects: "Calc", findings: "F", staffRecommendations: "R", createdAt: "2026-09-15T20:30:00Z" };
const row = V.exportRow(rec);
check("5 the export has every column (13), the day it was logged in Philippine time (20:30 UTC is already the 16th), and a file name that says the dates and 'filtered'",
  V.EXPORT_HEADERS.length === 13 && row.length === 13 && row[0] === "2409-01020" && row[9] === "Calc" && row[12] === "2026-09-16"
  && V.exportFileName(V.EMPTY_DAILY_FILTERS, "2026-11-19") === "Daily-Records_2026-11-19.xlsx" && V.exportFileName({ ...V.EMPTY_DAILY_FILTERS, from: "2026-09-01", to: "2026-09-30", visitTypes: ["Office"] }, "2026-11-19") === "Daily-Records_2026-09-01_to_2026-09-30_filtered_2026-11-19.xlsx");
const tab = src("src/sead/pages/ScholarCounselingTab.tsx"), api = src("src/sead/scholarCounselingApi.ts"), pag = src("src/app/components/ServerPagination.tsx"), det = src("src/sead/components/DailyRecordDetailModal.tsx");
check("6 the screen: pages of 50 read from the database (never everything), the search waits 300 ms, filters above the table (dates, quick pick, visit type, status, consultant, Clear), the table keeps 8 columns (Name, Course, Year, School, Date visited, Visit type, Consultant, Actions) with an eye button 'View record', sorting by name and date, a skeleton while loading, a clear empty message, an Export of ALL matching records with progress, and the rest of the record in the detail window",
  /fetchDailyRecordsPage\(filters, sort, page\)/.test(tab) && !/fetchDailyRecords\(/.test(tab) && /window\.setTimeout\(\(\) => \{ setFilters\(f => \(\{ \.\.\.f, search: typed \}\)\); setPage\(1\); \}, 300\)/.test(tab) && /aria-label="Filters"/.test(tab) && /Clear filters/.test(tab) && /Quick pick/.test(tab)
  && ["Name", "Course", "Year", "School", "Date visited", "Visit type", "Consultant", "Actions"].every(h => tab.includes(`>${h}<`) || tab.includes(`label="${h}"`)) && !/Findings|Staff Recommendations|Failed Subject/.test(tab.slice(tab.indexOf("<thead>"), tab.indexOf("</thead>")))
  && /title="View record"/.test(tab) && /animate-pulse/.test(tab) && /No daily record matches these filters/.test(tab) && /fetchAllDailyRecordsForExport\(/.test(tab) && /Preparing the export/.test(tab) && /REMEMBER_KEY/.test(tab)
  && /p_limit: limit, p_offset: offset/.test(api) && /const PAGE = 500;/.test(api) && /offset === 0\)/.test(api) && /aria-label="Pages"/.test(pag) && /Previous/.test(pag) && /Next/.test(pag) && /Findings/.test(det) && /Staff recommendations/.test(det) && /View scholar profile/.test(det));
console.log(`\n${passed} passed`);
