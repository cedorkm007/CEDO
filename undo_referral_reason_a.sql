-- UNDO for supabase_migration_referral_reason_a_referrals.sql. Run it AFTER undo_referral_reason_c.sql and undo_referral_reason_b.sql.
-- Puts back "a referral always names a counselor" and the original list of statuses, but only when no referral needs the new ones (a referral with no counselor, or one
-- waiting for the scholar to book / booked). Otherwise that part is skipped and a notice says so. The reason column stays (it is harmless). Nothing is deleted.
set lock_timeout = '5s';
do $$
begin
  if not exists (select 1 from public.scholar_counseling_referrals where status in ('awaiting_booking', 'booked')) then
    alter table public.scholar_counseling_referrals drop constraint if exists scholar_counseling_referrals_status_check;
    alter table public.scholar_counseling_referrals add constraint scholar_counseling_referrals_status_check
      check (status = any (array['pending', 'forwarded_to_division_head', 'reconsideration_requested', 'approved']));
  else
    raise notice 'Some referrals are waiting for the scholar to book or are booked, so the list of statuses was NOT put back.';
  end if;
  if not exists (select 1 from public.scholar_counseling_referrals where referred_to is null) then
    alter table public.scholar_counseling_referrals alter column referred_to set not null;
  else
    raise notice 'Some referrals have no counselor yet, so "a referral always names a counselor" was NOT put back.';
  end if;
end $$;
notify pgrst, 'reload schema';
