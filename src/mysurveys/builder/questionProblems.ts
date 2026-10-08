import { isChoiceType, type QuestionItem } from "../surveyTypes";

/** Things worth fixing before the survey is published (shown as hints, never blocking auto-save). */
export function questionProblems(q: QuestionItem): string[] {
  const out: string[] = [];
  if (!q.text.trim()) out.push("Add the question text.");
  if (isChoiceType(q.type)) {
    if (q.options.length < 2) out.push("Add at least two options.");
    else if (q.options.some(o => !o.label.trim())) out.push("Some options are blank.");
  }
  return out;
}
