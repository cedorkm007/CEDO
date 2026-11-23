// tests/sdp-credited-filters/web_tests.mjs — Credited Scholars: the rules of the filters, the Export and the Import, and the screen's wiring (5 checks)
// Run:  node tests/sdp-credited-filters/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdpf-"));
const f = path.join(tmp, "v.mjs");
await build({ entryPoints: [path.join(root, "src/lib/sdpCreditedFilters.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } });
const F = await import(pathToFileURL(f).href);
const J = JSON.stringify;

// 1. what is sent: only the filters that apply to the list and have a choice; within a filter "any of", chips, toggling and clearing
const chosen = { year: ["1st Year", "2nd Year"], school: [], semester: ["2026-2027|1st Semester"], how: ["import"], reason: ["survey"], day: ["2026-11-23|s1"], from: "2026-11-01", to: "" };
const pc = F.toFilterParam(chosen, "credited", false), pa = F.toFilterParam(chosen, "attended", true), pe = F.toFilterParam({ ...chosen, from: "2026-11-01" }, "eligible", false);
const chips = F.filterChips(chosen, "credited", true, v => "Day 1", d => `D(${d})`);
const t1 = F.toggleChoice({ year: ["1st Year"] }, "year", "2nd Year"), t2 = F.toggleChoice(t1, "year", "1st Year");
check("1 only the filters that apply to a list and have a choice are sent (credits: year, semester, how, date; the reason and the empty school are left out; the activity day only for a recurring activity; not-credited lists have no date or semester filter); the chips read 'Year: 1st Year, 2nd Year' and 'Date credited: from …'; choosing and unchoosing work; 'Clear' empties one filter",
  J(Object.keys(pc).sort()) === J(["from", "how", "semester", "year"]) && J(Object.keys(pa).sort()) === J(["reason", "year"]) && J(Object.keys(pe).sort()) === J(["reason", "year"])
  && chips.map(c => c.text).join("|") === "Year: 1st Year, 2nd Year|Semester: 2026-2027 · 1st Semester|How: Import|Day: Day 1|Date credited: from D(2026-11-01)" && J(t1.year) === J(["1st Year", "2nd Year"]) && J(t2.year) === J(["2nd Year"])
  && J(F.clearDim(chosen, "year").year) === "[]" && F.clearDim(chosen, "dates").from === "" && F.filterCount(chosen, "credited", false) === 4 && F.isFiltered({}, "credited", false) === false && F.isFiltered({ year: ["x"] }, "attended", false) === true && F.listKind("not_credited", "eligible") === "eligible",
  J(chips.map(c => c.text)) + J(pc) + J(pa));

// 2. the options: the database's numbers, year levels in order, 'not on file' last, a chosen option stays even when nobody matches; the words of how-credited and the reasons
const facets = { year: [{ v: "3rd Year", n: 5 }, { v: "1st Year", n: 9 }, { v: "(none)", n: 99 }], how: [{ v: "scan", n: 3 }] };
const opts = F.optionsToShow("year", facets, ["2nd Year"]);
check("2 the options of a filter come with their numbers: year levels in order (1st, 2nd, 3rd), '(not on file)' last, an option already chosen stays in the list with 0 so it can be unticked; the words: QR scan / Added by hand / “Credit these scholars” / Import, and the reasons (waiting for the survey, scanned once, did not attend…)",
  opts.map(o => `${o.v}:${o.n}`).join("|") === "1st Year:9|2nd Year:0|3rd Year:5|(none):99" && F.optionLabel("year", "(none)") === "(not on file)" && F.howText("scan") === "QR scan" && F.howText("manual") === "Added by hand" && F.howText("credit_attended") === "“Credit these scholars”" && F.howText("import") === "Import"
  && F.optionLabel("reason", "survey") === "Waiting for the survey" && F.optionLabel("reason", "incomplete") === "Scanned once, did not finish" && F.optionLabel("reason", "none") === "Did not attend" && F.optionLabel("semester", "none") === "No semester",
  J(opts));

// 3. the Export: the file name (activity, list, day), the columns, accents and commas in the CSV, the session name of a recurring activity, the reason for the others
const act = { name: "Iskolar360: Paglawig Isda", categoryLabel: "Community Service", subCategoryLabel: "Community-based", credits: 1 };
const row = F.creditedExportRow({ scholarIdNumber: "S-1", firstName: "JUAN", lastName: "IBAñEZ", yearLevel: "2nd Year", school: "A, B", course: "BS", barangay: "Bugo", cluster: "A", attendedDate: "2026-11-23", schoolYear: "2026-2027", semester: "1st Semester", how: "import", creditedBy: "Ana", sessionName: "Day 2" }, act);
const csv = F.toCsv([F.CREDITED_EXPORT_HEADERS, row]);
check("3 the export file is named after the activity, the list and the day (Iskolar360ParagawigIsda-style, no spaces or accents) in .xlsx or .csv; it has the 15 columns (Scholar ID … Credited by) for credits and 12 for the others; accents and commas stay right in the CSV; a recurring session adds its sub-name to the activity; a not-credited row gives the reason",
  F.exportFileName("Iskolar360: Paglawig Isda", "credited", "2026-11-23", "xlsx") === "Iskolar360PaglawigIsda_Credited_2026-11-23.xlsx" && F.exportFileName("Ñandú Run", "eligible", "2026-11-23", "csv") === "NanduRun_NotCredited_Eligible_2026-11-23.csv"
  && F.CREDITED_EXPORT_HEADERS.length === 15 && F.NOT_CREDITED_EXPORT_HEADERS.length === 12 && row[1] === "JUAN IBAÑEZ" && row[7] === "Iskolar360: Paglawig Isda – Day 2" && row[11] === "2026-2027 · 1st Semester" && row[13] === "Import" && row[14] === "Ana"
  && csv.startsWith("﻿Scholar ID,") && csv.includes('"A, B"') && csv.includes("IBAÑEZ")
  && F.notCreditedExportRow({ scholarIdNumber: "S-2", firstName: "A", lastName: "B", yearLevel: "1st Year", school: "X", course: "Y", barangay: "Z", cluster: "B", status: "Regular", reasonCode: "survey" }, act)[11] === "Waiting for the survey", csv.slice(0, 80));

// 4. the Import file: columns found by name (any order, extra columns beside the table ignored), the example row left out, dates in several writings, the semester written in several ways or left to "Counts in"; clear messages when a column is missing
const grid = [
  ["Date credited", "Scholar ID", "Semester", "Credits", "Day sub-name", "Note", "", "How to fill this in"],
  ["2026-11-23", "EXAMPLE-0001 (delete this row)", "2026-2027 · 1st Semester", "1", "", "", "", "Scholar ID: required"],
  ["Nov 23, 2026", "S-00001", "", "", "", "", "", "Date credited: required"],
  ["9/15/2026", "S-00002", "2026-2027 2nd sem", "1", "Day 2", "n", "", ""],
  ["", "", "", "", "", "", "", "Nothing is saved until…"],
  ["31/31/2026", "S-00003", "1st Semester", "", "", "", "", ""],
  ["2026-11-23", "S-00004", "Third semester", "", "", "", "", ""],
];
const pi = F.parseImportGrid(grid, "2026-2027");
const noId = F.parseImportGrid([["Name", "Date credited"], ["a", "b"]], null), empty = F.parseImportGrid([[""], [""]], null);
check("4 the import file is read by column name in any order; the example row and the text beside the table are left out; dates are read in several ways (2026-11-23, Nov 23, 2026, 9/15/2026) and an unreadable one is kept as written; a semester can be '2026-2027 · 1st Semester', '2026-2027 2nd sem' or just '1st Semester' (the school year comes from “Counts in”) or empty; a missing column or an empty file gets a clear message",
  pi.headerError === "" && pi.skippedExample === 1 && pi.rows.length === 4 && pi.rows[0].scholar_id === "S-00001" && pi.rows[0].date === "2026-11-23" && pi.rows[0].school_year === "" && pi.rows[1].date === "2026-09-15" && pi.rows[1].school_year === "2026-2027" && pi.rows[1].semester === "2nd Semester" && pi.rows[1].day_sub === "Day 2"
  && pi.rows[2].date === null && pi.rows[2].date_text === "31/31/2026" && pi.rows[2].semester === "1st Semester" && pi.rows[2].school_year === "2026-2027" && pi.rows[3].semester === "Third semester" && pi.rows[0].i === 3
  && /Scholar ID/.test(noId.headerError) && noId.rows.length === 0 && /empty/i.test(empty.headerError)
  && F.parseSemesterCell("2026-2027|1st Semester", null).semester === "1st Semester" && F.parseSemesterCell("1st Semester", null).schoolYear === "?", J(pi.rows));

// 5. the screen: the Filters / Export / Import buttons, the chips, the numbers that follow the filters, 'Credit these scholars' hidden while filtering, the history word 'imported', and the tab still works without the database update
const panel = src("src/sead/components/CreditedScholarsPanel.tsx"), tab = src("src/sead/pages/SDPMonitoringTab.tsx"), api = src("src/sead/sdpCreditedFiltersApi.ts"), imp = src("src/sead/components/CreditedImportModal.tsx"), fp = src("src/sead/components/CreditedFiltersPanel.tsx");
check("5 the tab has Filters (with how many are on), Export (Excel / CSV, all matching rows with progress and Cancel) and Import; removable chips and 'Clear all'; the numbers on the buttons follow the filters; 'Credit these scholars (all)' is hidden while a filter is on; the filters are kept in the pop-up (not the tab) and the history says 'imported from a file'; the import checks first and saves second in chunks of 500; the panel counts options with the database; without the database update the tab keeps working and says what to run",
  panel.includes("Filters{filterCount") && panel.includes("runExport(\"xlsx\")") && panel.includes("runExport(\"csv\")") && panel.includes("Exporting {exporting.done") && panel.includes("cancelExport.current = true") && panel.includes("Clear all filters") && panel.includes("Remove filter")
  && panel.includes("fetchFilteredSummary") && panel.includes("{!filtered && <button type=\"button\" onClick={() => void creditEveryone()}") && panel.includes("probeFiltersUpdate") && panel.includes("filtersMissing && <label") && panel.includes("FILTERS_SQL")
  && tab.includes("const [creditedFilters, setCreditedFilters]") && tab.includes("filters={creditedFilters} onFiltersChange={setCreditedFilters}") && tab.includes("import: \"imported from a file\"")
  && imp.includes("checkImport(activity.id") && imp.includes("saveImport(activity.id") && imp.includes("IMPORT_SAVE_CHUNK") && imp.includes("Save valid rows (") && imp.includes("Download error report") && imp.includes("Download template")
  && api.includes('"sdp_credited_facets"') && api.includes('"sdp_import_save"') && api.includes('"sdp_credited_list"') && fp.includes("fetchFacets(activityId") && fp.includes("Apply") && fp.includes("off = o.n === 0 && !on"));
console.log(`\n${passed} passed`);
