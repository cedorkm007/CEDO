// tests/school-grading-rules/parity_tests.mjs — the screen's checks (validateRules in src/lib/gradingRules.ts) and the database's checks (_grading_rules_check) must give the SAME first problem
// for the same rules, so what the school sees before saving is exactly what the database enforces.
// Run:  node tests/school-grading-rules/parity_tests.mjs
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { buildDb } from "../../localdemo/build.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gr-parity-"));
const outfile = path.join(tmp, "rules.mjs");
await build({ entryPoints: [path.join(root, "src/lib/gradingRules.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } });
const G = await import(pathToFileURL(outfile).href);

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); } };
const { db } = await buildDb({ dataDir: "memory://", writeReport: false });
const read = f => fs.readFileSync(f, "utf8");
await db.exec(read("supabase_migration_school_grading_rules_a_tables.sql"));
await db.exec(read("supabase_migration_school_grading_rules_c_functions.sql"));

const PH = G.PRESETS.find(p => p.key === "ph-1-5");
const scaleOf = p => ({ ...p.scale, letters: p.letters.map(l => ({ letter: l.letter, numericValue: l.numericValue })) });
const rulesOf = p => ({ entryMode: p.rules.entryMode, passingMarkPct: p.rules.passingMarkPct, programPassing: [], bands: p.rules.bands.map(b => ({ ...b })), gwa: { ...G.DEFAULT_GWA_SETTINGS } });
const base = () => rulesOf(PH);
const baseScale = () => scaleOf(PH);
const mut = (fn) => { const r = base(); fn(r); return r; };
const bandAt = (r, grade) => r.bands.find(b => b.equivalentGrade === grade);

const cases = [];
const add = (name, rules, expect, extra = {}) => cases.push({ name, rules, expect, scale: extra.scale ?? baseScale(), marks: extra.marks ?? [] });

for (const p of G.PRESETS) add(`preset "${p.label}" is valid`, rulesOf(p), null, { scale: scaleOf(p) });
add("no table, grades entered as grades: fine", { ...base(), bands: [], passingMarkPct: null, entryMode: "grade" }, null);
add("percentage entry without a table", { ...base(), bands: [], passingMarkPct: null, entryMode: "percentage" }, "needs_table");
add("a program's own passing mark without a table", { ...base(), bands: [], passingMarkPct: null, entryMode: "grade", programPassing: [{ program: "BS Law", passingPct: 80 }] }, "needs_table_program");
add("unknown entry mode", mut(r => { r.entryMode = "x"; }), "entry_mode");
add("41 rows", mut(r => { r.bands = Array.from({ length: 41 }, (_, i) => ({ from: i, to: i, equivalentGrade: "3.00", remarks: "x" })); }), "too_many_rows");
add("a row with From above To", mut(r => { bandAt(r, "3.00").from = 76.99; bandAt(r, "3.00").to = 75; }), "band_range");
add("a percentage above 100", mut(r => { bandAt(r, "1.00").to = 101; }), "band_range");
add("three decimals", mut(r => { bandAt(r, "1.25").from = 94.005; }), "band_range");
add("two rows overlap", mut(r => { bandAt(r, "1.25").from = 93; }), "overlap");
add("a gap (74.99 to 75 missing)", mut(r => { bandAt(r, "3.00").from = 75.5; }), "gap");
add("the lowest row does not start at 0", mut(r => { bandAt(r, "5.00").from = 10; }), "starts_at_zero");
add("the highest row does not end at 100", mut(r => { bandAt(r, "1.00").to = 99; }), "ends_at_hundred");
add("empty remarks", mut(r => { bandAt(r, "2.00").remarks = "  "; }), "remarks_empty");
add("empty equivalent grade", mut(r => { bandAt(r, "2.00").equivalentGrade = ""; }), "equivalent_empty");
add("equivalent grade off the scale", mut(r => { bandAt(r, "2.00").equivalentGrade = "6.00"; }), "equivalent_off_scale");
add("a letter that is not in the letter table", mut(r => { bandAt(r, "2.00").equivalentGrade = "Z"; }), "equivalent_off_scale");
add("a letter with no number", mut(r => { bandAt(r, "2.00").equivalentGrade = "B"; }), "letter_no_number", { scale: { ...baseScale(), letters: [{ letter: "B", numericValue: null }] } });
add("a letter with a number is fine", mut(r => { bandAt(r, "2.00").equivalentGrade = "B"; }), null, { scale: { ...baseScale(), letters: [{ letter: "B", numericValue: 2 }] } });
add("the grade gets worse as the percentage goes up", mut(r => { bandAt(r, "1.50").equivalentGrade = "2.50"; }), "direction");
add("two rows share a grade on the same side: fine", mut(r => { bandAt(r, "1.25").equivalentGrade = "1.00"; }), null);
add("passing mark missing", mut(r => { r.passingMarkPct = null; }), "passing_missing");
add("passing mark 0", mut(r => { r.passingMarkPct = 0; }), "passing_range");
add("passing mark 101", mut(r => { r.passingMarkPct = 101; }), "passing_range");
add("passing mark inside a row (80 is inside 79 to 81.99)", mut(r => { r.passingMarkPct = 80; }), "passing_straddle");
add("a program with its own passing mark on a row start: fine", mut(r => { r.programPassing = [{ program: "BS Law", passingPct: 85 }]; }), null);
add("a program with no name", mut(r => { r.programPassing = [{ program: " ", passingPct: 85 }]; }), "program_empty");
add("a program listed twice", mut(r => { r.programPassing = [{ program: "BS Law", passingPct: 85 }, { program: "bs law ", passingPct: 88 }]; }), "program_duplicate");
add("a program passing mark above 100", mut(r => { r.programPassing = [{ program: "BS Law", passingPct: 120 }]; }), "program_range");
add("a program passing mark inside a row", mut(r => { r.programPassing = [{ program: "BS Law", passingPct: 80 }]; }), "program_straddle");
add("two rows with the same grade but a different result", mut(r => { bandAt(r, "3.00").equivalentGrade = "5.00"; }), "same_grade_result");
add("GWA: unknown method", mut(r => { r.gwa.method = "x"; }), "gwa_method");
add("GWA: unknown grade used", mut(r => { r.gwa.gradeUsed = "x"; }), "gwa_grade_used");
add("GWA: 5 decimals", mut(r => { r.gwa.decimals = 5; }), "gwa_decimals");
add("GWA: unknown rounding", mut(r => { r.gwa.rounding = "x"; }), "gwa_rounding");
add("GWA from percentages while only grades are entered", mut(r => { r.entryMode = "grade"; r.gwa.gradeUsed = "percentage"; }), "gwa_percent_needs_percentage");
add("GWA from percentages with percentage entry: fine", mut(r => { r.entryMode = "percentage"; r.gwa.gradeUsed = "percentage"; r.gwa.retentionThreshold = 85; }), null);
add("retention requirement off the scale", mut(r => { r.gwa.retentionThreshold = 9; }), "retention_range");
add("retention requirement as a percentage is off the 1-5 scale", mut(r => { r.gwa.retentionThreshold = 85; }), "retention_range");
add("special mark: DRP counts as 5", mut(r => { r.gwa.specialValues = { DRP: 5 }; }), null);
add("special mark that is not one of the school's marks", mut(r => { r.gwa.specialValues = { W: 5 }; }), "special_unknown");
add("special mark that the school added: fine", mut(r => { r.gwa.specialValues = { F: 5 }; }), null, { marks: ["f"] });
add("special mark off the scale", mut(r => { r.gwa.specialValues = { DRP: 9 }; }), "special_value");
add("special mark that is a number", mut(r => { r.gwa.specialValues = { "3": 3 }; }), "special_key");
add("excluded subject codes: fine", mut(r => { r.gwa.excludedCodes = ["NSTP", " pe "]; }), null);
add("an excluded code listed twice", mut(r => { r.gwa.excludedCodes = ["NSTP", "nstp"]; }), "excluded_code");
add("an excluded code with a space", mut(r => { r.gwa.excludedCodes = ["N STP"]; }), "excluded_code");

console.log("The same first problem on the screen and in the database");
for (const c of cases) {
  const problems = G.validateRules(c.rules, c.scale, c.marks);
  const ts = problems.length ? problems[0].code : null;
  const lettersJson = JSON.stringify(c.scale.letters ?? []);
  const sql = (await db.query("select code from public._grading_rules_check($1::jsonb, $2::numeric, $3::numeric, $4, $5::jsonb, $6::text[]) limit 1", [JSON.stringify(c.rules), c.scale.scaleMin, c.scale.scaleMax, c.scale.direction, lettersJson, c.marks]));
  const dbCode = sql.rows.length ? sql.rows[0].code : null;
  check(`${c.name}: ${c.expect ?? "valid"}`, ts === c.expect && dbCode === c.expect, `screen=${ts} database=${dbCode} expected=${c.expect}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
fs.rmSync(tmp, { recursive: true, force: true });
await db.close?.();
