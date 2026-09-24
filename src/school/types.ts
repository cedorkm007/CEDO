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
}
