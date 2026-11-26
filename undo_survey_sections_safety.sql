-- undo_survey_sections_safety.sql: switches off the Phase 2 rules and removes the new staff functions.
-- WHAT IT DOES: surveys with answers can be deleted again, new surveys start active again, deactivating no longer gives waiting credits,
--   and the new editor in the app stops working (use the previous app version).
-- WHAT IT KEEPS ON PURPOSE, so nothing is lost: sections, removed questions and choices stay stored and stay hidden from scholars
--   (the scholar-side survey steps stay as Phase 2 made them), and questions keep their new positions.
-- Answers and credits are never touched.
begin;

drop trigger if exists survey_release_on_deactivate on public.research_surveys;
drop trigger if exists survey_activation on public.research_surveys;
drop trigger if exists survey_protect_delete on public.research_surveys;
drop trigger if exists survey_keep_answered_choice on public.research_survey_choices;
drop trigger if exists survey_keep_answered_question on public.research_survey_questions;
drop trigger if exists survey_question_placement on public.research_survey_questions;
drop function if exists public._survey_release_on_deactivate();
drop function if exists public._survey_activation();
drop function if exists public._survey_protect_delete();
drop function if exists public._survey_keep_answered_choice();
drop function if exists public._survey_keep_answered_question();
drop function if exists public._survey_question_placement();
alter table public.research_surveys alter column is_active set default true;

drop function if exists public.survey_questions_import(uuid, jsonb, uuid);
drop function if exists public.survey_reorder(uuid, jsonb);
drop function if exists public.survey_section_delete(uuid, boolean);
drop function if exists public.survey_section_save(uuid, uuid, text, text);
drop function if exists public.survey_question_delete(uuid);
drop function if exists public.survey_question_save(uuid, jsonb, boolean);
drop function if exists public.survey_delete_impact(uuid);
drop function if exists public.survey_outline(uuid, boolean);
drop function if exists public._survey_add_section(uuid, text, text);
drop function if exists public._survey_keep_one_question(uuid);
drop function if exists public._survey_remove_question(uuid);
drop function if exists public._survey_require_staff(uuid);
drop function if exists public._survey_renumber(uuid);

notify pgrst, 'reload schema';
commit;
