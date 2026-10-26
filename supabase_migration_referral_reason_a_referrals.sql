-- ─────────────────────────────────────────────────────────────
-- CONSULTATION REFERRAL BY REASON, FILE A of 3: the referral table.   Safe to run twice.   Undo: undo_referral_reason_a.sql
-- Run this FIRST, on its own, then _b_slots, then _c_functions.
--
-- A referral used to name the counselor ("Refer to"). Now staff choose only the REASON for the consultation (one of the consultation types), the scholar is told and
-- chooses a day and morning / afternoon, and the booking decides which counselor holds it. So a referral may have NO counselor yet, and it needs two new steps before
-- it reaches the counselor's queue:
--   awaiting_booking  the scholar has been referred and has not booked yet (new)
--   booked            the scholar booked; the consultation has not happened yet (new)
--   pending           the consultation happened: the referral is in the counselor's queue (as before)
--   forwarded_to_division_head / reconsideration_requested / approved   (as before)
-- Changes ONE table: the counselor becomes optional, the reason is added (optional: older referrals have none), and the allowed statuses include the two new ones.
-- Nothing is deleted. Gives up after 5 seconds if the site is busy (just run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.scholar_counseling_referrals alter column referred_to drop not null;
alter table public.scholar_counseling_referrals add column if not exists reason text;

-- the old list of allowed statuses is replaced (whatever it is called on the project, the one that lists the statuses)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.scholar_counseling_referrals'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%forwarded_to_division_head%'
  loop
    execute format('alter table public.scholar_counseling_referrals drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.scholar_counseling_referrals drop constraint if exists scholar_counseling_referrals_status_check;
alter table public.scholar_counseling_referrals add constraint scholar_counseling_referrals_status_check
  check (status = any (array['awaiting_booking', 'booked', 'pending', 'forwarded_to_division_head', 'reconsideration_requested', 'approved']));

notify pgrst, 'reload schema';
