-- undo_survey_delete_response.sql: removes the option to delete and restore survey responses.
-- Responses already deleted STAY deleted (their copies are kept in the database). If you want any back, restore them in the app BEFORE running this.
begin;
drop function if exists public.survey_restore_response(uuid);
drop function if exists public.survey_deleted_list(uuid);
drop function if exists public.survey_delete_response(uuid, text, uuid, text);
drop function if exists public._survey_actor_name();
-- survey_deleted_responses (the copies) and the "deleted" mark on responses are kept, so the list still hides what was deleted.
notify pgrst, 'reload schema';
commit;
