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
  maxAttemptsPerDay: number | null; // null = inherit the subject's default
  youtubeUrl: string; // "" if none set
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

export interface ScholarListItem {
  id: string;
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  middleName: string;
  school: string;
  status: string;
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
  action: "added" | "removed";
  scholarIdNumber: string;
  scholarName: string;
  performedByName: string;
  batchId: string | null;
  source: "single" | "bulk" | "undo";
}

export type SeadTab = "scholars" | "question-bank" | "scores" | "rankings" | "history";
