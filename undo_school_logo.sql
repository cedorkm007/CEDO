-- UNDO for supabase_migration_school_logo.sql: the three functions and the table are removed.
-- WARNING: this deletes every logo the schools uploaded. Nothing else is touched.
drop function if exists public.school_remove_logo();
drop function if exists public.school_set_logo(text);
drop function if exists public.school_get_logo();
drop table if exists public.school_logos;
notify pgrst, 'reload schema';
