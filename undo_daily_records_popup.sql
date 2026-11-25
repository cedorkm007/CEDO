-- undo_daily_records_popup.sql: the larger pop-up's drafts, quick phrases and scholar summary are switched off (the functions are removed).
-- The two small tables (the drafts and the quick phrases) are KEPT on purpose so nothing anybody typed is lost; they do nothing without the functions,
-- and running supabase_migration_daily_records_popup.sql again brings everything back. No record and no edit history is touched.
-- (Run this ONLY together with putting the previous website version back.)
begin;
drop function if exists public.counseling_draft_save(text, jsonb, integer);
drop function if exists public.counseling_draft_get(text);
drop function if exists public.counseling_draft_discard(text);
drop function if exists public.counseling_phrases_list();
drop function if exists public.counseling_phrase_save(uuid, text);
drop function if exists public.counseling_phrase_delete(uuid);
drop function if exists public.counseling_record_context(text, uuid, integer, integer);
notify pgrst, 'reload schema';
commit;
