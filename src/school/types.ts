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
}

export interface LetterGrade {
  letter: string;
  numericValue: number | null;
}

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
}
