// Survey Tools: the plain rules shared by the staff editor, the results screen and the scholar's survey screen (no database, no React).
// The database follows the same rules: see supabase_migration_survey_sections_safety.sql.

export type SurveyQType = "multiple_choice" | "likert" | "open_ended";

export interface OutlineSection { id: string; title: string; description: string; removed?: boolean }
export interface OutlineChoice {
  id?: string; choiceText: string; skipToQuestionId?: string | null; skipToSectionId?: string | null; endsSurvey?: boolean; answerCount?: number;
}
export interface OutlineQuestion {
  id: string; surveyId: string; questionType: SurveyQType; questionText: string; sortOrder: number; sectionId: string | null;
  isOptional: boolean; version: number; removed: boolean; removedReason: string | null;
  likertScaleMin: number | null; likertScaleMax: number | null; likertMinLabel: string | null; likertMaxLabel: string | null;
  openEndedFormat: "short" | "long" | null; answerCount: number; choices: OutlineChoice[];
}
export interface SurveyOutline { sections: OutlineSection[]; questions: OutlineQuestion[] }
export interface SurveyGroup<Q = OutlineQuestion> { section: OutlineSection | null; questions: Q[] }

/** Questions in their sections, in order. A survey without sections is one unnamed group. */
export function groupBySection<Q extends { sectionId: string | null }>(sections: OutlineSection[], questions: Q[]): SurveyGroup<Q>[] {
  const known = new Set(sections.map(s => s.id));
  const loose = questions.filter(q => !q.sectionId || !known.has(q.sectionId));
  const groups: SurveyGroup<Q>[] = sections.map(section => ({ section, questions: questions.filter(q => q.sectionId === section.id) }));
  return loose.length > 0 || sections.length === 0 ? [{ section: null, questions: loose }, ...groups] : groups;
}

export const flatten = <Q,>(groups: SurveyGroup<Q>[]): Q[] => groups.flatMap(g => g.questions);

/** The shape survey_reorder expects. */
export const layoutOf = (groups: SurveyGroup<{ id: string }>[]) =>
  groups.map(g => ({ sectionId: g.section?.id ?? null, questionIds: g.questions.map(q => q.id) }));

/** Puts a question into a section (null = the unnamed group) before the question `beforeId` (null = at the end). */
export function moveQuestion<Q extends { id: string; sectionId: string | null }>(groups: SurveyGroup<Q>[], questionId: string, toSectionId: string | null, beforeId: string | null): SurveyGroup<Q>[] {
  const moving = flatten(groups).find(q => q.id === questionId);
  if (!moving || beforeId === questionId) return groups;
  return groups.map(g => {
    const rest = g.questions.filter(q => q.id !== questionId);
    if ((g.section?.id ?? null) !== toSectionId) return { ...g, questions: rest };
    const at = beforeId ? rest.findIndex(q => q.id === beforeId) : -1;
    const placed = { ...moving, sectionId: toSectionId };
    return { ...g, questions: at === -1 ? [...rest, placed] : [...rest.slice(0, at), placed, ...rest.slice(at)] };
  });
}

/** Moves a section to another place among the sections (the unnamed group, if any, stays first). */
export function moveSection<Q>(groups: SurveyGroup<Q>[], sectionId: string, toIndex: number): SurveyGroup<Q>[] {
  const loose = groups.filter(g => !g.section);
  const named = groups.filter(g => g.section);
  const from = named.findIndex(g => g.section!.id === sectionId);
  if (from === -1) return groups;
  const [item] = named.splice(from, 1);
  named.splice(Math.max(0, Math.min(toIndex, named.length)), 0, item);
  return [...loose, ...named];
}

/** Where a choice of the question at `questionId` may skip to: only later questions and later sections. A new question (no id) is the last of its section. */
export function skipTargets(groups: SurveyGroup[], questionId: string | null, sectionId: string | null) {
  const flat = flatten(groups);
  const ownGroup = questionId ? groups.findIndex(g => g.questions.some(q => q.id === questionId)) : groups.findIndex(g => (g.section?.id ?? null) === sectionId);
  const group = ownGroup === -1 ? groups.length - 1 : ownGroup;
  const at = questionId ? flat.findIndex(q => q.id === questionId) : flatten(groups.slice(0, group + 1)).length - 1;
  return {
    questions: flat.slice(at + 1),
    sections: groups.slice(group + 1).filter(g => g.section).map(g => g.section!),
  };
}

/** Why a choice's skip no longer works (null = it is fine, or there is no skip). Until fixed, scholars go to the next question. */
export function skipProblem(groups: SurveyGroup[], question: { id: string }, choice: OutlineChoice): string | null {
  const targets = skipTargets(groups, question.id, null);
  if (choice.skipToQuestionId) {
    if (targets.questions.some(q => q.id === choice.skipToQuestionId)) return null;
    return flatten(groups).some(q => q.id === choice.skipToQuestionId)
      ? "The question it skips to is no longer after this one."
      : "The question it skips to was deleted.";
  }
  if (choice.skipToSectionId) {
    if (targets.sections.some(s => s.id === choice.skipToSectionId)) return null;
    return groups.some(g => g.section?.id === choice.skipToSectionId)
      ? "The section it skips to is no longer after this one."
      : "The section it skips to was deleted.";
  }
  return null;
}

// ── The scholar's screen ──

export interface TakeAnswer { choiceId?: string; likertValue?: number; textValue?: string }
export interface TakeQuestion {
  id: string; questionType: SurveyQType; sectionId?: string | null; isOptional?: boolean;
  choices: { id: string; skipToQuestionId: string | null; endsSurvey: boolean }[];
}

export function isAnswered(question: TakeQuestion | undefined, answer: TakeAnswer | undefined): boolean {
  if (!question || !answer) return false;
  if (question.questionType === "multiple_choice") return !!answer.choiceId && question.choices.some(c => c.id === answer.choiceId);
  if (question.questionType === "likert") return answer.likertValue !== undefined;
  return !!answer.textValue?.trim();
}

export const canContinue = (question: TakeQuestion | undefined, answer: TakeAnswer | undefined): boolean => !!question && (!!question.isOptional || isAnswered(question, answer));

/** What comes after the question at `index`. Skips only ever go forward. */
export function resolveNextIndex(questions: TakeQuestion[], index: number, answer: TakeAnswer | undefined): number | "end" {
  const question = questions[index];
  if (question?.questionType === "multiple_choice" && answer?.choiceId) {
    const choice = question.choices.find(c => c.id === answer.choiceId);
    if (choice?.endsSurvey) return "end";
    if (choice?.skipToQuestionId) {
      const target = questions.findIndex(q => q.id === choice.skipToQuestionId);
      if (target > index) return target;
    }
  }
  return index + 1 < questions.length ? index + 1 : "end";
}

/** Replays the saved answers from the first question and stops at the first unanswered one on that path. */
export function buildInitialPath(questions: TakeQuestion[], answers: Record<string, TakeAnswer>): number[] {
  if (questions.length === 0) return [];
  const path = [0];
  for (;;) {
    const index = path[path.length - 1];
    const answer = answers[questions[index].id];
    if (!isAnswered(questions[index], answer)) return path;
    const next = resolveNextIndex(questions, index, answer);
    if (next === "end") return path;
    path.push(next);
  }
}

/** "Section 2 of 3 · Question 4 of 12" (12 = every question of the survey, so a skip can make the number jump). */
export function progressLabel(sections: { id: string }[], questions: TakeQuestion[], index: number): string {
  const question = `Question ${index + 1} of ${questions.length}`;
  const section = sections.findIndex(s => s.id === questions[index]?.sectionId);
  return section === -1 ? question : `Section ${section + 1} of ${sections.length} · ${question}`;
}

/** The section whose intro screen is due before the current question: the scholar is entering it (from another section, or at the start). */
export function introSectionId(questions: TakeQuestion[], path: number[]): string | null {
  const current = questions[path[path.length - 1]];
  if (!current?.sectionId) return null;
  const previous = path.length > 1 ? questions[path[path.length - 2]] : undefined;
  return previous?.sectionId === current.sectionId ? null : current.sectionId;
}
