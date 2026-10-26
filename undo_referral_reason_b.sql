-- UNDO for supabase_migration_referral_reason_b_slots.sql. Run it AFTER undo_referral_reason_c.sql.
-- Removes the one-booking-per-referral rule and the link from a booking to a referral, but only when no booking is linked to a referral (otherwise the link would be lost):
-- then it only removes the rule and says so. Nothing is deleted.
set lock_timeout = '5s';
drop index if exists public.counseling_slots_one_booking_per_referral;
do $$
begin
  if not exists (select 1 from public.counseling_slots where referral_id is not null) then
    alter table public.counseling_slots drop column if exists referral_id;
  else
    raise notice 'Some bookings belong to a referral, so the link column was NOT removed (it is harmless).';
  end if;
end $$;
notify pgrst, 'reload schema';
