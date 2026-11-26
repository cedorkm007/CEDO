// Survey Tools: the staff calls added by supabase_migration_survey_sections_safety.sql. All the rules are enforced in the database.
import { supabase } from "@/lib/supabase";
import type { OutlineChoice, SurveyOutline, SurveyQType } from "@/lib/surveyBuilder";

export const SURVEY_SQL = "supabase_migration_survey_sections_safety.sql";
export type Result = { ok: true } | { ok: false; error: string };

const message = (error: { code?: string; message: string }) =>
  error.code === "PGRST202" || /could not find the function/i.test(error.message)
    ? `This needs the database update ${SURVEY_SQL}. Ask the administrator to run it.`
    : error.message;

async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  const { error } = await supabase.rpc(fn, args);
  return error ? { ok: false, error: message(error) } : { ok: true };
}

/** forResults: also the removed questions that have answers. */
export async function fetchSurveyOutline(surveyId: string, forResults = false): Promise<{ ok: true; outline: SurveyOutline } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("survey_outline", { p_survey_id: surveyId, p_results: forResults });
  if (error || !data) return { ok: false, error: error ? message(error) : "Couldn't load the survey." };
  return { ok: true, outline: data as SurveyOutline };
}

export interface QuestionPayload {
  id?: string;
  sectionId: string | null;
  questionType: SurveyQType;
  questionText: string;
  isOptional: boolean;
  likertScaleMin?: number;
  likertScaleMax?: number;
  likertMinLabel?: string;
  likertMaxLabel?: string;
  openEndedFormat?: "short" | "long";
  choices: OutlineChoice[];
}

/** newMeaning: something with answers was reworded AND its meaning changed, so the old answers stay on the earlier version. */
export const saveQuestion = (surveyId: string, question: QuestionPayload, newMeaning = false) =>
  call("survey_question_save", { p_survey_id: surveyId, p_question: question, p_new_meaning: newMeaning });
export const deleteQuestion = (questionId: string) => call("survey_question_delete", { p_question_id: questionId });
export const saveSection = (surveyId: string, sectionId: string | null, title: string, description: string) =>
  call("survey_section_save", { p_survey_id: surveyId, p_section_id: sectionId, p_title: title, p_description: description });
export const deleteSection = (sectionId: string, keepQuestions: boolean) => call("survey_section_delete", { p_section_id: sectionId, p_keep_questions: keepQuestions });
export const reorderSurvey = (surveyId: string, layout: { sectionId: string | null; questionIds: string[] }[]) => call("survey_reorder", { p_survey_id: surveyId, p_layout: layout });
export const importQuestions = (surveyId: string, items: (Omit<QuestionPayload, "sectionId" | "isOptional" | "id"> & { section?: string })[], sectionId: string | null) =>
  call("survey_questions_import", { p_survey_id: surveyId, p_items: items, p_section_id: sectionId });

export interface DeleteImpact { answers: number; finished: number; waiting: number }
export async function fetchDeleteImpact(surveyId: string): Promise<DeleteImpact | null> {
  const { data, error } = await supabase.rpc("survey_delete_impact", { p_survey_id: surveyId });
  return error || !data ? null : (data as DeleteImpact);
}
