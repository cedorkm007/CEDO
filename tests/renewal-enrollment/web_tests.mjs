// tests/renewal-enrollment/web_tests.mjs — the Renewed list's Enrollment confirmation column and the export window; the .xlsx file is built and read back (5 checks)
// Run:  node tests/renewal-enrollment/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const JSZip = require("jszip");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-"));
const f = path.join(tmp, "e.mjs");
await build({ entryPoints: [path.join(root, "src/lib/renewalEnrollment.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error", alias: { "@": path.join(root, "src") } });
const E = await import(pathToFileURL(f).href);

const rows = [
  { scholarIdNumber: "A1", lastName: "Aba", firstName: "Rachel", middleName: "Santos", yearLevel: "3rd Year", program: "BSMA", barangay: "Pagatpat", school: "CU", renewedOn: "2026-11-17" },
  { scholarIdNumber: "A2", lastName: "de la Cruz", firstName: "Juan  Paolo", middleName: "", yearLevel: "Graduate", program: "BSIT", barangay: "", school: "LC", renewedOn: "2026-11-18" },
];
const opts = { batchLabel: "3RD BATCH-NOVEMBER 20, 2026", preparedBy: E.DEFAULT_PREPARED_BY, checkedBy: E.DEFAULT_CHECKED_BY };

check("1 names read 'LAST, FIRST M.' in capitals, the year is a number (3rd Year -> 3), and the date range reads in words (one day, one month, two months, two years)",
  E.endorsementName(rows[0]) === "ABA, RACHEL S." && E.endorsementName(rows[1]) === "DE LA CRUZ, JUAN PAOLO" && E.yearNumber("3rd Year") === 3 && E.yearNumber("Graduate") === null
  && E.rangeLabel("2026-11-17", "2026-11-17") === "NOVEMBER 17, 2026" && E.rangeLabel("2026-11-17", "2026-11-20") === "NOVEMBER 17 - 20, 2026"
  && E.rangeLabel("2026-11-28", "2026-12-02") === "NOVEMBER 28 - DECEMBER 2, 2026" && E.rangeLabel("2026-12-30", "2027-01-02") === "DECEMBER 30, 2026 - JANUARY 2, 2027"
  && E.isDay("2026-02-28") && !E.isDay("2026-02-30") && !E.isDay("17/11/2026")
  && E.defaultBatchLabel("1st Semester", "2026-2027", "2026-11-17", "2026-11-20") === "1ST SEMESTER 2026-2027 - RENEWED NOVEMBER 17 - 20, 2026"
  && E.endorsementFileName("1st Semester", "2026-2027", "2026-11-17", "2026-11-20") === "Allowance-Endorsement-1st-Semester-2026-2027_2026-11-17_to_2026-11-20.xlsx");

const bytes = await E.buildEndorsementXlsx(rows, opts);
const zip = await JSZip.loadAsync(bytes);
const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
const text = [...sheet.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(?:<is><t[^>]*>([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>)/g)].reduce((m, c) => { if (c[2] !== undefined || c[3] !== undefined) m[c[1]] = c[2] !== undefined ? c[2] : Number(c[3]); return m; }, {});
check("2 the file is laid out like the office's allowance endorsement sheet: the title, the batch line, the six headers, one row per scholar (year as a number), and the PREPARED BY / CHECKED BY block",
  text.A1 === "ALLOWANCE ENDORSEMENT" && text.A2 === "3RD BATCH-NOVEMBER 20, 2026" && ["NAME OF SCHOLAR", "YEAR", "COURSE", "BARANGAY", "SCHOOL", "REMARKS"].every((h, i) => text[`${"ABCDEF"[i]}4`] === h)
  && text.A5 === "ABA, RACHEL S." && text.B5 === 3 && text.C5 === "BSMA" && text.D5 === "PAGATPAT" && text.E5 === "CU" && text.F5 === undefined
  && text.A6 === "DE LA CRUZ, JUAN PAOLO" && text.B6 === "Graduate" && text.A8 === "PREPARED BY:" && text.D8 === "CHECKED BY:" && text.A10 === E.DEFAULT_PREPARED_BY.name && text.D10 === E.DEFAULT_CHECKED_BY.name
  && text.A11 === E.DEFAULT_PREPARED_BY.title && text.D12 === E.DEFAULT_CHECKED_BY.unit && /<mergeCell ref="A1:F1"\/>/.test(sheet) && /<pane ySplit="4"/.test(sheet) && /orientation="landscape"/.test(sheet),
  JSON.stringify(Object.entries(text).slice(0, 30)));
const wb = await zip.file("xl/workbook.xml").async("string");
check("3 the sheet is named ALLOWANCE ENDORSEMENT, repeats its header row on every printed page, fits the page width, and a name with & or < is written safely",
  /sheet name="ALLOWANCE ENDORSEMENT"/.test(wb) && /Print_Titles/.test(wb) && /fitToPage="1"/.test(sheet) && /fitToWidth="1"/.test(sheet)
  && (await (async () => { const z = await JSZip.loadAsync(await E.buildEndorsementXlsx([{ ...rows[0], lastName: "A&B <C>" }], opts)); const x = await z.file("xl/worksheets/sheet1.xml").async("string"); return x.includes("A&amp;B &lt;C&gt;, RACHEL S."); })()));

const table = src("src/sead/renewal/RenewalListTable.tsx"), tab = src("src/sead/renewal/RenewalListTab.tsx"), dlg = src("src/sead/renewal/RenewalEnrollmentExportDialog.tsx"), api = src("src/sead/renewalEnrollmentApi.ts");
check("4 the Renewed list has an 'Enrollment confirmation' column of real check boxes (a text next to each, who and when on hover) in the table AND on the phone card; the box changes at once and goes back with the reason if the database refuses; the other lists are untouched",
  /Enrollment confirmation<\/th>/.test(table) && /<input type="checkbox" checked=\{st\.confirmed\}/.test(table) && /Confirmed\$\{st\.confirmedBy/.test(table) && /<EnrollmentBox r=\{r\} col=\{t\.enrollment\} \/>/.test(table) && (table.match(/<EnrollmentBox /g) ?? []).length === 2
  && /const enrollment: EnrollmentColumn \| null = tab === "renewed" \?/.test(tab) && /setEnroll\(m => \(m \? \{ \.\.\.m, \[scholarIdNumber\]: before \} : m\)\); setEnrollError\(r\.error\)/.test(tab) && /setEnrollmentConfirmed\(before\.recordId, next\)/.test(tab)
  && /renewal_enrollment_set/.test(api) && /renewal_enrollment_status/.test(api));
check("5 'Export confirmed enrolled' opens a window with the dates the scholars were RENEWED (from, until, quick dates), the count that will be in the file, an optional line under the title and the Prepared by / Checked by names; it asks the database for the ticked ones in those dates and downloads the .xlsx",
  /Export confirmed enrolled/.test(tab) && /<RenewalEnrollmentExportDialog schoolYear=\{schoolYear\} term=\{term\}/.test(tab) && /Renewed from/.test(dlg) && /Renewed until/.test(dlg) && /Last 7 days/.test(dlg) && /confirmed enrolled will be in the file/.test(dlg)
  && /Prepared by/.test(dlg) && /Checked by/.test(dlg) && /fetchEnrollmentExportRows\(schoolYear, term, from, to\)/.test(dlg) && /buildEndorsementXlsx\(r\.rows/.test(dlg) && /recorded in the export log/.test(dlg) && /renewal_enrollment_export/.test(api));
console.log(`\n${passed} passed`);
