// ─────────────────────────────────────────────────────────────
// src/lib/gradingRules.ts
// A school's grading RULES: the conversion table (percentage bands), the passing mark (and the programs that have their own), how grades are entered, and the GWA settings.
// Pure (no Supabase, no React), shared by the School Portal's Grading System tab, the staff read-only view and, in Phase 2, grade entry and the pass/fail checks.
//
// The rules are saved as numbered versions that start at a school year and semester (supabase_migration_school_grading_rules_*.sql). The DATABASE checks every save again with
// the same rules as validateRules() below, in the same order (_grading_rules_check); tests/school-grading-rules runs the same cases against both so they cannot drift apart.
//
// How a result is decided: the school sets a passing mark (a percentage). A percentage equal to the passing mark or higher is Passed; anything below is Failed. A program may have its own.
// Remarks are the school's own words and never decide anything. There is no "Conditional": a row is Passed or Failed by the passing mark.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_GWA_SETTINGS, type GwaSettings, gwaWithSettings, formatWith, roundTo } from "./gwa";
export { DEFAULT_GWA_SETTINGS, formatWith, roundTo };
export type { GwaSettings };

export type EntryMode = "grade" | "percentage" | "either";
export const ENTRY_MODE_LABEL: Record<EntryMode, string> = {
  grade: "The equivalent grade (as today)",
  percentage: "The percentage (the system fills in the grade)",
  either: "Either: the percentage or the grade",
};

export interface GradeBand { from: number; to: number; equivalentGrade: string; remarks: string }
export interface ProgramPassing { program: string; passingPct: number }

export interface GradingRules {
  entryMode: EntryMode;
  /** The school's passing mark in percent. Only used when there is a conversion table. */
  passingMarkPct: number | null;
  programPassing: ProgramPassing[];
  bands: GradeBand[];
  gwa: GwaSettings;
}
export const EMPTY_RULES: GradingRules = { entryMode: "grade", passingMarkPct: null, programPassing: [], bands: [], gwa: { ...DEFAULT_GWA_SETTINGS } };

/** The school's scale, as saved in the Grading System tab. */
export interface RuleScale {
  scaleMin: number; scaleMax: number; direction: "lower_is_better" | "higher_is_better";
  /** The school's letter table (only when it uses letter grades). */
  letters: { letter: string; numericValue: number | null }[];
}

// ── Small helpers ─────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2);
const DEC2 = /^\d+(\.\d{1,2})?$/;
const NUM = /^\d+(\.\d+)?$/;
export const MAX_BANDS = 40;
const norm = (s: string) => s.trim().toLowerCase();

/** The number an equivalent grade stands for on the school's scale: the number itself, or a letter's number. */
export function equivalentValue(grade: string, scale: RuleScale): { value: number | null; problem: "off_scale" | "letter_no_number" | null } {
  const g = grade.trim();
  if (NUM.test(g)) { const v = Number(g); return v >= scale.scaleMin && v <= scale.scaleMax ? { value: v, problem: null } : { value: null, problem: "off_scale" }; }
  const l = scale.letters.find(x => norm(x.letter) === norm(g));
  if (!l) return { value: null, problem: "off_scale" };
  return l.numericValue == null ? { value: null, problem: "letter_no_number" } : { value: l.numericValue, problem: null };
}

const isPct = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100 && DEC2.test(String(n));
export const sortedDesc = (bands: GradeBand[]): GradeBand[] => [...bands].sort((a, b) => b.from - a.from || b.to - a.to);

export interface GradingProblem {
  /** A short code the database uses too (the first problem's code must match). */
  code: string;
  message: string;
  /** The row it is about, counting from 1 at the top (highest percentage). */
  row?: number;
  program?: string;
}

/**
 * Everything that is wrong with a set of rules, in the order the database checks it. Empty = fine to save.
 * `knownMarks`: the school's own other marks (F, D/F …); INC and DRP are always known.
 */
export function validateRules(rules: GradingRules, scale: RuleScale, knownMarks: string[] = []): GradingProblem[] {
  const out: GradingProblem[] = [];
  const add = (code: string, message: string, extra: Partial<GradingProblem> = {}) => out.push({ code, message, ...extra });
  const bands = rules.bands;

  if (!["grade", "percentage", "either"].includes(rules.entryMode)) { add("entry_mode", "Choose how grades are entered."); return out; }
  if (bands.length > MAX_BANDS) { add("too_many_rows", `A conversion table can have at most ${MAX_BANDS} rows.`); return out; }

  if (bands.length === 0) {
    if (rules.entryMode !== "grade") add("needs_table", "Entering percentages needs a conversion table. Add the table, or choose that grades are entered as the equivalent grade.");
    else if (rules.programPassing.length > 0) add("needs_table_program", "A program's own passing mark needs a conversion table. Add the table first.");
  } else {
    // 1. every row has a valid percentage range (row numbers here are the order given)
    let rangeOk = true;
    bands.forEach((b, idx) => {
      if (!isPct(b.from) || !isPct(b.to)) { add("band_range", `Row ${idx + 1}: both percentages must be numbers from 0 to 100 with at most 2 decimals.`, { row: idx + 1 }); rangeOk = false; }
      else if (b.from > b.to) { add("band_range", `Row ${idx + 1}: From (${fmt(b.from)}) must not be higher than To (${fmt(b.to)}).`, { row: idx + 1 }); rangeOk = false; }
    });
    if (!rangeOk) return out;

    const desc = sortedDesc(bands);
    const rowOf = (b: GradeBand) => desc.indexOf(b) + 1;
    const asc = [...desc].reverse();

    // 2. no overlap, no gap, from 0 to 100
    for (let k = 1; k < asc.length; k++) {
      const prev = asc[k - 1], next = asc[k];
      if (next.from <= prev.to + 1e-9) add("overlap", `Rows ${rowOf(next)} and ${rowOf(prev)} overlap (${fmt(next.from)} to ${fmt(next.to)} and ${fmt(prev.from)} to ${fmt(prev.to)}).`, { row: rowOf(next) });
      else if (next.from - prev.to > 0.01 + 1e-9) add("gap", `There is a gap between row ${rowOf(next)} (from ${fmt(next.from)}) and row ${rowOf(prev)} (to ${fmt(prev.to)}): ${fmt(prev.to + 0.01)} to ${fmt(next.from - 0.01)} has no row.`, { row: rowOf(next) });
    }
    if (asc[0].from > 1e-9) add("starts_at_zero", `The lowest row (row ${rowOf(asc[0])}) must start at 0.00 so that every percentage has a row.`, { row: rowOf(asc[0]) });
    if (asc[asc.length - 1].to < 100 - 1e-9) add("ends_at_hundred", `The highest row (row ${rowOf(asc[asc.length - 1])}) must end at 100.00 so that every percentage has a row.`, { row: rowOf(asc[asc.length - 1]) });
    if (out.length > 0) return out;

    // 3. each row: remarks, equivalent grade on the scale
    const values = new Map<GradeBand, number>();
    desc.forEach((b, idx) => {
      if (!b.remarks.trim()) add("remarks_empty", `Row ${idx + 1} (${fmt(b.from)} to ${fmt(b.to)}): the remarks cannot be empty.`, { row: idx + 1 });
      if (!b.equivalentGrade.trim()) { add("equivalent_empty", `Row ${idx + 1} (${fmt(b.from)} to ${fmt(b.to)}): enter the equivalent grade.`, { row: idx + 1 }); return; }
      const v = equivalentValue(b.equivalentGrade, scale);
      if (v.problem === "letter_no_number") add("letter_no_number", `Row ${idx + 1}: the letter "${b.equivalentGrade.trim()}" has no number in your letter table. Give it a number first.`, { row: idx + 1 });
      else if (v.problem === "off_scale") add("equivalent_off_scale", `Row ${idx + 1}: "${b.equivalentGrade.trim()}" is not on your grading scale (${scale.scaleMin} to ${scale.scaleMax}) or in your letter table.`, { row: idx + 1 });
      else if (v.value !== null) values.set(b, v.value);
    });
    if (out.length > 0) return out;

    // 4. the grade must not get worse as the percentage goes up
    for (let k = 1; k < asc.length; k++) {
      const a = values.get(asc[k - 1])!, c = values.get(asc[k])!;
      const worse = scale.direction === "lower_is_better" ? c > a : c < a;
      if (worse) add("direction", `Row ${rowOf(asc[k])} (${fmt(asc[k].from)} to ${fmt(asc[k].to)}) has a worse grade (${asc[k].equivalentGrade.trim()}) than row ${rowOf(asc[k - 1])} (${asc[k - 1].equivalentGrade.trim()}) although its percentage is higher. On your scale ${scale.direction === "lower_is_better" ? "a lower" : "a higher"} grade is better.`, { row: rowOf(asc[k]) });
    }
    if (out.length > 0) return out;

    // 5. the passing mark: the school's, and the programs that have their own. A row must not contain a passing mark inside it.
    const p = rules.passingMarkPct;
    if (p == null || !Number.isFinite(p)) add("passing_missing", "Enter the passing mark (a percentage).");
    else if (!(p > 0 && p <= 100) || !DEC2.test(String(p))) add("passing_range", "The passing mark must be a percentage above 0 and up to 100, with at most 2 decimals.");
    else {
      const strad = desc.find(b => b.from < p && p <= b.to);
      if (strad) add("passing_straddle", `The passing mark ${fmt(p)} falls inside row ${rowOf(strad)} (${fmt(strad.from)} to ${fmt(strad.to)}). Split that row so one row starts at ${fmt(p)}.`, { row: rowOf(strad) });
    }
    const seen = new Set<string>();
    rules.programPassing.forEach(pp => {
      const name = pp.program.trim();
      if (!name) { add("program_empty", "A program with its own passing mark needs the program's name.", {}); return; }
      if (seen.has(norm(name))) { add("program_duplicate", `The program "${name}" is listed twice.`, { program: name }); return; }
      seen.add(norm(name));
      if (!(pp.passingPct > 0 && pp.passingPct <= 100) || !DEC2.test(String(pp.passingPct))) { add("program_range", `The passing mark of "${name}" must be a percentage above 0 and up to 100, with at most 2 decimals.`, { program: name }); return; }
      const strad = desc.find(b => b.from < pp.passingPct && pp.passingPct <= b.to);
      if (strad) add("program_straddle", `The passing mark ${fmt(pp.passingPct)} of "${name}" falls inside row ${rowOf(strad)} (${fmt(strad.from)} to ${fmt(strad.to)}). Split that row so one row starts at ${fmt(pp.passingPct)}.`, { row: rowOf(strad), program: name });
    });
    if (out.length > 0) return out;

    // 6. rows with the same grade must mean the same result, and there must be a Passed row and a Failed row
    const thresholds: { t: number; who: string }[] = [{ t: p as number, who: "your passing mark" }, ...rules.programPassing.map(pp => ({ t: pp.passingPct, who: `the passing mark of "${pp.program.trim()}"` }))];
    for (const { t, who } of thresholds) {
      const byValue = new Map<number, boolean>();
      for (const b of desc) {
        const passed = b.from >= t, v = values.get(b)!;
        if (byValue.has(v) && byValue.get(v) !== passed) { add("same_grade_result", `Two rows have the same grade (${b.equivalentGrade.trim()}) but, with ${who} (${fmt(t)}), one is Passed and the other Failed. Give them different grades or move the passing mark.`, { row: rowOf(b) }); break; }
        byValue.set(v, passed);
      }
    }
    if (out.length > 0) return out;
    if (!desc.some(b => b.from >= (p as number)) || !desc.some(b => b.to < (p as number))) add("no_passed_or_failed", "The table needs at least one Passed row and one Failed row. Check the passing mark.");
    if (out.length > 0) return out;
  }

  // 7. the GWA settings
  const g = rules.gwa;
  if (!["weighted", "simple"].includes(g.method)) add("gwa_method", "Choose how the GWA is computed (units-weighted or simple average).");
  else if (!["equivalent", "percentage"].includes(g.gradeUsed)) add("gwa_grade_used", "Choose which grade the GWA uses (the equivalent grade or the percentage).");
  else if (![2, 3, 4].includes(g.decimals)) add("gwa_decimals", "Choose 2, 3 or 4 decimal places for the GWA.");
  else if (!["round", "cut"].includes(g.rounding)) add("gwa_rounding", "Choose whether the GWA is rounded or the extra decimals are cut off.");
  else if (g.gradeUsed === "percentage" && rules.entryMode === "grade") add("gwa_percent_needs_percentage", "To work out the GWA from percentages, choose that percentages are entered (percentage, or either) in the table section.");
  if (out.length > 0) return out;
  if (g.retentionThreshold != null) {
    const lo = g.gradeUsed === "percentage" ? 0 : scale.scaleMin, hi = g.gradeUsed === "percentage" ? 100 : scale.scaleMax;
    if (!Number.isFinite(g.retentionThreshold) || g.retentionThreshold < lo || g.retentionThreshold > hi) add("retention_range", `The retention requirement must be a number from ${lo} to ${hi}${g.gradeUsed === "percentage" ? " (a percentage, because the GWA uses percentages)" : ""}, or left blank.`);
  }
  const known = new Set(["inc", "drp", ...knownMarks.map(norm)]);
  const specialLo = g.gradeUsed === "percentage" ? 0 : scale.scaleMin, specialHi = g.gradeUsed === "percentage" ? 100 : scale.scaleMax;
  for (const [mark, value] of Object.entries(g.specialValues)) {
    if (!mark.trim() || NUM.test(mark.trim())) add("special_key", `"${mark}" is a number, not a special mark.`);
    else if (!known.has(norm(mark))) add("special_unknown", `"${mark}" is not one of your marks. Add it under Other marks first (INC and DRP are always available).`);
    else if (typeof value !== "number" || !Number.isFinite(value) || value < specialLo || value > specialHi) add("special_value", `The number for "${mark}" must be from ${specialLo} to ${specialHi}.`);
  }
  const codes = new Set<string>();
  for (const c of g.excludedCodes) {
    const code = c.trim().toUpperCase();
    if (!code || code.length > 20 || /[,;\s]/.test(code)) add("excluded_code", `"${c}" is not a valid subject code (up to 20 characters, no spaces or commas).`);
    else if (codes.has(code)) add("excluded_code", `The subject code ${code} is listed twice.`);
    else codes.add(code);
  }
  return out;
}

// ── Passing mark, rows, "Try a grade" ─────────────────────────
/** The passing mark for a scholar of a program: the program's own, else the school's. */
export function passingFor(program: string | null | undefined, rules: Pick<GradingRules, "passingMarkPct" | "programPassing">): number | null {
  const p = (program ?? "").trim().toLowerCase();
  const own = p ? rules.programPassing.find(x => x.program.trim().toLowerCase() === p) : undefined;
  return own ? own.passingPct : rules.passingMarkPct;
}

/** The row a percentage falls in (both ends included), or null when no row covers it. */
export function bandForPercentage(bands: GradeBand[], pct: number): GradeBand | null {
  return bands.find(b => pct >= b.from - 1e-9 && pct <= b.to + 1e-9) ?? null;
}

/** The rows whose equivalent grade is this grade (usually one; several when the school gave the same grade to more than one row). */
export function bandsForGrade(bands: GradeBand[], grade: string, scale: RuleScale): GradeBand[] {
  const g = grade.trim();
  if (!g) return [];
  const gv = equivalentValue(g, scale).value;
  return bands.filter(b => b.equivalentGrade.trim().toLowerCase() === g.toLowerCase() || (gv !== null && equivalentValue(b.equivalentGrade, scale).value === gv));
}

export type Result = "passed" | "failed";
export interface TryResult { band: GradeBand; grade: string; remarks: string; result: Result }

/** What a percentage becomes: the equivalent grade, the remarks and the result against the passing mark (of the program, if it has its own). */
export function tryPercentage(pct: number, rules: GradingRules, program?: string | null): TryResult | null {
  const band = bandForPercentage(rules.bands, pct);
  const passing = passingFor(program, rules);
  if (!band || passing == null) return null;
  return { band, grade: band.equivalentGrade.trim(), remarks: band.remarks.trim(), result: pct >= passing - 1e-9 ? "passed" : "failed" };
}

/** The result of a grade typed without a percentage: judged by its row. null when the grade is not in the table (or the rows disagree). */
export function resultForGrade(grade: string, rules: GradingRules, scale: RuleScale, program?: string | null): Result | null {
  const passing = passingFor(program, rules);
  if (passing == null) return null;
  const rows = bandsForGrade(rules.bands, grade, scale);
  if (rows.length === 0) return null;
  const results = new Set(rows.map(b => (b.from >= passing - 1e-9 ? "passed" : "failed")));
  return results.size === 1 ? [...results][0] as Result : null;
}

/** Each row's result against the school's passing mark (for the Result column; a program's own passing mark can differ). */
export const bandResult = (b: GradeBand, passing: number | null): Result | null => (passing == null ? null : b.from >= passing - 1e-9 ? "passed" : "failed");

// ── When rules start ──────────────────────────────────────────
export type TermName = "1st Semester" | "2nd Semester" | "Summer";
const TERM_RANK: Record<string, number> = { "1st Semester": 1, "2nd Semester": 2, "Summer": 3 };
export function periodRank(schoolYear: string, term: string): number { return (Number(schoolYear.split("-")[0]) || 0) * 10 + (TERM_RANK[term] ?? 0); }
/** The semester after one: 1st, then 2nd, then Summer, then the 1st of the next school year. */
export function nextPeriod(schoolYear: string, term: string): { schoolYear: string; term: TermName } {
  if (term === "1st Semester") return { schoolYear, term: "2nd Semester" };
  if (term === "2nd Semester") return { schoolYear, term: "Summer" };
  const [a, b] = schoolYear.split("-").map(Number);
  return { schoolYear: `${a + 1}-${b + 1}`, term: "1st Semester" };
}
export type StartReason = "now" | "period_submitted" | "period_not_open";
/** Where new rules start: the current period when it is open and not yet submitted by the school, otherwise the next period (a locked period never changes). */
export function startFor(current: { schoolYear: string; term: string }, status: "open" | "closed" | "archived" | null, submitted: boolean): { schoolYear: string; term: string; reason: StartReason } {
  if (status === "open" && !submitted) return { ...current, reason: "now" };
  const n = nextPeriod(current.schoolYear, current.term);
  return { schoolYear: n.schoolYear, term: n.term, reason: submitted ? "period_submitted" : "period_not_open" };
}

// ── Changes between two sets of rules, in words (for the history) ─────────────
export function describeChanges(before: GradingRules | null, after: GradingRules): string[] {
  if (!before) return ["First rules saved."];
  const out: string[] = [];
  if (before.entryMode !== after.entryMode) out.push(`Grade entry: ${ENTRY_MODE_LABEL[before.entryMode]} → ${ENTRY_MODE_LABEL[after.entryMode]}`);
  if (before.passingMarkPct !== after.passingMarkPct) out.push(`Passing mark: ${before.passingMarkPct ?? "none"} → ${after.passingMarkPct ?? "none"}`);
  const prog = (r: GradingRules) => r.programPassing.map(x => `${x.program.trim()} ${x.passingPct}`).sort().join(", ");
  if (prog(before) !== prog(after)) out.push(`Programs with their own passing mark: ${prog(before) || "none"} → ${prog(after) || "none"}`);
  const bandText = (r: GradingRules) => sortedDesc(r.bands).map(b => `${b.from}-${b.to}:${b.equivalentGrade.trim()}:${b.remarks.trim()}`).join("|");
  if (bandText(before) !== bandText(after)) out.push(before.bands.length === after.bands.length ? "Conversion table edited" : `Conversion table: ${before.bands.length} rows → ${after.bands.length} rows`);
  const a = before.gwa, b = after.gwa;
  if (a.method !== b.method) out.push(`GWA method: ${a.method === "weighted" ? "units-weighted" : "simple average"} → ${b.method === "weighted" ? "units-weighted" : "simple average"}`);
  if (a.gradeUsed !== b.gradeUsed) out.push(`GWA grade used: ${a.gradeUsed} → ${b.gradeUsed}`);
  if (a.decimals !== b.decimals) out.push(`GWA decimals: ${a.decimals} → ${b.decimals}`);
  if (a.rounding !== b.rounding) out.push(`GWA rounding: ${a.rounding === "round" ? "round" : "cut off"} → ${b.rounding === "round" ? "round" : "cut off"}`);
  if (a.includeFailed !== b.includeFailed) out.push(`Failed grades in the GWA: ${a.includeFailed ? "included" : "left out"} → ${b.includeFailed ? "included" : "left out"}`);
  if (JSON.stringify(a.specialValues) !== JSON.stringify(b.specialValues)) out.push("Special marks counted as numbers changed");
  if ([...a.excludedCodes].sort().join(",") !== [...b.excludedCodes].sort().join(",")) out.push("Default excluded subject codes changed");
  if (a.retentionThreshold !== b.retentionThreshold) out.push(`Retention requirement: ${a.retentionThreshold ?? "school's existing"} → ${b.retentionThreshold ?? "school's existing"}`);
  return out.length ? out : ["No change in the rules."];
}

// ── Presets ("Start from a common template") ───────────────────
export interface RulesPreset {
  key: string; label: string; description: string;
  /** The scale the template is written for. */
  scale: { scaleMin: number; scaleMax: number; direction: "lower_is_better" | "higher_is_better" };
  /** The letter table the template needs (empty when it uses numbers only). */
  letters: { letter: string; numericValue: number }[];
  /** The passing mark on the school's own scale (the existing Passing mark box), for the template with no conversion table. */
  scalePassingMark: number | null;
  rules: Pick<GradingRules, "entryMode" | "passingMarkPct" | "bands">;
}
const bandsOf = (rows: [number, number, string, string][]): GradeBand[] => rows.map(([from, to, equivalentGrade, remarks]) => ({ from, to, equivalentGrade, remarks }));
export const PRESETS: RulesPreset[] = [
  {
    key: "ph-1-5", label: "1.00 to 5.00 scale (lower is better), 75% passing",
    description: "The common 1.00 (highest) to 5.00 scale: 97 to 100 is 1.00 and 75 to 76.99 is 3.00; below 75 is 5.00.",
    scale: { scaleMin: 1, scaleMax: 5, direction: "lower_is_better" }, letters: [], scalePassingMark: 3,
    rules: { entryMode: "either", passingMarkPct: 75, bands: bandsOf([
      [97, 100, "1.00", "Excellent"], [94, 96.99, "1.25", "Very Good"], [91, 93.99, "1.50", "Very Good"], [88, 90.99, "1.75", "Good"], [85, 87.99, "2.00", "Good"],
      [82, 84.99, "2.25", "Satisfactory"], [79, 81.99, "2.50", "Satisfactory"], [77, 78.99, "2.75", "Fair"], [75, 76.99, "3.00", "Passing"], [0, 74.99, "5.00", "Failure"],
    ]) },
  },
  {
    key: "pct-only", label: "Percentage only (60 to 100, 75 passing, no conversion)",
    description: "The percentage is the grade. No conversion table; grades are entered as they are and 75 is the passing mark.",
    scale: { scaleMin: 60, scaleMax: 100, direction: "higher_is_better" }, letters: [], scalePassingMark: 75,
    rules: { entryMode: "grade", passingMarkPct: null, bands: [] },
  },
  {
    key: "gpa-4", label: "1.0 to 4.0 scale (higher is better), 75% passing",
    description: "A grade-point scale where 4.00 is the highest. 75 to 77.99 is 2.00 and below 75 is 0.00.",
    scale: { scaleMin: 0, scaleMax: 4, direction: "higher_is_better" }, letters: [], scalePassingMark: 2,
    rules: { entryMode: "either", passingMarkPct: 75, bands: bandsOf([
      [96, 100, "4.00", "Excellent"], [90, 95.99, "3.50", "Very Good"], [84, 89.99, "3.00", "Good"], [78, 83.99, "2.50", "Satisfactory"], [75, 77.99, "2.00", "Passing"], [0, 74.99, "0.00", "Failure"],
    ]) },
  },
  {
    key: "letters", label: "Letter grades with percentages (A, B, C, D, F), 75% passing",
    description: "Letters with a number each (A is 4, F is 0) so the GWA can be worked out. A is 90 to 100; F is below 75.",
    scale: { scaleMin: 0, scaleMax: 4, direction: "higher_is_better" }, letters: [{ letter: "A", numericValue: 4 }, { letter: "B", numericValue: 3 }, { letter: "C", numericValue: 2 }, { letter: "D", numericValue: 1 }, { letter: "F", numericValue: 0 }], scalePassingMark: 1,
    rules: { entryMode: "either", passingMarkPct: 75, bands: bandsOf([
      [90, 100, "A", "Excellent"], [85, 89.99, "B", "Very Good"], [80, 84.99, "C", "Good"], [75, 79.99, "D", "Passing"], [0, 74.99, "F", "Failure"],
    ]) },
  },
];

// ── The sample computation shown to the school ─────────────────
export interface SampleSubject { name: string; units: number; grade: string; percentage: number | null; excluded?: boolean }
export interface SampleLine { name: string; units: number; shown: string; value: number | null; counted: boolean; note: string }
export interface SampleResult { lines: SampleLine[]; formula: string; gwa: number | null; text: string }

export interface SampleSubject { name: string; units: number; grade: string; percentage: number | null; excluded?: boolean }
export interface SampleLine { name: string; units: number; shown: string; value: number | null; counted: boolean; note: string }
export interface SampleResult { lines: SampleLine[]; formula: string; gwa: number | null; text: string }

const REASON_TEXT = { "": "", special: "Special mark counted as a number", excluded: "Excluded from the GWA", no_number: "Has no number, left out", failed: "Failed, left out of the GWA" } as const;

/** A worked example of the GWA under the school's settings, line by line, using the shared GWA function. `outcomeOf` says whether a subject is failed (needed when failed grades are left out). */
export function sampleComputation(subjects: SampleSubject[], scale: RuleScale, settings: GwaSettings, outcomeOf: (s: SampleSubject) => "passed" | "failed" | "other"): SampleResult {
  const letters = scale.letters.map(l => ({ letter: l.letter, numericValue: l.numericValue }));
  const r = gwaWithSettings(subjects.map(s => ({ grade: s.grade, units: s.units, excludeFromGwa: s.excluded, percentage: s.percentage, failed: outcomeOf(s) === "failed" })), letters, settings);
  const lines: SampleLine[] = subjects.map((s, i) => ({
    name: s.name, units: s.units, shown: settings.gradeUsed === "percentage" && s.percentage != null ? `${s.percentage}%` : s.grade,
    value: r.lines[i].value, counted: r.lines[i].counted,
    note: r.lines[i].reason === "no_number" && settings.gradeUsed === "percentage" ? "No percentage, left out" : REASON_TEXT[r.lines[i].reason],
  }));
  if (r.gwa === null) return { lines, formula: "", gwa: null, text: "No subject counts, so there is no GWA." };
  return { lines, formula: r.formula, gwa: r.gwa, text: `${r.formula} = ${formatWith(r.gwa, settings)}` };
}

/** Sample subjects drawn from the school's own table (or from its scale when it has none): a few passed, one failed, and a special mark when the school counts one as a number. */
export function sampleSubjects(rules: GradingRules, scale: RuleScale): SampleSubject[] {
  const units = [3, 3, 2, 3];
  const subjects: SampleSubject[] = [];
  const bands = sortedDesc(rules.bands);
  const passing = rules.passingMarkPct;
  if (bands.length > 0 && passing != null) {
    const passed = bands.filter(b => b.from >= passing);
    const failed = bands.filter(b => b.to < passing);
    const pick = [passed[0], passed[Math.floor(passed.length / 2)], passed[passed.length - 1]].filter(Boolean);
    const unique = pick.filter((b, i) => pick.indexOf(b) === i);
    unique.forEach((b, i) => subjects.push({ name: `Sample subject ${i + 1}`, units: units[i], grade: b.equivalentGrade.trim(), percentage: Math.round(((b.from + b.to) / 2) * 100) / 100 }));
    if (failed[0]) subjects.push({ name: `Sample subject ${subjects.length + 1}`, units: units[subjects.length] ?? 3, grade: failed[0].equivalentGrade.trim(), percentage: Math.round(((failed[0].from + failed[0].to) / 2) * 100) / 100 });
  } else {
    const lo = scale.scaleMin, hi = scale.scaleMax, best = scale.direction === "lower_is_better" ? lo : hi, worst = scale.direction === "lower_is_better" ? hi : lo;
    [best, (best * 2 + worst) / 3, (best + worst * 2) / 3].forEach((v, i) => subjects.push({ name: `Sample subject ${i + 1}`, units: units[i], grade: v.toFixed(2), percentage: null }));
  }
  const special = Object.keys(rules.gwa.specialValues)[0];
  if (special) subjects.push({ name: `Sample subject ${subjects.length + 1}`, units: 3, grade: special, percentage: null });
  return subjects;
}
