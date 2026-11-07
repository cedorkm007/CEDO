-- Undo of supabase_migration_renewal_entered_grades_in_detail.sql: removes the read-only function. Nothing else was changed by that file.
drop function if exists public.renewal_record_entered_grades(uuid);
notify pgrst, 'reload schema';
