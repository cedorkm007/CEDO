// ─────────────────────────────────────────────────────────────
// src/lib/subjectOutcome.ts
// What a subject's grade means for renewal: passed, failed, INC, DRP, or something to look at. Pure (no Supabase, no React),
// shared by the School Portal, the staff Scholars' Grades Monitoring tool and the scholar's own grades screen so all three
// highlight the same subjects.
//
// The AUTHORITY is the database function _grade_outcome() (supabase_migration_renewal_p1_foundations.sql), which the renewal
// rules call. This file only mirrors it for display, and tests/renewal/outcome_cases.json is run against BOTH so they cannot drift.
//
// Rules:
//   * blank                         -> ungraded
//   * INC (any case)                -> inc   (tracked separately; NOT failed by itself)
//   * DRP (any case)                -> drp   (counts as FAILED)
//   * a school's own mark (F, D/F...) -> what the school said it means: passed / failed / incomplete (= inc) / review
//   * a school with a conversion table for the semester (Phase 2): a percentage or a grade the table covers is judged by the table and the school's passing mark in percent
//                                     (the programme's own when it has one); a grade the table does not cover falls to the rules below
//   * no passing mark set           -> no_passing_mark (nothing is guessed)
//   * a program with its own mark   -> while the setup is the one CEDO staff made for the time being (set by staff), a scholar of that program is judged by the program's passing mark instead of the school's
//   * a grade or letter value worse than the passing mark -> failed; equal to it passes
//   * a mark that cannot be read (e.g. "W") -> review (the evaluator looks at it)
// "Exclude from GWA" is deliberately ignored: those subjects still count for pass/fail.
// ─────────────────────────────────────────────────────────────
import type { GradingConfig, LetterGrade } from "./gwa";
import type { GradingRules } from "./gradingRules";
import { tableResult } from "./rulesRuntime";

export type SubjectOutcome = "ungraded" | "passed" | "failed" | "inc" | "drp" | "review" | "no_passing_mark";

export const OUTCOME_LABEL: Record<SubjectOutcome, string> = {
  ungraded: "No grade yet",
  passed: "Passed",
  failed: "Failed",
  inc: "INC",
  drp: "DRP — counts as failed",
  review: "Needs review",
  no_passing_mark: "No passing mark set",
};

/** The reserved marks every school may enter. */
export function reservedMark(grade: string): "INC" | "DRP" | null {
  const g = grade.trim().toUpperCase();
  return g === "INC" || g === "DRP" ? g : null;
}

const NUMBER = /^\d+(\.\d+)?$/;

/** The passing mark that applies to a scholar of `program`: the program's own mark when staff gave it one (only while the setup is the staff's, as in the database), else the school's. */
export function passingMarkFor(config: GradingConfig | null | undefined, program?: string | null): number | null {
  if (!config) return null;
  const own = config.setByStaff && program && program.trim() ? config.programMarks?.find(p => p.program.trim().toLowerCase() === program.trim().toLowerCase()) : undefined;
  return own ? own.passingMark : config.passingMark ?? null;
}

export function classifyGrade(grade: string, config: GradingConfig | null | undefined, letters: LetterGrade[], rules?: GradingRules | null, program?: string | null, percentage?: number | null): SubjectOutcome {
  const g = grade.trim();
  if (!g && (percentage == null || !rules)) return "ungraded";
  const reserved = reservedMark(g);
  if (reserved === "INC") return "inc";
  if (reserved === "DRP") return "drp";
  const own = letters.find(l => l.outcome && l.letter.trim().toLowerCase() === g.toLowerCase());
  if (own?.outcome) return own.outcome === "incomplete" ? "inc" : own.outcome;
  const byTable = tableResult({ grade: g, percentage }, rules, program);
  if (byTable) return byTable;
  if (!g) return "ungraded";
  const passing = passingMarkFor(config, program);
  if (!config || passing == null) return "no_passing_mark";

  let value: number | null = null;
  if (NUMBER.test(g)) value = Number(g);
  else if (config.usesLetterGrades) {
    const match = letters.find(l => l.letter.trim().toLowerCase() === g.toLowerCase());
    value = match?.numericValue ?? null;
  }
  if (value === null) return "review";

  if (config.direction === "lower_is_better") return value > passing ? "failed" : "passed";
  return value < passing ? "failed" : "passed";
}

/** A subject that counts as failed for renewal: a grade worse than the passing mark, or DRP. */
export const isFailed = (o: SubjectOutcome): boolean => o === "failed" || o === "drp";

export interface OutcomeCounts {
  failed: number;
  /** Of `failed`, how many are DRP. */
  drp: number;
  inc: number;
  review: number;
  /** Graded subjects that could not be judged because the school has not set a passing mark. */
  noPassingMark: number;
}

export interface OutcomeRow { grade: string; percentage?: number | null }

/** Counts for one scholar's subjects in a period. Excluded-from-GWA subjects are included on purpose. */
export function countOutcomes(rows: OutcomeRow[], config: GradingConfig | null | undefined, letters: LetterGrade[], rules?: GradingRules | null, program?: string | null): OutcomeCounts {
  const c: OutcomeCounts = { failed: 0, drp: 0, inc: 0, review: 0, noPassingMark: 0 };
  for (const r of rows) {
    const o = classifyGrade(r.grade, config, letters, rules, program, r.percentage);
    if (isFailed(o)) c.failed++;
    if (o === "drp") c.drp++;
    else if (o === "inc") c.inc++;
    else if (o === "review") c.review++;
    else if (o === "no_passing_mark") c.noPassingMark++;
  }
  return c;
}

/** "1 failed · 1 INC" — empty when there is nothing to flag. */
export function outcomeSummaryText(c: OutcomeCounts): string {
  const parts: string[] = [];
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.inc > 0) parts.push(`${c.inc} INC`);
  if (c.review > 0) parts.push(`${c.review} to review`);
  return parts.join(" · ");
}
