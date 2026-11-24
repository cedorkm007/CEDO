// tests/academic-uploads/web_tests.mjs — reading a file the way people save it, the error report and the wiring of "Upload by file" (3 checks)
// Run:  node tests/academic-uploads/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upl-"));
const f = path.join(tmp, "a.mjs");
await build({ entryPoints: [path.join(root, "src/lib/academicUpload.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const U = await import(pathToFileURL(f).href);

// a CSV as Excel saves it in a Philippine setting: BOM, semicolons, a title line, an empty line, quoted cells; the table starts on row 3
const csv = "﻿Academic status of Some School;;;\r\n\r\nAcademic status;Scholar ID;Full name;Custom passing GWA\r\nNon-academic;2507-00459;\"CATARONG, RHEYMER\";\r\n;;;\r\nAcademic;2507-0046O;Someone;2,5\r\nEXAMPLE;EXAMPLE-0001 (delete this row);x;\r\nNot set;2507–00459;Again;\r\n";
const grid = U.parseDelimited(csv);
const p = U.parseUploadGrid(grid);
const noStatus = U.parseUploadGrid([["Scholar ID", "Full name"], ["a", "b"]]), noId = U.parseUploadGrid([["x", "y"], ["a", "b"]]), tooBig = U.parseUploadGrid([]);
check("1 a CSV with a BOM and semicolons is read; the header is found on row 3 (a title line above it), the columns are found by NAME in any order; every row keeps the number it has in the FILE (4, 6, 8: the empty line and the empty row count); the example row is left out; a missing Academic status / Scholar ID column and an empty file get a clear message",
  grid[0][0] === "Academic status of Some School" && p.headerError === "" && p.headerRow === 3 && p.rows.length === 3 && p.rows.map(r => r.i).join() === "4,6,8" && p.rows[0].scholar_id === "2507-00459" && p.rows[0].name === "CATARONG, RHEYMER" && p.rows[0].status === "Non-academic"
  && p.rows[1].custom === "2,5" && p.skippedExample === 1 && /Academic status/.test(noStatus.headerError) && /Scholar ID/.test(noId.headerError) && /empty/.test(tooBig.headerError), JSON.stringify({ h: p.headerRow, i: p.rows.map(r => r.i), e: p.headerError }));

const dup = U.findDuplicates(p.rows);
const problems = new Map([[6, ["Scholar ID not found."]], [8, ["This scholar is in the file more than once (also row 4): only the first row is used."]]]);
const rep = U.errorReportRows(p.header, p.rows, problems);
const totals = U.uploadTotals([{ state: "valid", action: "set" }, { state: "warning", action: "skip" }, { state: "error", action: "none" }, { state: "valid", action: "skip" }]);
check("2 the same scholar written differently (another dash) is found twice and the later row is refused; the error report has the Row number, the original cells and a 'Problem' column (only the rows with a problem); the review counts (1 to change, 2 no change, 1 problem) and the words read 'Will be set: Non-academic · custom 3.25', '12 changed, 3 already had it, 2 skipped because of a problem'",
  dup.get(8) === 4 && dup.size === 1 && rep.length === 3 && rep[0][0] === "Row" && rep[0][rep[0].length - 1] === "Problem" && rep[1][0] === "6" && rep[1][1] === "Academic" && rep[1].at(-1) === "Scholar ID not found." && rep[2][0] === "8"
  && totals.willSet === 1 && totals.same === 2 && totals.error === 1 && totals.warning === 1 && U.resultText({ state: "valid", action: "set", newStatus: "non_academic", newCustom: 3.25, clearCustom: false }) === "Will be set: Non-academic · custom 3.25" && U.resultText({ state: "error", action: "none", newStatus: null, newCustom: null, clearCustom: false }) === "Skipped (problem)"
  && U.summaryText(12, 3, 2) === "12 changed, 3 already had it, 2 skipped because of a problem" && U.UPLOAD_MAX_ROWS === 10000 && U.UPLOAD_MAX_MB === 5 && U.UPLOAD_CHUNK === 500, JSON.stringify(rep));

const panel = src("src/sead/components/AcademicUploadPanel.tsx"), api = src("src/sead/academicUploadApi.ts"), scr = src("src/sead/components/AcademicSchoolScreen.tsx"), sub = src("src/sead/pages/ScholarsGradesAcademicSubtab.tsx");
check("3 'Upload by file' is on the school screen (template of THIS school, check first with a progress count, Save in chunks of 500 as a numbered batch with 'Retry remaining rows', error report, warnings confirmed once, Undo for 30 days, list of past uploads); it calls the new database functions; the older file panel is no longer on the screen",
  scr.includes("<AcademicUploadPanel schoolId={schoolId}") && !sub.includes("<AcademicBulkPanel") && panel.includes("Download the template of this school") && panel.includes("Checking… ") && panel.includes("Retry remaining rows") && panel.includes("Undo this upload") && panel.includes("Past uploads of this school") && panel.includes("I have read the") && panel.includes("can be undone for 30 days")
  && ["academic_upload_check", "academic_upload_start", "academic_upload_apply", "academic_upload_finish", "academic_upload_list", "academic_upload_undo", "academic_template_rows"].every(x => api.includes(`"${x}"`)));
console.log(`\n${passed} passed`);
