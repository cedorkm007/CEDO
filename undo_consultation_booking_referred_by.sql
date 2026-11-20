-- undo_consultation_booking_referred_by.sql: the booked appointment's pop-up no longer shows "Referred by". Removes the one read-only function. No record is changed or deleted.
-- (The website works without it: the line is simply left out. Run this only if you want it gone.)
begin;

drop function if exists public.counseling_slot_referrer(uuid);

notify pgrst, 'reload schema';
commit;
