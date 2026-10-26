-- ─────────────────────────────────────────────────────────────
-- CONSULTATION REFERRAL BY REASON, FILE B of 3: the booking table (counseling_slots).   Safe to run twice.   Undo: undo_referral_reason_b.sql
-- Run AFTER supabase_migration_referral_reason_a_referrals.sql and AFTER the two consultation-types files.
--
-- A booking can now belong to a REFERRAL (a staff referral for a consultation) instead of a renewal application. This adds the link, and the rule that one referral can
-- hold only one booking at a time. Changes ONE table; nothing is deleted. Gives up after 5 seconds if the site is busy (just run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.counseling_slots add column if not exists referral_id uuid references public.scholar_counseling_referrals(id) on delete set null;
create unique index if not exists counseling_slots_one_booking_per_referral on public.counseling_slots (referral_id) where state = 'booked' and referral_id is not null;

notify pgrst, 'reload schema';
