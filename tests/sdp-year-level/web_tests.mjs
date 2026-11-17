// tests/sdp-year-level/web_tests.mjs — the SDP Checklist table: the Year column, the year level filter, the new header and the History icon (screen only, nothing about credits or results changes)
// Run:  node tests/sdp-year-level/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "year-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewalTableView.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } });
const V = await import(pathToFileURL(f).href);
const tab = src("src/sead/pages/SDPMonitoringTab.tsx"), api = src("src/sead/sdpMonitorApi.ts");
const section = tab.slice(tab.indexOf("function ChecklistSection()"));

check("1 the Year column shows the short form ('1st Yr' … '5th Yr', the full year in the tooltip) right after the scholar's name, and sorts (by the number)",
  V.shortYear("1st Year") === "1st Yr" && V.shortYear("5th Year") === "5th Yr" && V.shortYear("") === "—"
  && /label="Year" sortKey="year"/.test(section) && /title=\{s\.yearLevel \|\| undefined\}>\{shortYear\(s\.yearLevel\)\}/.test(section) && /year: s => yearNumber\(s\.yearLevel\)/.test(section)
  && /name: "year"|year: "year"/.test(api) && section.indexOf('sortKey="name"') < section.indexOf('sortKey="year"') && section.indexOf('sortKey="year"') < section.indexOf('sortKey="communityService"'));
check("2 the columns are in the asked order (Scholar ID, Scholar name, Year, Institutional, Community, Formation, SDP result, History) with a 'SDP CREDITS · 3 NEEDED EACH' group label and full names as tooltips; no 'SDP History' column, no 'View' links",
  (() => { const body = section.slice(section.indexOf("paged.map(s => (")); const o = ["{s.scholarIdNumber}</td>", "title={s.name}", "shortYear(s.yearLevel)", "credits={s.communityService}", "credits={s.communityVolunteerism}", "credits={s.formationProgram}", "<ComplianceBadge row={s} />", "<HistoryButton"].map(k => body.indexOf(k)); return o.every((x, i) => x > 0 && (i === 0 || x > o[i - 1])); })()
  && ["Scholar ID", "Scholar name", "Year", "SDP result"].every(l => section.includes(`label="${l}"`)) && section.includes(">History</th>")
  && section.includes("SDP credits · 3 needed each") && /title="Institutional Volunteerism">Institutional</.test(section) && /title="Community Volunteerism">Community</.test(section) && /title="Formation Program">Formation</.test(section)
  && !section.includes(">SDP History<") && !/>View<\/button>/.test(section));
check("3 the History column is a small icon button per row with the tooltip 'View SDP history' that opens the same window as before; the credits '0/3' are quiet gray and '✓ 3/3' (also '✓ 6/3') bold green",
  /title="View SDP history"/.test(tab) && /<HistoryButton name=\{s\.name\} onClick=\{\(\) => setViewingScholar\(\{ scholarIdNumber: s\.scholarIdNumber, name: s\.name \}\)\} \/>/.test(section) && /<SDPHistoryModal/.test(section)
  && /text-slate-500">\{credits\}\/\{goal\}/.test(tab) && /font-bold tabular-nums text-green-700/.test(tab) && /const complete = credits >= goal;/.test(tab));
check("4 the Year level choice (All, 1st Yr … 5th Yr) sits beside All / Complied / Not complied, is asked of the database (the page AND the three counts), and starts the list again from page 1",
  /aria-label="Filter by year level"/.test(section) && /CHECKLIST_YEAR_LEVELS\.map/.test(section) && /pageSize: CHECKLIST_PAGE_SIZE, yearLevel,/.test(section) && /fetchSdpChecklistSummary\(\{ schoolYear: chosen\.schoolYear, semester: chosen\.term, yearLevel \}\)/.test(section)
  && /p_year_level: q\.yearLevel|\.\.\.\(q\.yearLevel \? \{ p_year_level: q\.yearLevel \}/.test(api) && /\.\.\.\(period\.yearLevel \? \{ p_year_level: period\.yearLevel \}/.test(api) && /setPage\(1\); \}, \[search, filter, yearLevel,/.test(section));
check("5 the list fits without sideways scrolling: a fixed-column table (names end in … with the full name on hover) from a medium width, the Scholar ID moves under the name when narrow, and a card per scholar on a phone (name, ID and year; the three credits; the result; the history button)",
  /table-fixed/.test(section) && /<col className="hidden @min-\[940px\]:table-column"/.test(section) && /block truncate" title=\{s\.name\}/.test(section) && !/overflow-x-auto/.test(section.slice(0, section.indexOf("<ListPagination")).split("rounded-2xl border border-[#e6ecf5] bg-white overflow-hidden")[1] ?? "")
  && /<ul className="@min-\[800px\]:hidden/.test(section) && /<dl className="mt-2\.5 grid grid-cols-3/.test(section) && /<ComplianceBadge row=\{s\} \/>/.test(section.split("<ul className")[1]));
console.log(`\n${passed} passed`);
