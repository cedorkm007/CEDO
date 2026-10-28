-- UNDO for supabase_migration_sdp_reconsideration_a_tables.sql. Run it AFTER undo_sdp_reconsideration_c.sql and undo_sdp_reconsideration_b.sql.
-- Removes the two tables (every request, decision and "credits owed" row in them is lost). Nothing else is touched.
drop table if exists public.sdp_reconsideration_debts;
drop table if exists public.sdp_reconsideration_requests;
notify pgrst, 'reload schema';
