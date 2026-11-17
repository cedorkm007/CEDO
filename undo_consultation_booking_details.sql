-- undo_consultation_booking_details.sql: the booking pop-up goes back to showing no course / year level / barangay / school / GWA. Only two functions are removed; no data was ever changed.
begin;

drop function if exists public.counseling_slot_scholar_info(uuid);
drop function if exists public._scholar_gwa_of_period(text, text, text);

notify pgrst, 'reload schema';
commit;
