-- UNDO for supabase_migration_renewal_window_schools_a_column.sql. Run it AFTER undo_renewal_window_schools_b.sql.
-- Removes the list of chosen schools from the renewal windows table (every window is then for everyone, as before). The list itself is lost; nothing else is touched.
set lock_timeout = '5s';
alter table public.renewal_windows drop column if exists school_ids;
notify pgrst, 'reload schema';
