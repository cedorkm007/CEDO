/**
 * Shared shapes for My Surveys -- used by the builder (staff) and by the
 * respondent screens (SurveyRunner), which is also what the builder's Preview
 * renders. Deliberately dependency-free: the public respondent page imports
 * this file and must stay small.
 */

export type QuestionType =
  | "short_answer" | "paragraph" | "multiple_choice" | "checkboxes" | "dropdown"
  | "linear_scale" | "rating" | "date" | "time";

export const QUESTION_TYPES: QuestionType[] = [
  "short_answer", "paragraph", "multiple_choice", "checkboxes", "dropdown", "linear_scale", "rating", "date", "time",
];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_answer: "Short answer",
  paragraph: "Paragraph",
  multiple_choice: "Multiple choice",
  checkboxes: "Checkboxes",
  dropdown: "Dropdown",
  linear_scale: "Linear scale",
  rating: "Rating",
  date: "Date",
  time: "Time",
};

export const CHOICE_TYPES: QuestionType[] = ["multiple_choice", "checkboxes", "dropdown"];
export const isChoiceType = (t: QuestionType) => CHOICE_TYPES.includes(t);

export interface OptionItem { id: string; label: string }

export interface QuestionItem {
  kind: "question";
  id: string;
  /** Stays the same across versions of the same question. */
  questionKey: string;
  version: number;
  type: QuestionType;
  text: string;
  helpText: string;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string;
  scaleMaxLabel: string;
  /** True when respondents have already answered this exact version. */
  hasResponses: boolean;
  options: OptionItem[];
}

export interface SectionItem { kind: "section"; id: string; title: string; description: string }

/** A section header starts a section; every question after it belongs to it until the next header. */
export type SurveyItem = QuestionItem | SectionItem;

export type SurveyStatus = "draft" | "open" | "closed";
export type SurveyRole = "owner" | "editor" | "viewer";

export interface SurveyDoc {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  status: SurveyStatus;
  consentEnabled: boolean;
  consentText: string;
  revision: number;
  role: SurveyRole;
  updatedAt: string;
  lastEditedByName: string;
  responseCount: number;
  items: SurveyItem[];
}

/** What the respondent screens need. */
export interface RunnerSurvey {
  title: string;
  description: string;
  consentEnabled: boolean;
  consentText: string;
  items: SurveyItem[];
}

export interface RunnerAnswer { text?: string; number?: number; optionIds?: string[] }
export type RunnerAnswers = Record<string, RunnerAnswer>;

/** Identity that survives versioning: a reworded question gets a new database id but keeps its questionKey. */
export const itemKey = (item: SurveyItem): string => (item.kind === "question" ? item.questionKey : item.id);

export const newId = (): string => crypto.randomUUID();

export const DEFAULT_CONSENT_TEXT =
  "By continuing, you agree that the information you provide in this survey will be collected and processed by the City Education and Development Office (CEDO) for research and program-monitoring purposes, in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173). Your responses will be kept confidential, used only for the purpose stated in this survey, and reported in aggregate. Taking part is voluntary and you may stop at any time.";

export function newQuestion(type: QuestionType): QuestionItem {
  return {
    kind: "question",
    id: newId(),
    questionKey: newId(),
    version: 1,
    type,
    text: "",
    helpText: "",
    required: false,
    scaleMin: type === "linear_scale" ? 1 : type === "rating" ? 1 : null,
    scaleMax: type === "linear_scale" ? 5 : type === "rating" ? 5 : null,
    scaleMinLabel: "",
    scaleMaxLabel: "",
    hasResponses: false,
    options: isChoiceType(type) ? [{ id: newId(), label: "Option 1" }] : [],
  };
}

export function newSection(): SectionItem {
  return { kind: "section", id: newId(), title: "Untitled section", description: "" };
}

/** Is there a usable answer for this question? */
export function isAnswered(q: QuestionItem, a: RunnerAnswer | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case "short_answer": case "paragraph": case "date": case "time":
      return (a.text ?? "").trim() !== "";
    case "multiple_choice": case "dropdown": case "checkboxes":
      return (a.optionIds ?? []).length > 0;
    case "linear_scale": case "rating":
      return typeof a.number === "number";
  }
}

/** Human-readable answer, for the review screen. */
export function answerSummary(q: QuestionItem, a: RunnerAnswer | undefined): string {
  if (!isAnswered(q, a) || !a) return "";
  switch (q.type) {
    case "multiple_choice": case "dropdown": case "checkboxes":
      return (a.optionIds ?? []).map(id => q.options.find(o => o.id === id)?.label ?? "").filter(Boolean).join(", ");
    case "linear_scale": case "rating":
      return String(a.number);
    default:
      return (a.text ?? "").trim();
  }
}
