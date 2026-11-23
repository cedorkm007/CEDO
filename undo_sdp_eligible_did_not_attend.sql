-- undo_sdp_eligible_did_not_attend.sql: the "Eligible, did not attend" list of the Credited Scholars tab goes away (the rest of the tab is not affected).
-- Removes the three new read-only functions. No credit, scholar or history line is changed or deleted.
-- (The website shows the button with a notice that the database update is missing; run this only together with putting the previous website version back.)
begin;

drop function if exists public.sdp_eligible_summary(uuid);
drop function if exists public.sdp_eligible_did_not_attend_page(uuid, text, integer, integer);
drop function if exists public._sdp_eligible_did_not_attend(uuid);

notify pgrst, 'reload schema';
commit;
