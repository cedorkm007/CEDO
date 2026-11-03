// ─────────────────────────────────────────────────────────────
// src/lib/gradingImpact.ts
// "How many grades and GWAs would change?" — shown to the school before it confirms new grading rules for a period that already has grades.
// Pure (no Supabase, no React). It compares the school's grades judged and averaged BEFORE (the rules saved last, or today's way when there are none) with AFTER (the new rules),
// using the same shared functions the screens use (classifyGrade, computeGwa, gwaWithSettings), so what the school is told matches what it will see.
// ─────────────────────────────────────────────────────────────
import { computeGwa, formatGwa, formatWith, gwaWithSettings, type GradingConfig, type LetterGrade } from "./gwa";
import { classifyGrade } from "./subjectOutcome";
import { resultForGrade, type GradingRules, type RuleScale } from "./gradingRules";

export interface ImpactScholar { scholarIdNumber: string; program: string }
export interface ImpactGrade { scholarIdNumber: string; grade: string; units: number | null; excludeFromGwa?: boolean; percentage?: number | null }

export interface Impact {
  /** Grades looked at (those with a grade entered). */
  gradesChecked: number;
  /** Grades whose Passed / Failed result changes. */
  gradesChanged: number;
  /** Grades that the new table has no row for (they could not be judged by the table). */
  gradesNotInTable: number;
  /** Scholars whose GWA, as shown, changes. */
  gwasChanged: number;
  /** Scholars with a changed grade result or a changed GWA. */
  scholarsAffected: number;
}
export const NO_IMPACT: Impact = { gradesChecked: 0, gradesChanged: 0, gradesNotInTable: 0, gwasChanged: 0, scholarsAffected: 0 };

type Judged = "passed" | "failed" | null;

/** The result of a grade under the rules saved last, or under today's way (the passing mark on the scale) when there are none. */
function judge(grade: string, program: string, rules: GradingRules | null, scale: RuleScale, config: GradingConfig, letters: LetterGrade[]): { result: Judged; notInTable: boolean } {
  const g = grade.trim();
  if (!g) return { result: null, notInTable: false };
  const legacy = classifyGrade(g, config, letters);
  const legacyResult: Judged = legacy === "passed" ? "passed" : legacy === "failed" || legacy === "drp" ? "failed" : null;
  if (!rules || rules.bands.length === 0) return { result: legacyResult, notInTable: false };
  // INC, DRP and the school's own marks keep their meaning; only numbers and letters of the letter table are judged by the table
  const isNumber = /^\d+(\.\d+)?$/.test(g);
  const isLetter = scale.letters.some(l => l.letter.trim().toLowerCase() === g.toLowerCase());
  const own = letters.some(l => l.outcome && l.letter.trim().toLowerCase() === g.toLowerCase());
  if (legacy === "inc" || legacy === "drp" || own || !(isNumber || isLetter)) return { result: legacyResult, notInTable: false };
  const r = resultForGrade(g, rules, scale, program);
  return { result: r, notInTable: r === null };
}

export function computeImpact(
  scholars: ImpactScholar[], grades: ImpactGrade[], config: GradingConfig, letters: LetterGrade[], scale: RuleScale,
  before: GradingRules | null, after: GradingRules,
): Impact {
  const byScholar = new Map<string, ImpactGrade[]>();
  for (const g of grades) { const l = byScholar.get(g.scholarIdNumber); if (l) l.push(g); else byScholar.set(g.scholarIdNumber, [g]); }
  const out: Impact = { ...NO_IMPACT };
  for (const s of scholars) {
    const rows = (byScholar.get(s.scholarIdNumber) ?? []);
    let affected = false;
    for (const g of rows) {
      if (!g.grade.trim()) continue;
      out.gradesChecked++;
      const b = judge(g.grade, s.program, before, scale, config, letters), a = judge(g.grade, s.program, after, scale, config, letters);
      if (a.notInTable) out.gradesNotInTable++;
      if (b.result !== null && a.result !== null && b.result !== a.result) { out.gradesChanged++; affected = true; }
    }
    if (rows.some(r => r.grade.trim())) {
      const gwaBefore = before
        ? formatWith(gwaWithSettings(rows.map(r => ({ ...r, failed: judge(r.grade, s.program, before, scale, config, letters).result === "failed" })), letters, before.gwa).gwa, before.gwa)
        : formatGwa(computeGwa(rows, letters));
      const gwaAfter = formatWith(gwaWithSettings(rows.map(r => ({ ...r, failed: judge(r.grade, s.program, after, scale, config, letters).result === "failed" })), letters, after.gwa).gwa, after.gwa);
      if (gwaBefore !== gwaAfter) { out.gwasChanged++; affected = true; }
    }
    if (affected) out.scholarsAffected++;
  }
  return out;
}

/** The impact in a sentence for the school. */
export function impactText(i: Impact): string {
  if (i.gradesChecked === 0) return "There are no grades yet in the period these rules start with, so no grade or GWA changes.";
  const parts = [`${i.gradesChanged} grade${i.gradesChanged === 1 ? "" : "s"} would change from Passed to Failed or the other way`, `${i.gwasChanged} GWA${i.gwasChanged === 1 ? "" : "s"} would change`];
  const tail = i.gradesNotInTable > 0 ? ` ${i.gradesNotInTable} grade${i.gradesNotInTable === 1 ? " is" : "s are"} not in the conversion table, so the table cannot judge ${i.gradesNotInTable === 1 ? "it" : "them"}.` : "";
  return `${parts.join(" and ")} (out of ${i.gradesChecked} grade${i.gradesChecked === 1 ? "" : "s"}; ${i.scholarsAffected} scholar${i.scholarsAffected === 1 ? "" : "s"} affected).${tail}`;
}
