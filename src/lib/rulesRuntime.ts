// ─────────────────────────────────────────────────────────────
// src/lib/rulesRuntime.ts
// Where a school's saved grading rules are USED (Phase 2). Pure (no Supabase, no React), shared by the School Portal, the staff Scholars' Grades Monitoring tool, the scholar's
// own Grades tab and the exports, so every screen shows the same GWA, the same standing and the same Passed / Failed.
//
//   * which rules applied to a semester        -> rulesAt()         (the latest version that starts at or before it; a version never changes, so a past semester never moves)
//   * the ONE GWA function                     -> periodGwa()       (the school's own settings; with no rules it is exactly the old calculation)
//   * standing against the retention requirement -> standingFor()
//   * what a percentage / grade means          -> describeRow(), entryFor()
//   * which subjects start excluded            -> defaultExcluded()
//
// The DATABASE makes the same decisions (supabase_migration_school_grading_rules_d_functions.sql: _grading_version_at, _grade_outcome_at, _grading_entry); tests/school-grading-rules
// runs the same cases against both.
// ─────────────────────────────────────────────────────────────
import { periodRank, passingFor, type GradingRules } from "./gradingRules";
import { parseRules } from "./gradingRulesData";
import { formatGwa, formatWith, gwaDetail, gwaWithSettings, roundTo, type GradeLike, type GwaSettings, type LetterGrade } from "./gwa";
import { scholarStanding, type StandingConfig, type StandingResult } from "./standing";

type Json = Record<string, unknown>;

// ── Which rules applied to a semester ─────────────────────────
export interface RuleVersion { versionNo: number; effectiveYear: string; effectiveTerm: string; rules: GradingRules }
/** school id -> its versions, oldest first. */
export type SchoolRulesMap = Record<string, RuleVersion[]>;

export function parseTimeline(j: unknown): SchoolRulesMap {
  const out: SchoolRulesMap = {};
  if (!j || typeof j !== "object") return out;
  for (const [schoolId, list] of Object.entries(j as Json)) {
    if (!Array.isArray(list)) continue;
    out[schoolId] = (list as Json[]).map(v => ({ versionNo: Number(v.versionNo), effectiveYear: String(v.effectiveYear ?? ""), effectiveTerm: String(v.effectiveTerm ?? ""), rules: parseRules(v.rules as Json) }))
      .sort((a, b) => periodRank(a.effectiveYear, a.effectiveTerm) - periodRank(b.effectiveYear, b.effectiveTerm) || a.versionNo - b.versionNo);
  }
  return out;
}

/** The rules of a semester: the latest version starting at or before it. null = the school has no rules for it (everything works the old way). */
export function rulesAt(versions: RuleVersion[] | null | undefined, schoolYear: string, term: string): GradingRules | null {
  if (!versions || versions.length === 0 || !schoolYear) return null;
  const at = periodRank(schoolYear.trim(), term);
  let found: RuleVersion | null = null;
  for (const v of versions) {
    if (periodRank(v.effectiveYear, v.effectiveTerm) <= at && (found === null || periodRank(v.effectiveYear, v.effectiveTerm) > periodRank(found.effectiveYear, found.effectiveTerm) || (periodRank(v.effectiveYear, v.effectiveTerm) === periodRank(found.effectiveYear, found.effectiveTerm) && v.versionNo > found.versionNo))) found = v;
  }
  return found ? found.rules : null;
}

/** The school has a conversion table for this semester. */
export const hasTable = (rules: GradingRules | null | undefined): rules is GradingRules => !!rules && rules.bands.length > 0;

// ── Reading a grade through the table ─────────────────────────
const NUM = /^\d+(\.\d+)?$/;
/** Two grades are the same grade when they read the same ("1.5" and "1.50", "b" and "B"). Same as the database's _grading_same_grade. */
export function sameGrade(a: string, b: string): boolean {
  const x = a.trim(), y = b.trim();
  return x.toLowerCase() === y.toLowerCase() || (NUM.test(x) && NUM.test(y) && Number(x) === Number(y));
}
const bandOfPct = (rules: GradingRules, pct: number) => rules.bands.find(b => pct >= b.from - 1e-9 && pct <= b.to + 1e-9) ?? null;

export interface RowReading { grade: string; percentage: number | null; remarks: string; result: "passed" | "failed" | null }
/** What a saved row means under the rules: the grade, the percentage, the school's remarks for it and Passed / Failed against the passing mark (the programme's own when it has one). */
export function describeRow(row: { grade: string; percentage?: number | null }, rules: GradingRules | null | undefined, program?: string | null): RowReading | null {
  if (!hasTable(rules)) return null;
  const pct = row.percentage ?? null;
  const passing = passingFor(program, rules);
  if (pct !== null) {
    const band = bandOfPct(rules, pct);
    if (!band) return null;
    return { grade: row.grade.trim() || band.equivalentGrade.trim(), percentage: pct, remarks: band.remarks.trim(), result: passing == null ? null : pct >= passing - 1e-9 ? "passed" : "failed" };
  }
  const g = row.grade.trim();
  if (!g) return null;
  const bands = rules.bands.filter(b => sameGrade(g, b.equivalentGrade));
  if (bands.length === 0) return null;
  const remarks = [...new Set(bands.map(b => b.remarks.trim()))].join(" / ");
  const results = passing == null ? null : bands.some(b => b.from < passing - 1e-9) ? "failed" : "passed";
  return { grade: g, percentage: null, remarks, result: results };
}

/** Passed / Failed for a row that the table covers, else null (the old rule decides). Mirrors the database's _grade_outcome_at. */
export function tableResult(row: { grade: string; percentage?: number | null }, rules: GradingRules | null | undefined, program?: string | null): "passed" | "failed" | "no_passing_mark" | null {
  if (!hasTable(rules)) return null;
  const pct = row.percentage ?? null;
  const g = row.grade.trim();
  const bands = pct !== null ? rules.bands.filter(b => pct >= b.from - 1e-9 && pct <= b.to + 1e-9) : g ? rules.bands.filter(b => sameGrade(g, b.equivalentGrade)) : [];
  if (bands.length === 0) return null;
  const passing = passingFor(program, rules);
  if (passing == null) return "no_passing_mark";
  return bands.some(b => b.from < passing - 1e-9) ? "failed" : "passed";
}

// ── Entering a grade or a percentage ──────────────────────────
export interface EntryOutcome {
  /** The grade to save (the equivalent grade when a percentage was typed). */
  grade: string;
  percentage: number | null;
  /** The message to show instead of saving, or "". */
  error: string;
  /** What the table says about it, for the screen. */
  reading: RowReading | null;
}
const pctText = (n: number) => String(Number(n.toFixed(2)));

/** What a typed grade and / or percentage becomes. Same decisions and same messages as the database's _grading_entry. `specialMarks` = INC, DRP and the school's own marks. */
export function entryFor(rules: GradingRules | null | undefined, grade: string, pctText_: string, specialMarks: string[], program?: string | null): EntryOutcome {
  const g = grade.trim();
  const t = pctText_.trim().replace(",", ".");
  const fail = (error: string): EntryOutcome => ({ grade: g, percentage: null, error, reading: null });
  let pct: number | null = null;
  if (t !== "") {
    if (!/^\d+(\.\d+)?$/.test(t)) return fail("The percentage must be a number from 0 to 100.");
    pct = Number(t);
    if (pct < 0 || pct > 100) return fail("The percentage must be from 0 to 100.");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return fail("The percentage can have at most 2 decimals.");
  }
  const special = g !== "" && (["inc", "drp"].includes(g.toLowerCase()) || specialMarks.some(m => m.trim().toLowerCase() === g.toLowerCase()));
  if (pct !== null && special) return fail(`${g} has no percentage. Leave the percentage empty.`);
  if (!hasTable(rules)) {
    if (pct !== null) return fail("Your school has no conversion table for this semester, so a percentage cannot be saved. Enter the grade.");
    return { grade: g, percentage: null, error: "", reading: null };
  }
  if (pct !== null) {
    if (rules.entryMode === "grade") return fail("Your school enters grades, not percentages (see the Grading System tab). Leave the percentage empty.");
    const band = bandOfPct(rules, pct);
    if (!band) return fail(`A percentage of ${pctText(pct)} is not in your conversion table.`);
    if (g !== "" && !sameGrade(g, band.equivalentGrade)) return fail(`A percentage of ${pctText(pct)} is ${band.equivalentGrade.trim()} in your conversion table, not ${g}.`);
    return { grade: band.equivalentGrade.trim(), percentage: pct, error: "", reading: describeRow({ grade: band.equivalentGrade.trim(), percentage: pct }, rules, program) };
  }
  if (g === "" || special) return { grade: g, percentage: null, error: "", reading: null };
  if (rules.entryMode === "percentage") return fail("Enter the percentage for this subject: your school enters percentages.");
  if (!rules.bands.some(b => sameGrade(g, b.equivalentGrade))) {
    const list = [...new Set(rules.bands.map(b => b.equivalentGrade.trim()))].sort().join(", ");
    return fail(`Grade "${g}" is not in your conversion table. Use one of: ${list}.`);
  }
  return { grade: g, percentage: null, error: "", reading: describeRow({ grade: g }, rules, program) };
}

/** True when a new subject with this code starts "Exclude from GWA" (the school's list of default excluded codes). Subjects saved before are never changed by this. */
export function defaultExcluded(rules: GradingRules | null | undefined, code: string): boolean {
  const c = code.trim().toLowerCase();
  return c !== "" && !!rules && rules.gwa.excludedCodes.some(x => x.trim().toLowerCase() === c);
}

// ── The one GWA function ──────────────────────────────────────
export interface GwaInputRow extends GradeLike { percentage?: number | null }
export interface PeriodGwa {
  /** The GWA as it is shown and judged (rounded the way the school chose). null = nothing counts yet. */
  gwa: number | null;
  /** The GWA as the screen shows it ("—" when there is none). */
  text: string;
  subjectsCounted: number;
  unitsCounted: number;
  /** Counted subjects that have no units yet (counted as 1 unit). */
  countedWithoutUnits: number;
  /** Subjects kept out of the GWA by the "Exclude from GWA" tick. */
  excluded: number;
  /** The settings that were used (null = the original calculation, no rules saved). */
  settings: GwaSettings | null;
}

/**
 * The GWA of one scholar's subjects in one semester. With no rules saved for the semester it is the original calculation (units-weighted, two decimals) to the digit; with rules it follows
 * the school's settings (method, which grade is used, decimals, rounding, failed grades, special marks). `failedOf` says whether a subject is failed (only looked at when the school leaves failed grades out).
 */
export function periodGwa(rows: GwaInputRow[], letters: LetterGrade[], rules: GradingRules | null | undefined, failedOf?: (row: GwaInputRow) => boolean): PeriodGwa {
  if (!rules) {
    const d = gwaDetail(rows, letters);
    return { gwa: d.gwa, text: formatGwa(d.gwa), subjectsCounted: d.subjectsCounted, unitsCounted: d.unitsCounted, countedWithoutUnits: d.countedWithoutUnits, excluded: d.excluded, settings: null };
  }
  const s = rules.gwa;
  const res = gwaWithSettings(rows.map(r => ({ ...r, failed: s.includeFailed ? false : (failedOf ? failedOf(r) : false) })), letters, s);
  const gwa = res.gwa === null ? null : roundTo(res.gwa, s.decimals, s.rounding);
  let countedWithoutUnits = 0;
  res.lines.forEach((l, i) => { if (l.counted && !(rows[i].units != null && (rows[i].units as number) > 0)) countedWithoutUnits++; });
  return { gwa, text: formatWith(gwa, s), subjectsCounted: res.subjectsCounted, unitsCounted: res.unitsCounted, countedWithoutUnits, excluded: rows.filter(r => r.excludeFromGwa).length, settings: s };
}
// ── Standing ──────────────────────────────────────────────────
/**
 * Good standing / At risk / Below requirement. The requirement is the one in the school's rules for that semester (on the scale of the GWA that the rules use); a school with no rules, or
 * rules that leave the requirement empty, keeps the requirement it saved in the Grading System tab.
 */
export function standingFor(gwa: number | null, config: StandingConfig | null | undefined, rules: GradingRules | null | undefined): StandingResult {
  if (!rules) return scholarStanding(gwa, config);
  const own = rules.gwa.retentionThreshold;
  if (rules.gwa.gradeUsed === "percentage") {
    return scholarStanding(gwa, own == null ? null : { scaleMin: 0, scaleMax: 100, direction: "higher_is_better", retentionThreshold: own });
  }
  if (!config) return "no_requirement";
  return scholarStanding(gwa, { ...config, retentionThreshold: own ?? config.retentionThreshold ?? null });
}
