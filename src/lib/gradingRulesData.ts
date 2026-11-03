// ─────────────────────────────────────────────────────────────
// src/lib/gradingRulesData.ts
// The shapes the database gives back for a school's grading rules (school_grading_rules_overview, staff_school_grading_rules …), and the "draft" the Grading System tab edits
// (every box is text while the school types) with the conversions between a draft and the rules. Pure (no Supabase, no React), so tests can run it alone.
// ─────────────────────────────────────────────────────────────
import { DEFAULT_GWA_SETTINGS, type EntryMode, type GradeBand, type GradingRules, type GwaSettings, type RuleScale } from "./gradingRules";

type Json = Record<string, unknown>;
const num = (v: unknown): number => (v == null || v === "" ? NaN : Number(v));
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

/** A saved row of the conversion table: the rules' row plus what the database worked out when it was saved. */
export interface SavedBand extends GradeBand { equivalentValue?: number; result?: "passed" | "failed" }
export interface SavedVersion {
  id: string; versionNo: number; effectiveYear: string; effectiveTerm: string; createdAt: string; createdByLabel: string | null; note: string | null;
  rules: GradingRules & { bands: SavedBand[] };
}
export interface VersionInfo { id: string; versionNo: number; effectiveYear: string; effectiveTerm: string; createdAt: string; createdByLabel: string | null; bandCount: number }
export interface AuditEntry {
  id: number; changedAt: string; changedByLabel: string | null; effectiveYear: string; effectiveTerm: string; versionNo: number | null; note: string | null;
  oldRules: GradingRules | null; newRules: GradingRules;
  impact: { gradesChecked?: number; gradesChanged?: number; gradesNotInTable?: number; gwasChanged?: number; scholarsAffected?: number; period?: string };
}
export interface RulesOverview {
  schoolId: string; schoolName: string;
  currentPeriod: { schoolYear: string; term: string; status: string | null; submitted: boolean } | null;
  startsAt: { schoolYear: string; term: string; reason: "now" | "period_submitted" | "period_not_open" } | null;
  /** The school's saved scale (null before it has saved one). `passingMark` is the old passing mark on the scale, used by schools without a conversion table. */
  scale: (RuleScale & { usesLetterGrades: boolean; passingMark: number | null; retentionThreshold: number | null }) | null;
  marks: string[];
  /** The rules in use for the current period (null = today's way). */
  active: SavedVersion | null;
  /** The newest saved rules (they may start at a later period). */
  latest: SavedVersion | null;
  versions: VersionInfo[];
  audit: AuditEntry[];
}

export function parseRules(j: Json | null | undefined): GradingRules & { bands: SavedBand[] } {
  const r = (j ?? {}) as Json, g = ((r.gwa ?? {}) as Json);
  const gwa: GwaSettings = {
    method: (g.method === "simple" ? "simple" : "weighted"), gradeUsed: g.gradeUsed === "percentage" ? "percentage" : "equivalent",
    decimals: ([2, 3, 4].includes(Number(g.decimals)) ? Number(g.decimals) : 2) as 2 | 3 | 4, rounding: g.rounding === "cut" ? "cut" : "round",
    includeFailed: g.includeFailed === false ? false : true,
    specialValues: Object.fromEntries(Object.entries((g.specialValues ?? {}) as Json).map(([k, v]) => [k, Number(v)])),
    excludedCodes: Array.isArray(g.excludedCodes) ? (g.excludedCodes as unknown[]).map(String) : [], retentionThreshold: numOrNull(g.retentionThreshold),
  };
  return {
    entryMode: (["grade", "percentage", "either"].includes(String(r.entryMode)) ? r.entryMode : "grade") as EntryMode,
    passingMarkPct: numOrNull(r.passingMarkPct),
    programPassing: ((r.programPassing ?? []) as Json[]).map(p => ({ program: str(p.program), passingPct: Number(p.passingPct) })),
    bands: ((r.bands ?? []) as Json[]).map(b => ({ from: Number(b.from), to: Number(b.to), equivalentGrade: str(b.equivalentGrade), remarks: str(b.remarks),
      equivalentValue: numOrNull(b.equivalentValue) ?? undefined, result: b.result === "passed" || b.result === "failed" ? b.result : undefined })),
    gwa: { ...DEFAULT_GWA_SETTINGS, ...gwa },
  };
}

export function parseVersion(j: Json | null | undefined): SavedVersion | null {
  if (!j || typeof j !== "object" || !("id" in j)) return null;
  return { id: str(j.id), versionNo: Number(j.versionNo), effectiveYear: str(j.effectiveYear), effectiveTerm: str(j.effectiveTerm), createdAt: str(j.createdAt), createdByLabel: strOrNull(j.createdByLabel), note: strOrNull(j.note), rules: parseRules(j.rules as Json) };
}

export function parseOverview(j: Json): RulesOverview {
  const sc = j.scale as Json | null, cp = j.currentPeriod as Json | null, sa = j.startsAt as Json | null;
  return {
    schoolId: str(j.schoolId), schoolName: str(j.schoolName),
    currentPeriod: cp ? { schoolYear: str(cp.schoolYear), term: str(cp.term), status: strOrNull(cp.status), submitted: !!cp.submitted } : null,
    startsAt: sa ? { schoolYear: str(sa.schoolYear), term: str(sa.term), reason: str(sa.reason) as "now" | "period_submitted" | "period_not_open" } : null,
    scale: sc ? {
      scaleMin: Number(sc.scaleMin), scaleMax: Number(sc.scaleMax), direction: sc.direction === "higher_is_better" ? "higher_is_better" : "lower_is_better", usesLetterGrades: !!sc.usesLetterGrades,
      passingMark: numOrNull(sc.passingMark), retentionThreshold: numOrNull(sc.retentionThreshold),
      letters: ((sc.letters ?? []) as Json[]).map(l => ({ letter: str(l.letter), numericValue: numOrNull(l.numericValue) })),
    } : null,
    marks: ((j.marks ?? []) as unknown[]).map(String),
    active: parseVersion(j.active as Json | null), latest: parseVersion(j.latest as Json | null),
    versions: ((j.versions ?? []) as Json[]).map(v => ({ id: str(v.id), versionNo: Number(v.versionNo), effectiveYear: str(v.effectiveYear), effectiveTerm: str(v.effectiveTerm), createdAt: str(v.createdAt), createdByLabel: strOrNull(v.createdByLabel), bandCount: Number(v.bandCount) })),
    audit: ((j.audit ?? []) as Json[]).map(a => ({
      id: Number(a.id), changedAt: str(a.changedAt), changedByLabel: strOrNull(a.changedByLabel), effectiveYear: str(a.effectiveYear), effectiveTerm: str(a.effectiveTerm), versionNo: a.versionNo == null ? null : Number(a.versionNo), note: strOrNull(a.note),
      oldRules: a.oldRules ? parseRules(a.oldRules as Json) : null, newRules: parseRules(a.newRules as Json), impact: ((a.impact ?? {}) as AuditEntry["impact"]),
    })),
  };
}

// ── The draft the tab edits ──────────────────────────────────
export interface BandDraft { key: number; from: string; to: string; grade: string; remarks: string }
export interface ProgramDraft { key: number; program: string; passing: string }
export interface RulesDraft {
  entryMode: EntryMode; passing: string; programs: ProgramDraft[]; bands: BandDraft[];
  method: GwaSettings["method"]; gradeUsed: GwaSettings["gradeUsed"]; decimals: 2 | 3 | 4; rounding: GwaSettings["rounding"]; includeFailed: boolean;
  /** mark -> the number typed (blank = the mark is left out of the GWA) */
  special: Record<string, string>; excluded: string; retention: string;
}

let nextKey = 1;
export const newKey = () => nextKey++;
const text = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "" : String(n));

export function draftFromRules(r: GradingRules | null): RulesDraft {
  const rules = r ?? { entryMode: "grade" as EntryMode, passingMarkPct: null, programPassing: [], bands: [], gwa: { ...DEFAULT_GWA_SETTINGS } };
  return {
    entryMode: rules.entryMode, passing: text(rules.passingMarkPct),
    programs: rules.programPassing.map(p => ({ key: newKey(), program: p.program, passing: text(p.passingPct) })),
    bands: [...rules.bands].sort((a, b) => b.from - a.from || b.to - a.to).map(b => ({ key: newKey(), from: text(b.from), to: text(b.to), grade: b.equivalentGrade, remarks: b.remarks })),
    method: rules.gwa.method, gradeUsed: rules.gwa.gradeUsed, decimals: rules.gwa.decimals, rounding: rules.gwa.rounding, includeFailed: rules.gwa.includeFailed,
    special: Object.fromEntries(Object.entries(rules.gwa.specialValues).map(([k, v]) => [k, text(v)])), excluded: rules.gwa.excludedCodes.join(", "), retention: text(rules.gwa.retentionThreshold),
  };
}

/** A number typed in a box: NaN when blank or not a number (the checks then say what is wrong). */
export function parseNum(t: string): number { const s = t.trim().replace(",", "."); return s === "" || !/^\d+(\.\d+)?$/.test(s) ? Number.NaN : Number(s); }

export function rulesFromDraft(d: RulesDraft): GradingRules {
  const special: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.special)) if (v.trim() !== "") special[k] = Number(v.trim().replace(",", "."));
  const retention = d.retention.trim() === "" ? null : Number(d.retention.trim().replace(",", "."));
  return {
    entryMode: d.entryMode, passingMarkPct: d.passing.trim() === "" ? null : parseNum(d.passing),
    programPassing: d.programs.filter(p => p.program.trim() !== "" || p.passing.trim() !== "").map(p => ({ program: p.program, passingPct: parseNum(p.passing) })),
    bands: d.bands.map(b => ({ from: parseNum(b.from), to: parseNum(b.to), equivalentGrade: b.grade, remarks: b.remarks })),
    gwa: { method: d.method, gradeUsed: d.gradeUsed, decimals: d.decimals, rounding: d.rounding, includeFailed: d.includeFailed, specialValues: special,
      excludedCodes: d.excluded.split(/[,;\n]+/).map(c => c.trim()).filter(Boolean), retentionThreshold: retention },
  };
}

/** The rows highest percentage first; a row without a valid percentage stays where it is, below the others. */
export function sortBandDrafts(bands: BandDraft[]): BandDraft[] {
  const valid = bands.filter(b => !Number.isNaN(parseNum(b.from)) && !Number.isNaN(parseNum(b.to)));
  const rest = bands.filter(b => !valid.includes(b));
  return [...valid].sort((a, b) => parseNum(b.from) - parseNum(a.from) || parseNum(b.to) - parseNum(a.to)).concat(rest);
}

/** Two rules are the same when they would save the same version (the order the school typed the rows in does not matter). */
export function sameRules(a: GradingRules, b: GradingRules): boolean {
  const canon = (r: GradingRules) => JSON.stringify({
    e: r.entryMode, p: r.passingMarkPct, pp: [...r.programPassing].map(x => [x.program.trim().toLowerCase(), x.passingPct]).sort(),
    b: [...r.bands].sort((x, y) => y.from - x.from).map(x => [x.from, x.to, x.equivalentGrade.trim(), x.remarks.trim()]),
    g: { ...r.gwa, excludedCodes: [...r.gwa.excludedCodes].map(c => c.trim().toUpperCase()).sort(), specialValues: Object.fromEntries(Object.entries(r.gwa.specialValues).sort()) },
  });
  return canon(a) === canon(b);
}
