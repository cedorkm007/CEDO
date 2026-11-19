-- undo_consultation_calendar_paging.sql: the all-staff (read-only) consultation calendar goes back to the earlier way (every booking of the day or week in one request) once the website is also put back.
-- Removes the three new read-only functions and the two indexes. No record is changed or deleted; the older calendar functions stay.
-- (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.renewal_calendar_summary(timestamptz, timestamptz, uuid);
drop function if exists public.renewal_calendar_bookings_page(date, text, uuid, integer, integer);
drop function if exists public.renewal_calendar_ranges(timestamptz, timestamptz, uuid, integer);
drop index if exists public.counseling_slots_booked_day_idx;
drop index if exists public.counseling_availability_start_idx;

notify pgrst, 'reload schema';
commit;
