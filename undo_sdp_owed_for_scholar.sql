-- UNDO for supabase_migration_sdp_owed_for_scholar.sql: the scholar's SDP tab no longer lists the credits added for the coming semesters (the requirement itself is not touched).
drop function if exists public.fetch_scholar_sdp_owed();

notify pgrst, 'reload schema';
