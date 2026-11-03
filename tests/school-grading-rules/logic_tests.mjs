// tests/school-grading-rules/logic_tests.mjs — the rules library (src/lib/gradingRules.ts, the settings part of src/lib/gwa.ts): presets, "Try a grade", passing marks per program, the GWA under
// the school's settings, rounding, where rules start, the history wording.
// Run:  node tests/school-grading-rules/logic_tests.mjs
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gr-logic-"));
const bundle = async (entry, name) => { const outfile = path.join(tmp, name); await build({ entryPoints: [path.join(root, entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "error", absWorkingDir: root, alias: { "@": path.join(root, "src") } }); return import(pathToFileURL(outfile).href); };
const G = await bundle("src/lib/gradingRules.ts", "rules.mjs");
const W = await bundle("src/lib/gwa.ts", "gwa.mjs");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { process.exitCode = 1; console.log(`  FAIL ${name}\n       ${e.message}`); } };

const PH = G.PRESETS.find(p => p.key === "ph-1-5");
const scale = (p = PH) => ({ ...p.scale, letters: p.letters.map(l => ({ ...l })) });
const rules = (p = PH) => ({ entryMode: p.rules.entryMode, passingMarkPct: p.rules.passingMarkPct, programPassing: [], bands: p.rules.bands.map(b => ({ ...b })), gwa: { ...G.DEFAULT_GWA_SETTINGS } });

console.log("The presets");
test("there are four presets: 1.00-5.00, percentage only, 1.0-4.0, letters", () => assert.deepEqual(G.PRESETS.map(p => p.key), ["ph-1-5", "pct-only", "gpa-4", "letters"]));
test("every preset is valid on its own scale", () => { for (const p of G.PRESETS) assert.deepEqual(G.validateRules(rules(p), scale(p)), [], p.label); });
test("the percentage-only preset has no table and sets the scale 60 to 100 (higher is better) with 75 as the passing mark", () => {
  const p = G.PRESETS.find(x => x.key === "pct-only");
  assert.equal(p.rules.bands.length, 0); assert.deepEqual(p.scale, { scaleMin: 60, scaleMax: 100, direction: "higher_is_better" }); assert.equal(p.scalePassingMark, 75);
});
test("the 1.00 to 5.00 preset starts at 97 = 1.00 and has 75 to 76.99 = 3.00 and below 75 = 5.00 Failure", () => {
  const b = G.sortedDesc(PH.rules.bands);
  assert.deepEqual([b[0].from, b[0].equivalentGrade, b[0].remarks], [97, "1.00", "Excellent"]);
  assert.deepEqual([b.at(-2).from, b.at(-2).to, b.at(-2).equivalentGrade], [75, 76.99, "3.00"]); assert.deepEqual([b.at(-1).from, b.at(-1).to, b.at(-1).equivalentGrade, b.at(-1).remarks], [0, 74.99, "5.00", "Failure"]);
});
test("the letters preset brings its own letter table with a number for every letter", () => {
  const p = G.PRESETS.find(x => x.key === "letters");
  assert.deepEqual(p.letters.map(l => l.letter), ["A", "B", "C", "D", "F"]); assert.ok(p.letters.every(l => Number.isFinite(l.numericValue)));
});

console.log("\nTry a grade");
test("87.5 on the 1.00-5.00 preset is 2.00, Good, Passed", () => {
  const r = G.tryPercentage(87.5, rules());
  assert.equal(r.grade, "2.00"); assert.equal(r.remarks, "Good"); assert.equal(r.result, "passed");
});
test("both ends of a row are included, and the two decimals between rows belong to exactly one row", () => {
  assert.equal(G.tryPercentage(94, rules()).grade, "1.25"); assert.equal(G.tryPercentage(96.99, rules()).grade, "1.25"); assert.equal(G.tryPercentage(97, rules()).grade, "1.00");
  assert.equal(G.tryPercentage(74.99, rules()).grade, "5.00"); assert.equal(G.tryPercentage(75, rules()).grade, "3.00"); assert.equal(G.tryPercentage(0, rules()).grade, "5.00"); assert.equal(G.tryPercentage(100, rules()).grade, "1.00");
});
test("equal to the passing mark or higher is Passed; anything below is Failed", () => {
  assert.equal(G.tryPercentage(75, rules()).result, "passed"); assert.equal(G.tryPercentage(74.99, rules()).result, "failed"); assert.equal(G.tryPercentage(100, rules()).result, "passed"); assert.equal(G.tryPercentage(0, rules()).result, "failed");
});
test("a program with its own passing mark is judged by it (85 for Law: 84.99 fails, 85 passes) and the others by the school's (75)", () => {
  const r = rules(); r.programPassing = [{ program: "BS Law", passingPct: 85 }];
  assert.equal(G.tryPercentage(84.99, r, "BS Law").result, "failed"); assert.equal(G.tryPercentage(85, r, "bs law ").result, "passed"); assert.equal(G.tryPercentage(84.99, r, "BS Education").result, "passed"); assert.equal(G.tryPercentage(84.99, r, null).result, "passed");
  assert.equal(G.passingFor("BS Law", r), 85); assert.equal(G.passingFor("Other", r), 75);
});
test("a grade typed without a percentage is judged by its row; a grade not in the table, or rows that disagree, give no answer", () => {
  const r = rules();
  assert.equal(G.resultForGrade("3.00", r, scale()), "passed"); assert.equal(G.resultForGrade("5.00", r, scale()), "failed"); assert.equal(G.resultForGrade("3", r, scale()), "passed"); assert.equal(G.resultForGrade("4.00", r, scale()), null);
  r.programPassing = [{ program: "BS Law", passingPct: 85 }];
  assert.equal(G.resultForGrade("2.50", r, scale(), "BS Law"), "failed"); assert.equal(G.resultForGrade("1.50", r, scale(), "BS Law"), "passed");
});
test("no row for a percentage, or no passing mark, gives no answer", () => {
  assert.equal(G.tryPercentage(50, { ...rules(), bands: [] }), null); assert.equal(G.tryPercentage(80, { ...rules(), passingMarkPct: null }), null);
});

console.log("\nWhere new rules start");
const cur = { schoolYear: "2025-2026", term: "2nd Semester" };
test("an open period that is not submitted: now", () => assert.deepEqual(G.startFor(cur, "open", false), { ...cur, reason: "now" }));
test("an open period that is submitted: the next period", () => assert.deepEqual(G.startFor(cur, "open", true), { schoolYear: "2025-2026", term: "Summer", reason: "period_submitted" }));
test("a period that is not open: the next period", () => assert.deepEqual(G.startFor(cur, "closed", false), { schoolYear: "2025-2026", term: "Summer", reason: "period_not_open" }));
test("the period after: 1st, 2nd, Summer, then the 1st of the next school year", () => {
  assert.deepEqual(G.nextPeriod("2025-2026", "1st Semester"), { schoolYear: "2025-2026", term: "2nd Semester" }); assert.deepEqual(G.nextPeriod("2025-2026", "2nd Semester"), { schoolYear: "2025-2026", term: "Summer" });
  assert.deepEqual(G.nextPeriod("2025-2026", "Summer"), { schoolYear: "2026-2027", term: "1st Semester" });
  assert.ok(G.periodRank("2025-2026", "Summer") < G.periodRank("2026-2027", "1st Semester"));
});

console.log("\nRounding");
test("round normally: 1.005 gives 1.01 (not the 1.00 of the usual floating-point rounding) and 1.7483 gives 1.75", () => {
  assert.equal(G.roundTo(1.005, 2, "round"), 1.01); assert.equal(G.roundTo(1.7483, 2, "round"), 1.75); assert.equal(G.roundTo(1.125, 2, "round"), 1.13); assert.equal(G.roundTo(2.675, 2, "round"), 2.68);
});
test("cut off: 1.7483 gives 1.74 and 1.999 gives 1.99", () => { assert.equal(G.roundTo(1.7483, 2, "cut"), 1.74); assert.equal(G.roundTo(1.999, 2, "cut"), 1.99); assert.equal(G.roundTo(1.7483, 3, "cut"), 1.748); });
test("the GWA as shown keeps the chosen number of decimals, and '—' when there is none", () => {
  assert.equal(G.formatWith(1.5, { decimals: 2, rounding: "round" }), "1.50"); assert.equal(G.formatWith(1.7483, { decimals: 3, rounding: "round" }), "1.748"); assert.equal(G.formatWith(1.7489, { decimals: 4, rounding: "cut" }), "1.7489"); assert.equal(G.formatWith(null, { decimals: 2, rounding: "round" }), "—");
});

console.log("\nThe GWA under the school's settings");
const L = [];      // no letter table
const R = (grade, units, extra = {}) => ({ grade, units, ...extra });
const rows = [R("1.25", 3), R("2.00", 3), R("1.50", 2)];
test("with the default settings the number is the same as the GWA of today (units-weighted)", () => {
  const a = W.gwaWithSettings(rows, L, W.DEFAULT_GWA_SETTINGS), b = W.computeGwa(rows, L);
  assert.equal(a.gwa, b); assert.equal(W.formatWith(a.gwa, W.DEFAULT_GWA_SETTINGS), "1.59"); assert.equal(a.formula, "(1.25×3 + 2.00×3 + 1.50×2) ÷ 8");
});
test("the default settings agree with today's GWA on 2,000 random sets of subjects (weights, blanks, INC, DRP, excluded)", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const n = 1 + Math.floor(rnd() * 6);
    const rs = Array.from({ length: n }, () => { const r = rnd(); return { grade: r < 0.1 ? "INC" : r < 0.15 ? "" : r < 0.2 ? "DRP" : (1 + Math.round(rnd() * 16) * 0.25).toFixed(2), units: rnd() < 0.2 ? null : 1 + Math.floor(rnd() * 5), excludeFromGwa: rnd() < 0.15 }; });
    assert.equal(W.gwaWithSettings(rs, L, W.DEFAULT_GWA_SETTINGS).gwa, W.computeGwa(rs, L));
  }
});
test("simple average: (1.25 + 2.00 + 1.50) ÷ 3 = 1.58", () => {
  const s = { ...W.DEFAULT_GWA_SETTINGS, method: "simple" }, a = W.gwaWithSettings(rows, L, s);
  assert.equal(a.formula, "(1.25 + 2.00 + 1.50) ÷ 3"); assert.equal(W.formatWith(a.gwa, s), "1.58");
});
test("decimals and cutting off: 1.7483 shows 1.748 with 3 decimals and 1.74 when cut off to 2", () => {
  const r = [R("1.7483", 1)];
  assert.equal(W.formatWith(W.gwaWithSettings(r, L, { ...W.DEFAULT_GWA_SETTINGS, decimals: 3 }).gwa, { decimals: 3, rounding: "round" }), "1.748");
  assert.equal(W.formatWith(W.gwaWithSettings(r, L, W.DEFAULT_GWA_SETTINGS).gwa, { decimals: 2, rounding: "cut" }), "1.74");
});
test("failed grades can be left out of the GWA", () => {
  const r = [R("1.50", 3), R("5.00", 3, { failed: true })];
  assert.equal(W.gwaWithSettings(r, L, W.DEFAULT_GWA_SETTINGS).gwa, 3.25); assert.equal(W.gwaWithSettings(r, L, { ...W.DEFAULT_GWA_SETTINGS, includeFailed: false }).gwa, 1.5);
  assert.equal(W.gwaWithSettings(r, L, { ...W.DEFAULT_GWA_SETTINGS, includeFailed: false }).lines[1].reason, "failed");
});
test("a special mark can count as a number (DRP as 5.00); without that setting it is left out", () => {
  const r = [R("1.50", 3), R("DRP", 3)];
  assert.equal(W.gwaWithSettings(r, L, W.DEFAULT_GWA_SETTINGS).gwa, 1.5);
  const s = { ...W.DEFAULT_GWA_SETTINGS, specialValues: { DRP: 5 } }, a = W.gwaWithSettings(r, L, s);
  assert.equal(a.gwa, 3.25); assert.equal(a.lines[1].reason, "special");
  assert.equal(W.gwaWithSettings(r.map(x => ({ ...x, grade: x.grade === "DRP" ? "drp" : x.grade })), L, s).gwa, 3.25);
});
test("a special mark that counts as a number is still a failed subject when failed grades are left out", () => {
  const s = { ...W.DEFAULT_GWA_SETTINGS, specialValues: { DRP: 5 }, includeFailed: false };
  assert.equal(W.gwaWithSettings([R("1.50", 3), R("DRP", 3, { failed: true })], L, s).gwa, 1.5);
});
test("the percentage can be the grade used: subjects without a percentage are left out", () => {
  const s = { ...W.DEFAULT_GWA_SETTINGS, gradeUsed: "percentage" };
  const a = W.gwaWithSettings([R("1.50", 3, { percentage: 92 }), R("2.00", 3, { percentage: 86 }), R("1.00", 3, { percentage: null })], L, s);
  assert.equal(a.gwa, 89); assert.equal(a.lines[2].reason, "no_number");
});
test("a subject excluded from the GWA is left out, and still counts when it has no units as 1 unit", () => {
  const a = W.gwaWithSettings([R("1.00", 3), R("3.00", 3, { excludeFromGwa: true }), R("2.00", null)], L, W.DEFAULT_GWA_SETTINGS);
  assert.equal(a.gwa, (1 * 3 + 2 * 1) / 4); assert.equal(a.lines[1].reason, "excluded");
});
test("a letter grade resolves through the letter table", () => assert.equal(W.gwaWithSettings([R("A", 3), R("C", 3)], [{ letter: "A", numericValue: 4 }, { letter: "C", numericValue: 2 }], W.DEFAULT_GWA_SETTINGS).gwa, 3));
test("nothing counts: no GWA", () => assert.equal(W.gwaWithSettings([R("INC", 3)], L, W.DEFAULT_GWA_SETTINGS).gwa, null));

console.log("\nThe sample computation");
test("it uses a few passed rows of the school's own table, one failed row, and writes the working", () => {
  const subjects = G.sampleSubjects(rules(), scale());
  assert.ok(subjects.length >= 3 && subjects.length <= 5);
  assert.ok(subjects.some(s => s.grade === "5.00")); assert.ok(subjects.some(s => s.grade === "1.00"));
  const out = G.sampleComputation(subjects, scale(), W.DEFAULT_GWA_SETTINGS, s => G.resultForGrade(s.grade, rules(), scale()) ?? "other");
  assert.ok(out.text.includes("÷") && out.text.includes("=")); assert.ok(out.gwa > 1 && out.gwa < 4);
});
test("with the failed grades left out, the failed sample subject is shown as left out and the number goes up", () => {
  const subjects = G.sampleSubjects(rules(), scale()), judge = s => G.resultForGrade(s.grade, rules(), scale()) ?? "other";
  const withFailed = G.sampleComputation(subjects, scale(), W.DEFAULT_GWA_SETTINGS, judge), without = G.sampleComputation(subjects, scale(), { ...W.DEFAULT_GWA_SETTINGS, includeFailed: false }, judge);
  assert.ok(without.gwa < withFailed.gwa); assert.ok(without.lines.some(l => /Failed, left out/.test(l.note)));
});
test("the working changes with the settings: simple average, and the percentages when the GWA uses them", () => {
  const subjects = G.sampleSubjects(rules(), scale()), judge = () => "other";
  assert.ok(!G.sampleComputation(subjects, scale(), { ...W.DEFAULT_GWA_SETTINGS, method: "simple" }, judge).formula.includes("×"));
  assert.ok(G.sampleComputation(subjects, scale(), { ...W.DEFAULT_GWA_SETTINGS, gradeUsed: "percentage" }, judge).lines.every(l => l.shown.endsWith("%")));
});
test("a school with no table gets sample grades from its scale; one with a special mark counted as a number gets that mark as a sample subject", () => {
  const empty = { ...rules(), bands: [], passingMarkPct: null }; assert.ok(G.sampleSubjects(empty, scale()).length >= 3);
  const withDrp = rules(); withDrp.gwa.specialValues = { DRP: 5 }; assert.ok(G.sampleSubjects(withDrp, scale()).some(s => s.grade === "DRP"));
});

console.log("\nThe history in words");
test("the first save, and what changed", () => {
  assert.deepEqual(G.describeChanges(null, rules()), ["First rules saved."]);
  const a = rules(), b = rules(); b.passingMarkPct = 76; b.gwa.method = "simple"; b.gwa.decimals = 3; b.programPassing = [{ program: "BS Law", passingPct: 85 }];
  const t = G.describeChanges(a, b).join("|");
  assert.ok(t.includes("Passing mark: 75 → 76") && t.includes("GWA method: units-weighted → simple average") && t.includes("GWA decimals: 2 → 3") && t.includes("BS Law 85"));
  assert.deepEqual(G.describeChanges(a, rules()), ["No change in the rules."]);
});

const I = await bundle("src/lib/gradingImpact.ts", "impact.mjs");
console.log("\nHow many grades and GWAs would change");
const cfg = { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3, retentionThreshold: null };
const scholars = [{ scholarIdNumber: "S1", program: "BS Test" }, { scholarIdNumber: "S2", program: "BS Law" }, { scholarIdNumber: "S3", program: "BS Test" }];
const g = (id, grade, units = 3) => ({ scholarIdNumber: id, grade, units });
test("with no earlier rules, rules that agree with today (passing 3.00 = 75%) change nothing", () => {
  const grades = [g("S1", "1.50"), g("S1", "3.00"), g("S2", "5.00"), g("S3", "2.25")];
  assert.deepEqual(I.computeImpact(scholars, grades, cfg, [], scale(), null, rules()), { gradesChecked: 4, gradesChanged: 0, gradesNotInTable: 0, gwasChanged: 0, scholarsAffected: 0 });
});
test("a program with a higher passing mark turns some Passed grades into Failed, and the scholar is counted once", () => {
  const after = rules(); after.programPassing = [{ program: "BS Law", passingPct: 85 }];
  const i = I.computeImpact(scholars, [g("S2", "2.25"), g("S2", "1.50"), g("S2", "3.00"), g("S1", "3.00")], cfg, [], scale(), null, after);
  assert.equal(i.gradesChanged, 2); assert.equal(i.scholarsAffected, 1);
});
test("a different GWA setting changes the GWAs that show differently (simple average, 3 decimals)", () => {
  const grades = [g("S1", "1.25", 3), g("S1", "2.00", 2), g("S3", "1.50", 3), g("S3", "1.50", 1)];
  const after = rules(); after.gwa.method = "simple";
  const i = I.computeImpact(scholars, grades, cfg, [], scale(), null, after);
  assert.equal(i.gwasChanged, 1); assert.equal(i.gradesChanged, 0); assert.equal(i.scholarsAffected, 1);
  const after3 = rules(); after3.gwa.decimals = 3; assert.ok(I.computeImpact(scholars, grades, cfg, [], scale(), null, after3).gwasChanged >= 1);
});
test("the same rules before and after change nothing", () => assert.equal(I.computeImpact(scholars, [g("S1", "1.25"), g("S2", "4.00")], cfg, [], scale(), rules(), rules()).scholarsAffected, 0));
test("a grade the new table has no row for is counted as not in the table; INC and DRP keep their meaning and are not", () => {
  const i = I.computeImpact(scholars, [g("S1", "4.00"), g("S1", "INC"), g("S3", "DRP")], cfg, [], scale(), null, rules());
  assert.equal(i.gradesNotInTable, 1); assert.equal(i.gradesChanged, 0);
});
test("blank grades are not looked at; no grades at all gives the plain sentence", () => {
  const i = I.computeImpact(scholars, [g("S1", ""), g("S3", "  ")], cfg, [], scale(), null, rules());
  assert.equal(i.gradesChecked, 0); assert.match(I.impactText(i), /no grades yet/);
  assert.match(I.impactText({ gradesChecked: 10, gradesChanged: 1, gradesNotInTable: 2, gwasChanged: 3, scholarsAffected: 3 }), /1 grade would change.*3 GWAs would change.*out of 10 grades.*3 scholars affected.*2 grades are not in the conversion table/);
});

const D = await bundle("src/lib/gradingRulesData.ts", "data.mjs");
console.log("\nWhat the school types, and what the database gives back");
test("typed boxes become rules and back again without losing anything (rows come back from the highest percentage)", () => {
  const r = rules(); r.programPassing = [{ program: "BS Law", passingPct: 85 }]; r.gwa.specialValues = { DRP: 5 }; r.gwa.excludedCodes = ["NSTP", "PE"]; r.gwa.retentionThreshold = 2.5; r.gwa.decimals = 3;
  const back = D.rulesFromDraft(D.draftFromRules(r));
  assert.ok(D.sameRules(r, back)); assert.deepEqual(back.gwa.excludedCodes, ["NSTP", "PE"]); assert.equal(back.gwa.specialValues.DRP, 5); assert.equal(back.gwa.retentionThreshold, 2.5);
});
test("numbers typed with a comma are read; a blank or a word is not a number (the checks then say what is wrong)", () => {
  assert.equal(D.parseNum("75,5"), 75.5); assert.ok(Number.isNaN(D.parseNum(""))); assert.ok(Number.isNaN(D.parseNum("abc"))); assert.ok(Number.isNaN(D.parseNum("-3")));
  const d = D.draftFromRules(rules()); d.bands[0].from = "x";
  assert.equal(G.validateRules(D.rulesFromDraft(d), scale())[0].code, "band_range");
});
test("rows sort from the highest percentage; a row without a percentage yet stays below the others", () => {
  const d = D.draftFromRules(null); const k = D.newKey;
  const sorted = D.sortBandDrafts([{ key: k(), from: "", to: "", grade: "", remarks: "" }, { key: k(), from: "10", to: "20", grade: "", remarks: "" }, { key: k(), from: "50", to: "60", grade: "", remarks: "" }]);
  assert.deepEqual(sorted.map(b => b.from), ["50", "10", ""]); assert.equal(d.bands.length, 0);
});
test("the blank draft equals no rules; changing one thing makes it different; the order the rows were typed in does not matter", () => {
  assert.ok(D.sameRules(D.rulesFromDraft(D.draftFromRules(null)), G.EMPTY_RULES));
  const a = rules(), b = rules(); b.bands.reverse(); assert.ok(D.sameRules(a, b)); b.bands[0].remarks = "Changed"; assert.ok(!D.sameRules(a, b));
});
test("the database's answer is read into the same shapes: version, bands with their result, audit with old and new rules", () => {
  const ov = D.parseOverview({ schoolId: "s", schoolName: "X", currentPeriod: { schoolYear: "2025-2026", term: "2nd Semester", status: "open", submitted: false }, startsAt: { schoolYear: "2025-2026", term: "2nd Semester", reason: "now" },
    scale: { scaleMin: 1, scaleMax: 5, direction: "lower_is_better", usesLetterGrades: false, passingMark: 3, retentionThreshold: null, letters: [] }, marks: ["F"],
    latest: { id: "v", versionNo: 2, effectiveYear: "2025-2026", effectiveTerm: "2nd Semester", createdAt: "2026-11-04T00:00:00Z", createdByLabel: "u", note: null,
      rules: { entryMode: "either", passingMarkPct: 75, programPassing: [{ program: "BS Law", passingPct: 85 }], bands: [{ from: 75, to: 100, equivalentGrade: "3.00", equivalentValue: 3, remarks: "Passing", result: "passed" }, { from: 0, to: 74.99, equivalentGrade: "5.00", equivalentValue: 5, remarks: "Failure", result: "failed" }], gwa: { method: "simple", gradeUsed: "equivalent", decimals: 3, rounding: "cut", includeFailed: false, specialValues: { DRP: 5 }, excludedCodes: ["NSTP"], retentionThreshold: 2.5 } } },
    active: null, versions: [{ id: "v", versionNo: 2, effectiveYear: "2025-2026", effectiveTerm: "2nd Semester", createdAt: "x", createdByLabel: "u", bandCount: 2 }],
    audit: [{ id: 5, changedAt: "x", changedByLabel: "u", effectiveYear: "2025-2026", effectiveTerm: "2nd Semester", versionNo: 2, note: "n", oldRules: null, newRules: { entryMode: "grade", bands: [], gwa: {} }, impact: { gradesChanged: 1 } }] });
  assert.equal(ov.startsAt.reason, "now"); assert.equal(ov.latest.rules.bands[0].result, "passed"); assert.equal(ov.latest.rules.gwa.decimals, 3); assert.equal(ov.latest.rules.gwa.includeFailed, false); assert.equal(ov.active, null);
  assert.equal(ov.audit[0].oldRules, null); assert.equal(ov.audit[0].newRules.gwa.decimals, 2); assert.equal(ov.audit[0].impact.gradesChanged, 1); assert.deepEqual(ov.marks, ["F"]);
  assert.equal(D.parseVersion(null), null);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
