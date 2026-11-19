-- undo_consultation_probation_paging.sql: the Probationary Monitoring tab goes back to the earlier way (every probationary scholar and every renewal in one request) once the website is also put back.
-- Removes the three new read-only functions and the three indexes. No record is changed or deleted. (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.scholar_probation_monitoring_page(text, text[], text, text, text, integer, integer, integer, integer);
drop function if exists public.scholar_probation_renewal_detail(text, integer);
drop function if exists public._probation_recent_terms(integer);
drop index if exists public.scholars_probationary_name_idx;
drop index if exists public.renewal_inc_items_open_idx;
drop index if exists public.renewal_records_scholar_term_idx;

notify pgrst, 'reload schema';
commit;
