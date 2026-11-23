-- undo_sdp_credited_scholars_paging.sql: the Credited Scholars tab goes back to the earlier way once the website is also put back.
-- Removes the new functions and indexes. No credit, scholar or history line is changed or deleted; the existing credit functions (credit_attended_scholars, move_sdp_credit_semester, ...) stay as they are.
-- (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.sdp_credited_summary(uuid);
drop function if exists public.sdp_credited_page(uuid, text, text, text, boolean, text, text, integer, integer);
drop function if exists public.sdp_not_credited_page(uuid, text, integer, integer);
drop function if exists public.sdp_credit_selected(uuid, text[], text, text);
drop function if exists public.sdp_move_credits_semester(uuid[], text, text);
drop function if exists public.sdp_search_scholars(text, uuid, integer);
drop function if exists public._sdp_can_manage_credits(uuid);
drop index if exists public.sdp_attendance_activity_date_idx;
drop index if exists public.sdp_attendance_activity_period_idx;
drop index if exists public.scholars_full_name_trgm_idx;
drop index if exists public.scholars_full_name_rev_trgm_idx;

notify pgrst, 'reload schema';
commit;
