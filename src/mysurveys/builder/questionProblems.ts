import { isChoiceType, type QuestionItem } from "../surveyTypes";

/** Things worth fixing before the survey is published (shown as hints, never blocking auto-save). */
export function questionProblems(q: QuestionItem): string[] {
  const out: string[] = [];
  if (!q.text.trim()) out.push("Add the question text.");
  if (isChoiceType(q.type)) {
    if (q.options.length < 2) out.push("Add at least two options.");
    else if (q.options.some(o => !o.label.trim())) out.push("Some options are blank.");
  }
  if (q.type === "checkboxes" && q.maxSelections !== null && q.maxSelections !== undefined) {
    if (!Number.isInteger(q.maxSelections) || q.maxSelections < 1) out.push("The selection limit must be at least 1.");
    else if (q.options.length >= 2 && q.maxSelections >= q.options.length) out.push("The selection limit is not lower than the number of options, so it has no effect.");
  }
  return out;
}
