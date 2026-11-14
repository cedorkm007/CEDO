// ─────────────────────────────────────────────────────────────
// src/lib/tempProbation.ts
// Regular scholars with an INC or ONE missing grade: the Grades Approver may tag them as TEMPORARY PROBATIONARY while approving the entered grades (remarks + days to comply).
// The evaluator then renews them as Probationary (temporary); when the grade is passed they go back to Regular, otherwise they stay Probationary (decided by the database:
// supabase_migration_renewal_temp_probation_tag.sql). Plain helpers (no Supabase / React) so tests can run them alone.
// ─────────────────────────────────────────────────────────────

export const TEMP_TAG_DEFAULT_DAYS = 30;
export const TEMP_TAG_MAX_DAYS = 365;

/** What the entered grades contain that a tag is about: INCs and subjects without a grade. (The database judges it again, by the school's rules.) */
export function tagHint(lines: { grade: string }[]): { inc: number; noGrade: number; canTag: boolean } {
  let inc = 0, noGrade = 0;
  for (const l of lines) {
    const g = String(l.grade ?? "").replace(/[\s.]+/g, "");
    if (g === "") noGrade++;
    else if (/^(inc|incomplete)$/i.test(g)) inc++;
  }
  return { inc, noGrade, canTag: noGrade <= 1 && (inc > 0 || noGrade === 1) };
}

/** A problem with the tag form (remarks and days), in plain words; null when it is fine. */
export function tagProblem(remarks: string, days: string): string | null {
  if (remarks.trim().length < 5) return "Write the remarks (at least 5 characters), for example which subject has the INC or no grade.";
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > TEMP_TAG_MAX_DAYS) return `Give the number of days to comply (1 to ${TEMP_TAG_MAX_DAYS}).`;
  return null;
}

/** What the tag does, for the dialog of the Grades Approver. */
export const TEMP_TAG_EXPLANATION = "The scholar is renewed by the evaluator as Probationary (temporary) and goes to the Probationary list, with no documents and no consultation. The days to comply start on the day the renewal is confirmed. If the grade is passed the scholar goes back to Regular; if it is failed, or the days run out, the scholar stays Probationary.";

/** The line shown to the scholar (and the evaluator) about a tagged case. */
export function tagSummaryText(days: number | null, remarks: string | null): string {
  return `Temporary probation (tagged by the Grades Approver): ${days ?? "some"} days to comply after the renewal.${remarks ? ` Remarks: ${remarks}` : ""}`;
}
