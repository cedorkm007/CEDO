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
  yearLevel: string;
  civilStatus: string;
  address: string; // legacy free-text field, superseded by the structured fields below
  houseUnitNo: string;
  street: string;
  barangay: string;
  cityMunicipality: string;
  provinceRegion: string;
  country: string;
  zipCode: string;
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

// ── Quiz flow ────────────────────────────────────────────────
export interface QuizSubject {
  id: string;
  name: string;
  passingRateMin: number;
  passingRateMax: number;
  certificateFilename: string; // "" = no certificate attached to this subject
}

export interface QuizTopic {
  id: string;
  subjectId: string;
  name: string;
  videoUrl: string; // YouTube, Google Drive, or any HTTPS video URL; "" if none attached
  slideUrl: string; // Google Slides, Canva, or any HTTPS slide-deck URL; "" if none attached
  maxAttemptsPerDay: number; // effective limit — topic override, else the subject's default
  attemptsUsedToday: number;
}

export interface QuizChoice {
  id: string;
  choiceText: string;
}

export interface QuizQuestion {
  id: string;
  questionText: string;
  points: number;
  choices: QuizChoice[];
}

export interface QuizResultChoice {
  id: string;
  choiceText: string;
  isCorrect: boolean;
}

export interface QuizResultItem {
  questionId: string;
  questionText: string;
  explanation: string;
  choices: QuizResultChoice[];
  selectedChoiceId: string | null;
  isCorrect: boolean;
}

export interface QuizSubmitResult {
  score: number;
  maxScore: number;
  results: QuizResultItem[];
  attemptsUsedToday: number;
  maxAttemptsPerDay: number;
}
