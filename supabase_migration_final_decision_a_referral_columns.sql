-- ─────────────────────────────────────────────────────────────
-- FINAL DECISION BY THE CONSULTING STAFF, FILE A: the referral table.   Safe to run twice.   Undo: undo_final_decision_a.sql
-- Run BEFORE supabase_migration_final_decision_b_functions.sql, AFTER the referral reason files.
-- Changes ONE table (scholar_counseling_referrals): a new status 'division_head_approved' (approved and signed by the Division Head, waiting for the consulting staff's
-- final decision) and two columns saying who made the final decision and when. Nothing is deleted. Gives up after 5 seconds if the site is busy (just run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.scholar_counseling_referrals add column if not exists finalized_by uuid references public.users(id) on delete set null;
alter table public.scholar_counseling_referrals add column if not exists finalized_at timestamptz;
alter table public.scholar_counseling_referrals drop constraint if exists scholar_counseling_referrals_status_check;
alter table public.scholar_counseling_referrals add constraint scholar_counseling_referrals_status_check
  check (status = any (array['awaiting_booking', 'booked', 'pending', 'forwarded_to_division_head', 'division_head_approved', 'reconsideration_requested', 'approved']));

notify pgrst, 'reload schema';
