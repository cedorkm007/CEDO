// The demo copy of the database lacks the real "on delete" rules between some tables; these are the ones the project's SQL files define.
// (Used by the survey tests.)
export async function realSurveyRules(db) {
  const q = async (sql, p = []) => (await db.query(sql, p)).rows;
  // The demo copy's links between the survey tables lack the real "on delete" rules; give them the ones the project's SQL files define.
  for (const r of await q("select c.conname, c.conrelid::regclass::text t from pg_constraint c where c.contype = 'f' and c.conrelid::regclass::text like 'research_survey%' and c.conrelid::regclass::text not in ('research_survey_sections', 'research_survey_activities')")) {
    await db.exec(`alter table public.${r.t} drop constraint "${r.conname}"`);
  }
  for (const [table, column, target, onDelete] of [
    ["research_surveys", "sdp_activity_id", "sdp_activities", "cascade"], ["research_surveys", "formation_activity_id", "formation_activities", "cascade"], ["research_surveys", "quest_subject_id", "quest_subjects", "cascade"],
    ["research_survey_questions", "survey_id", "research_surveys", "cascade"], ["research_survey_questions", "section_id", "research_survey_sections", "set null"], ["research_survey_questions", "previous_id", "research_survey_questions", "set null"],
    ["research_survey_choices", "question_id", "research_survey_questions", "cascade"], ["research_survey_choices", "skip_to_question_id", "research_survey_questions", "set null"],
    ["research_survey_choices", "skip_to_section_id", "research_survey_sections", "set null"], ["research_survey_choices", "previous_id", "research_survey_choices", "set null"],
    ["research_survey_responses", "survey_id", "research_surveys", "cascade"],
    ["research_survey_answers", "response_id", "research_survey_responses", "cascade"], ["research_survey_answers", "question_id", "research_survey_questions", "cascade"], ["research_survey_answers", "choice_id", "research_survey_choices", "cascade"],
  ]) await db.exec(`alter table public.${table} add foreign key (${column}) references public.${target}(id) on delete ${onDelete}`);
  // attendance sessions go with their activity, and their rows with them (also as in the SQL files)
  for (const [table, column, target] of [["attendance_sessions", "sdp_activity_id", "sdp_activities"], ["attendance_records", "session_id", "attendance_sessions"], ["attendance_codes", "session_id", "attendance_sessions"], ["scholar_attendance_finalized_notifications", "session_id", "attendance_sessions"]]) {
    for (const r of await q("select c.conname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.conrelid = $1::regclass and a.attname = $2", ["public." + table, column])) await db.exec(`alter table public.${table} drop constraint "${r.conname}"`);
    await db.exec(`alter table public.${table} add foreign key (${column}) references public.${target}(id) on delete cascade`);
  }
}
