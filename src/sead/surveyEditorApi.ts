// Survey Tools: the staff calls added by supabase_migration_survey_sections_safety.sql. All the rules are enforced in the database.
import { supabase } from "@/lib/supabase";
import type { OutlineChoice, SurveyOutline, SurveyQType } from "@/lib/surveyBuilder";

export const SURVEY_SQL = "supabase_migration_survey_sections_safety.sql";
export type Result = { ok: true } | { ok: false; error: string };

const message = (error: { code?: string; message: string }) =>
  error.code === "PGRST202" || /could not find the function/i.test(error.message)
    ? `This needs a newer database update (${SURVEY_SQL} or supabase_migration_survey_delete_response.sql). Ask the administrator to run it.`
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

// ── Deleting a response (supabase_migration_survey_delete_response.sql). A copy is kept and can be restored. ──
export const deleteSurveyResponse = (surveyId: string, scholarIdNumber: string, activityId: string | null, reason: string) =>
  call("survey_delete_response", { p_survey_id: surveyId, p_scholar_id_number: scholarIdNumber, p_activity_id: activityId, p_reason: reason || null });

export interface DeletedResponse {
  id: string; scholarIdNumber: string; scholarName: string; activityName: string; answerCount: number; reason: string | null; deletedBy: string; deletedAt: string;
}
/** null when it could not be read (also before the database update). */
export async function fetchDeletedResponses(surveyId: string): Promise<DeletedResponse[] | null> {
  const { data, error } = await supabase.rpc("survey_deleted_list", { p_survey_id: surveyId });
  return error || !data ? null : (data as DeletedResponse[]);
}
/** lost: answers that could not come back because their question or choice no longer exists. */
export async function restoreSurveyResponse(deletedId: string): Promise<{ ok: true; lost: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("survey_restore_response", { p_deleted_id: deletedId });
  return error ? { ok: false, error: message(error) } : { ok: true, lost: Number(data ?? 0) };
}
