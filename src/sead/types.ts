export interface QuestSubject {
  id: string;
  name: string;
  maxAttemptsPerDay: number;
  passingRateMin: number;
  passingRateMax: number;
  certificateFilename: string; // "" = no certificate attached
}

export interface QuestTopic {
  id: string;
  subjectId: string;
  name: string;
  sortOrder: number;
  maxAttemptsPerDay: number | null; // null = inherit the subject's default
  videoUrl: string; // YouTube, Google Drive, or any HTTPS video URL; "" if none set
  slideUrl: string; // Google Slides, Canva, or any HTTPS slide-deck URL; "" if none set
  pdfUrl: string; // Google Drive or any HTTPS PDF document URL; "" if none set
}

export interface QuestChoiceDraft {
  id?: string;
  choiceText: string;
  isCorrect: boolean;
}

export interface QuestQuestion {
  id: string;
  topicId: string;
  questionText: string;
  points: number;
  isActive: boolean;
  explanation: string;
  choices: QuestChoiceDraft[];
}

export const SCHOLARSHIP_STATUSES = ["Regular", "Probationary", "On leave", "Reconsidered"] as const;
export type ScholarshipStatus = (typeof SCHOLARSHIP_STATUSES)[number];

export interface ScholarListItem {
  id: string;
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  school: string;
  status: ScholarshipStatus;
}

export interface ScoreRow {
  id: string;
  scholarIdNumber: string;
  scholarName: string;
  subjectName: string | null;
  topicName: string | null;
  questName: string;
  score: number | null;
  maxScore: number | null;
  dateTaken: string | null;
}

export interface ScholarAccountLogEntry {
  id: string;
  createdAt: string;
  action: "added" | "removed" | "reset" | "updated";
  scholarIdNumber: string;
  scholarName: string;
  performedByName: string;
  batchId: string | null;
  source: "single" | "bulk" | "undo";
  description: string;
}

export type SeadTab = "scholars" | "question-bank" | "quests-monitoring" | "formation-activities" | "history" | "forms-management";

// ── Research Project Monitoring: Survey Tools / Survey Results ──

export type SurveyQuestionType = "multiple_choice" | "likert";

export interface SurveyChoiceDraft {
  id?: string;
  choiceText: string;
}

export interface SurveyQuestion {
  id: string;
  surveyId: string;
  questionType: SurveyQuestionType;
  questionText: string;
  sortOrder: number;
  // Likert-only; null for multiple_choice questions.
  likertScaleMin: number | null;
  likertScaleMax: number | null;
  likertMinLabel: string | null;
  likertMaxLabel: string | null;
  // Multiple-choice-only; [] for likert questions.
  choices: SurveyChoiceDraft[];
}

export type SurveyActivityType = "sdp" | "formation";

export interface Survey {
  id: string;
  title: string;
  description: string;
  activityType: SurveyActivityType;
  activityId: string;
  activityName: string;
  isActive: boolean;
  createdAt: string;
  // Voluntary/client-satisfaction-style surveys: when true, the scholar is
  // asked consentText and can decline — declining skips the survey and
  // finalizes their attendance immediately, same as completing it.
  requiresConsent: boolean;
  consentText: string;
}

export interface SurveyChoiceResult {
  choiceId: string;
  choiceText: string;
  count: number;
}

export interface SurveyLikertDistributionPoint {
  value: number;
  count: number;
  percentage: number;
}

export interface SurveyLikertResult {
  n: number;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  distribution: SurveyLikertDistributionPoint[];
}
