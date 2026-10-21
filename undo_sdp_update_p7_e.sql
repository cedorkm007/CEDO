-- UNDO for supabase_migration_sdp_update_p7_e_undone_column.sql: removes the "undone" column again ("Undo upload" then stops working, as it does today).
-- Nothing else is touched.
set lock_timeout = '5s';
alter table public.sead_scholar_account_log drop column if exists undone;
