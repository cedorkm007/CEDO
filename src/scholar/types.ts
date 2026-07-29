// ─────────────────────────────────────────────────────────────
// src/scholar/types.ts
// Types for the public CEDO site + Scholar Portal. Kept separate from
// src/app/App.tsx's staff types — scholars are a different account system
// (public.scholars, not public.users) even though it's the same database.
// ─────────────────────────────────────────────────────────────

export interface ScholarProfile {
  id: string; // == Supabase Auth user id (auth.uid())
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  birthday: string; // YYYY-MM-DD
  email: string;
  contactNo: string;
  school: string;
  course: string;
  civilStatus: string;
  address: string;
  status: "active" | "probation" | "inactive" | "graduated";
}

export interface SubjectGrade {
  id: string;
  scholarIdNumber: string;
  schoolYear: string;
  semester: string;
  subject: string;
  grade: string;
  remarks: string;
}

export interface QuestScore {
  id: string;
  scholarIdNumber: string;
  questName: string;
  score: number | null;
  maxScore: number | null;
  dateTaken: string | null;
  remarks: string;
}

/** Public top-level pages on the CEDO home site (not logged in). */
export type PublicPage = "home" | "articles" | "programs" | "statistics";

/** Everything the Scholar Log In dropdown can lead to. */
export type ScholarLoginTarget =
  | "existing"
  | "new-college"
  | "new-law-medical";
