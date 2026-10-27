-- UNDO for supabase_migration_renewal_scholar_list.sql: removes the Scholar List functions and the saved results table (the saved results are only a copy; the renewal records,
-- grades and SDP credits are not touched). The website tab then shows a notice that the list is not available.
drop function if exists public.renewal_scholar_sdp_credits(text, text, text);
drop function if exists public.renewal_scholar_list_options(text, text);
drop function if exists public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]);
drop function if exists public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer);
drop function if exists public.renewal_scholar_list_refresh(text, text, timestamptz, integer);
drop function if exists public._renewal_list_eligibility(jsonb);
drop table if exists public.renewal_scholar_list_cache;
notify pgrst, 'reload schema';
