-- ─────────────────────────────────────────────────────────────
-- supabase_migration_bulawanong_convert_to_voucher.sql
--
-- One-time data fix, requested directly: convert "BULAWANONG BAHANDI
-- 2026" (sdp_activities.id = c30ac99b-cb2c-4609-9919-0be284a0f197,
-- attendance_sessions.id = f458b05f-a741-4d30-b1dd-e13758ac810a) from
-- time_in/time_out attendance to a 4-hour voucher, including scholars
-- who already scanned under the old scheme (confirmed before running:
-- 200 expected attendees, 400 codes — 200 time_in + 200 time_out —
-- with 134 time_in and 1 time_out already redeemed; 134 distinct
-- scholars have redeemed at least one code).
--
-- 1. Session type/duration -> voucher, 4 hours.
-- 2. Every code's kind -> voucher, whether already claimed or not —
--    an already-claimed code stays claimed by the same scholar (its
--    redeemed_by_scholar_id/redeemed_at are untouched), just relabeled.
-- 3. Every scholar who redeemed at least one code (time_in or
--    time_out) is treated as having redeemed the voucher: their
--    attendance_records row is set to status='present',
--    hours_earned=4, voucher_redemption_count>=1 — this already
--    correctly no-ops for the one scholar who'd completed both time_in
--    and time_out (their row already exists and was already
--    'present').
-- 4. Each such scholar is granted the activity's sdp_attendance credit
--    exactly once (occurrence_number=1, on-conflict-do-nothing, so
--    the one scholar already credited under the old scheme is not
--    double-credited) — but only if their SDP category isn't already
--    at the 3-credit completion threshold, mirroring
--    redeem_attendance_code()'s own category cap exactly, so this
--    backfill produces the same result a live scan would have.
--
-- Wrapped in a transaction: either the whole conversion applies, or
-- none of it does.
-- ─────────────────────────────────────────────────────────────

begin;

update public.attendance_sessions
set type = 'voucher', duration_hours = 4
where id = 'f458b05f-a741-4d30-b1dd-e13758ac810a';

update public.attendance_codes
set kind = 'voucher'
where session_id = 'f458b05f-a741-4d30-b1dd-e13758ac810a';

with affected_scholars as (
  select distinct redeemed_by_scholar_id as scholar_id_number
  from public.attendance_codes
  where session_id = 'f458b05f-a741-4d30-b1dd-e13758ac810a' and redeemed_by_scholar_id is not null
)
insert into public.attendance_records (session_id, scholar_id_number, hours_earned, status, voucher_redemption_count)
select 'f458b05f-a741-4d30-b1dd-e13758ac810a', scholar_id_number, 4, 'present', 1
from affected_scholars
on conflict (session_id, scholar_id_number) do update
  set hours_earned = 4,
      status = 'present',
      voucher_redemption_count = greatest(attendance_records.voucher_redemption_count, 1),
      updated_at = now();

with affected_scholars as (
  select distinct redeemed_by_scholar_id as scholar_id_number
  from public.attendance_codes
  where session_id = 'f458b05f-a741-4d30-b1dd-e13758ac810a' and redeemed_by_scholar_id is not null
),
activity_info as (
  select id as activity_id, category from public.sdp_activities where id = 'c30ac99b-cb2c-4609-9919-0be284a0f197'
)
insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number)
select ai.activity_id, s.scholar_id_number, current_date, null, 1
from affected_scholars s, activity_info ai
where coalesce((
  select sum(act.credits) from public.sdp_attendance a join public.sdp_activities act on act.id = a.activity_id
  where a.scholar_id_number = s.scholar_id_number and act.category = ai.category
), 0) < 3
on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;

commit;
