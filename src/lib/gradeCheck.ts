// ─────────────────────────────────────────────────────────────
// src/lib/gradeCheck.ts
// The warnings a scholar sees WHILE typing the grades of the renewal: a symbol that is not allowed, a grade that is not on the school's scale, a letter the school does not use, units out of range.
// Plain helpers (no React, no Supabase) so the form, the checks before sending and the tests all use the same rules. The database checks the same things again when the grades are sent.
// ─────────────────────────────────────────────────────────────

/** What the school's grading setup allows (null while it is not known yet: then only the symbol rule is checked). */
export interface GradeRules { scaleMin: number; scaleMax: number; usesLetterGrades: boolean; letters: string[]; marks: string[] }

const NUM = /^\d+(\.\d+)?$/;
const lc = (s: string) => s.trim().toLowerCase();

/** The grade as it will be saved: a number typed with a stray space ("1 .0") is the plain number ("1.0"); anything else only loses the spaces around it. */
export function compactGrade(grade: string): string {
  const t = String(grade ?? "").trim();
  const c = t.replace(/\s+/g, "");
  return NUM.test(c) ? c : t;
}

export const SYMBOL_WARNING_TAIL = "has a symbol that is not allowed. Use only letters, numbers and a period (for example 1.5, 2.25 or INC). Write the decimal point as a period, not a comma.";

/** null = fine (or nothing typed yet). Otherwise one plain sentence saying what is wrong with this grade. */
export function gradeWarning(grade: string, rules: GradeRules | null | undefined): string | null {
  const t = String(grade ?? "").trim();
  if (!t) return null;
  if (rules?.marks.some(m => lc(m) === lc(t))) return null;      // one of the school's own marks (even one with a symbol, such as D/F)
  if (!/^[A-Za-z0-9. ]+$/.test(t)) {
    return /,/.test(t) && /^[A-Za-z0-9., ]+$/.test(t)
      ? `The grade "${t}" uses a comma. Write the decimal point as a period (for example ${t.replace(/\s+/g, "").replace(",", ".")}).`
      : `The grade "${t}" ${SYMBOL_WARNING_TAIL}`;
  }
  const c = compactGrade(t);
  if (/^(inc|drp)$/i.test(c)) return null;
  if (!rules) return NUM.test(c) || /^[A-Za-z]+$/.test(c) ? null : `"${t}" is not a valid grade.`;
  if (rules.marks.some(m => lc(m) === lc(c))) return null;
  if (NUM.test(c)) {
    const n = Number(c);
    return n >= rules.scaleMin && n <= rules.scaleMax ? null : `Grade ${c} is outside your grading scale (${rules.scaleMin} to ${rules.scaleMax}).`;
  }
  if (rules.usesLetterGrades && rules.letters.some(l => lc(l) === lc(c))) return null;
  const allowed = [...(rules.usesLetterGrades ? rules.letters : []), ...rules.marks, "INC", "DRP"];
  return `"${t}" is not a grade your school uses. Use a number from ${rules.scaleMin} to ${rules.scaleMax}${allowed.length ? `, or one of: ${[...new Set(allowed)].join(", ")}` : ""}.`;
}

/** null = fine (or nothing typed yet). */
export function unitsWarning(units: string): string | null {
  const t = String(units ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || !/^\d*[.,]?\d+$/.test(t)) return "The units must be a number, for example 3 or 1.5.";
  if (n <= 0 || n > 20) return "The units must be a number above 0 and at most 20.";
  return null;
}

/** The numbers of the subjects (counting from 1) whose grade or units show a warning. */
export function rowsWithWarnings(rows: { grade: string; units: string }[], rules: GradeRules | null | undefined): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => { if (gradeWarning(r.grade, rules) || unitsWarning(r.units)) out.push(i + 1); });
  return out;
}
