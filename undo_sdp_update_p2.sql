-- UNDO for supabase_migration_sdp_update_p2_checklist_paging.sql
-- Removes the four new functions. The Checklist screen then uses the old way (the website downloads everyone and pages in the browser).
-- Nothing else is touched; the old functions were never changed.
drop function if exists public.scholars_sdp_checklist_page(text, text, text, text, text, text, integer, integer);
drop function if exists public.scholars_sdp_checklist_summary(text, text);
drop function if exists public._sdp_compliance_ids(text, text, text[]);
drop function if exists public._sdp_period_totals_ids(text, text, text[]);
notify pgrst, 'reload schema';
