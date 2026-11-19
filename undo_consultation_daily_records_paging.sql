-- undo_consultation_daily_records_paging.sql: the Daily Records page goes back to the earlier way (everything in one request) once the website is also put back. Removes the two new read-only functions and the five indexes.
-- No record is changed or deleted. (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.scholar_counseling_daily_records_page(text, date, date, text[], text[], uuid[], text, text, integer, integer, boolean);
drop function if exists public.scholar_counseling_consultants();
drop index if exists public.scholar_counseling_records_date_page_idx;
drop index if exists public.scholar_counseling_records_consulted_by_idx;
drop index if exists public.scholar_counseling_records_visit_type_idx;
drop index if exists public.scholar_counseling_records_status_idx;
drop index if exists public.scholars_lower_scholar_id_idx;

notify pgrst, 'reload schema';
commit;
