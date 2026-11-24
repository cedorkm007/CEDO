// tests/academic-scholar-overrides/web_tests.mjs — the template, the reading of the file and the words of the review (3 checks)
// Run:  node tests/academic-scholar-overrides/web_tests.mjs        No database or browser needed.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = rel => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
let passed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { process.exitCode = 1; console.log(`  FAIL ${name} ${extra}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aso-"));
const f = path.join(tmp, "a.mjs");
await build({ entryPoints: [path.join(root, "src/lib/academicBulk.ts")], bundle: true, format: "esm", platform: "node", outfile: f, logLevel: "error" });
const A = await import(pathToFileURL(f).href);

const grid = [
  ["Academic status", "Scholar ID", "Program", "School", "Full name", "", "How to fill this in"],
  ["Non-academic", "EXAMPLE-0001 (delete this row)", "BS Nursing", "School", "Juan", "", "Scholar ID: required"],
  ["Non-academic", "2507-00459", "BSEE", "Cagayan De Oro College PHINMA", "CATARONG, RHEYMER JAY", "", ""],
  ["", "", "", "", "", "", "Writing the status the program already has…"],
  ["Academic", "2507-00460", "", "", "", "", ""],
];
const p = A.parseAcademicBulkGrid(grid);
const noId = A.parseAcademicBulkGrid([["Full name", "School"], ["a", "b"]]);
check("1 the template has the columns Scholar ID, Full name, School, Program and Academic status (with an example row and the instructions beside the table); a file is read by column name in any order; the example row and the text beside the table are left out; a missing Scholar ID or status column gets a clear message",
  A.ACADEMIC_BULK_HEADERS.join("|") === "Scholar ID|Full name|School|Program|Academic status" && A.ACADEMIC_BULK_EXAMPLE.length === 5 && A.ACADEMIC_BULK_INSTRUCTIONS.length >= 5
  && p.headerError === "" && p.skippedExample === 1 && p.rows.length === 2 && p.rows[0].scholar_id === "2507-00459" && p.rows[0].name === "CATARONG, RHEYMER JAY" && p.rows[0].school === "Cagayan De Oro College PHINMA" && p.rows[0].program === "BSEE" && p.rows[0].status === "Non-academic" && p.rows[0].i === 3
  && /Scholar ID/.test(noId.headerError) && /Academic status/.test(noId.headerError) && noId.rows.length === 0, JSON.stringify(p.rows));

const checked = [
  { i: 2, state: "valid", action: "set", newStatus: "non_academic" }, { i: 3, state: "warning", action: "reset", newStatus: "academic" }, { i: 4, state: "warning", action: "skip", newStatus: "academic" }, { i: 5, state: "error", action: "none", newStatus: null },
];
const t = A.academicBulkTotals(checked);
check("2 the review says what will happen to each row (own status set to Non-academic / taken away / no change / will not be changed) and counts them (1 valid, 2 warnings, 1 error; 1 set, 1 taken away, 1 no change); the summary reads '45 set, 3 taken away, 2 unchanged, 1 error'",
  A.actionText(checked[0]) === "Own status: Non-academic" && /taken away/.test(A.actionText(checked[1])) && A.actionText(checked[2]) === "No change" && A.actionText(checked[3]) === "Will not be changed"
  && t.valid === 1 && t.warning === 2 && t.error === 1 && t.willSet === 1 && t.willReset === 1 && t.noChange === 1 && A.academicSummaryText(45, 3, 2, 1) === "45 set, 3 taken away, 2 unchanged, 1 error" && A.statusLabel("non_academic") === "Non-academic");

const sub = src("src/sead/pages/ScholarsGradesAcademicSubtab.tsx"), panel = src("src/sead/components/AcademicBulkPanel.tsx"), api = src("src/sead/academicBulkApi.ts");
check("3 'Set a scholar's academic status by file' is in Grades and Academic Management with Download template, Download the current list and Choose file; the file is checked first (nothing saved) and saved second in chunks of 500; the database does the matching by Scholar ID; before the database update it says what to run",
  sub.includes("<AcademicBulkPanel />") && panel.includes("Download template") && panel.includes("Download the current list") && panel.includes("checkAcademicBulk(parsed.rows)") && panel.includes("saveAcademicBulk(ready.slice(at, at + ACADEMIC_BULK_SAVE_CHUNK))") && panel.includes("ACADEMIC_BULK_SQL")
  && api.includes('"academic_bulk_check"') && api.includes('"academic_bulk_save"') && api.includes('"academic_overrides_list"') && A.ACADEMIC_BULK_SAVE_CHUNK === 500);
console.log(`\n${passed} passed`);
