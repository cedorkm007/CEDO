// ─────────────────────────────────────────────────────────────
// src/school/types.ts
// Types for the School Portal — a third account system alongside staff
// (public.users) and scholars (public.scholars): public.school_accounts.
// ─────────────────────────────────────────────────────────────

export interface SchoolProfile {
  schoolId: string;
  schoolName: string;
}

export interface GradingConfig {
  scaleMin: number;
  scaleMax: number;
  direction: "lower_is_better" | "higher_is_better";
  usesLetterGrades: boolean;
  /** The school's retention requirement on its own scale (e.g. 2.5 = "GWA 2.50 or better"); null/undefined = not set. */
  retentionThreshold?: number | null;
  /** The passing mark on the school's own scale (a grade worse than it is failed); null/undefined = not set. */
  passingMark?: number | null;
}

export interface LetterGrade {
  letter: string;
  numericValue: number | null;
  /** Set on a school's own non-numeric mark (F, D/F...): what it means for renewal. */
  outcome?: "passed" | "failed" | "incomplete" | "review";
  /** What the mark stands for. */
  meaning?: string;
}

/** One of a school's own non-numeric marks (F, D/F...): what it stands for and what it means for renewal. */
export type MarkOutcome = "passed" | "failed" | "incomplete" | "review";
export interface SchoolMark { mark: string; meaning: string; outcome: MarkOutcome }
export const MARK_OUTCOME_LABEL: Record<MarkOutcome, string> = { passed: "Passed", failed: "Failed", incomplete: "Incomplete (like INC)", review: "Needs review" };

/** A mark in the shape the grade helpers read (the letter-table shape, with no number, so it never enters the GWA). */
export const markAsLetter = (m: SchoolMark): LetterGrade => ({ letter: m.mark, numericValue: null, outcome: m.outcome, meaning: m.meaning });

export interface SchoolScholarRow {
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  yearLevel: string;
  course: string;
}

export interface SchoolSubjectGrade {
  id: string;
  scholarIdNumber: string;
  schoolYear: string;
  semester: string;
  subjectCode: string;
  subject: string;
  grade: string;
  /** Credit units of the subject; null until the school sets them (counted as 1 unit when GWA is weighted, Phase 4). */
  units: number | null;
  /** True for subjects kept out of the GWA (e.g. NSTP, PE). */
  excludeFromGwa: boolean;
  /** A short remark or tag from the school (e.g. NSTP, Repeated, Cross-enrolled). Information only. */
  remarks: string;
}
