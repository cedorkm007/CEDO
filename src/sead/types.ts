export interface QuestSubject {
  id: string;
  name: string;
  maxAttemptsPerDay: number;
}

export interface QuestTopic {
  id: string;
  subjectId: string;
  name: string;
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

export type SeadTab = "scholars" | "question-bank" | "scores";
