-- undo_consultation_dashboard_paging.sql: the Main Dashboard goes back to the earlier way (the old counts and the two full lists) once the website is also put back.
-- Removes the three new read-only functions and the two indexes. No record is changed or deleted; the older dashboard functions stay.
-- (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.scholar_counseling_dashboard_counts();
drop function if exists public.scholar_counseling_queue_page(integer, integer);
drop function if exists public.scholar_counseling_approved_page(text, integer, integer);
drop index if exists public.scholar_counseling_referrals_to_status_idx;
drop index if exists public.scholar_counseling_referrals_approved_idx;

notify pgrst, 'reload schema';
commit;
