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
//   * no passing mark set           -> no_passing_mark (nothing is guessed)
//   * a grade or letter value worse than the passing mark -> failed; equal to it passes
//   * a mark that cannot be read (e.g. "W") -> review (the evaluator looks at it)
// "Exclude from GWA" is deliberately ignored: those subjects still count for pass/fail.
// ─────────────────────────────────────────────────────────────
import type { GradingConfig, LetterGrade } from "./gwa";

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

export function classifyGrade(grade: string, config: GradingConfig | null | undefined, letters: LetterGrade[]): SubjectOutcome {
  const g = grade.trim();
  if (!g) return "ungraded";
  const reserved = reservedMark(g);
  if (reserved === "INC") return "inc";
  if (reserved === "DRP") return "drp";
  if (!config || config.passingMark == null) return "no_passing_mark";

  let value: number | null = null;
  if (NUMBER.test(g)) value = Number(g);
  else if (config.usesLetterGrades) {
    const match = letters.find(l => l.letter.trim().toLowerCase() === g.toLowerCase());
    value = match?.numericValue ?? null;
  }
  if (value === null) return "review";

  if (config.direction === "lower_is_better") return value > config.passingMark ? "failed" : "passed";
  return value < config.passingMark ? "failed" : "passed";
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

export interface OutcomeRow { grade: string }

/** Counts for one scholar's subjects in a period. Excluded-from-GWA subjects are included on purpose. */
export function countOutcomes(rows: OutcomeRow[], config: GradingConfig | null | undefined, letters: LetterGrade[]): OutcomeCounts {
  const c: OutcomeCounts = { failed: 0, drp: 0, inc: 0, review: 0, noPassingMark: 0 };
  for (const r of rows) {
    const o = classifyGrade(r.grade, config, letters);
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
