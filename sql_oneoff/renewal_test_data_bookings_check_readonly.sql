-- ─────────────────────────────────────────────────────────────
-- WHICH CONSULTATION BOOKINGS STOPPED THE RENEWAL REVERT?   READ-ONLY.   Nothing is changed or deleted.
-- The revert stopped because 2 consultation bookings are linked to a renewal. This lists them (and any linked referral or Daily Record) so we can see
-- whether they belong to the test accounts or to real scholars. Scholar ID numbers, states and dates only (no names). Send me all the rows.
-- ─────────────────────────────────────────────────────────────
select 'BOOKING' as part, s.scholar_id_number as scholar, s.state as state, s.starts_at::text as starts_at, s.booked_at::text as booked_at,
       (select w.term || ' ' || w.school_year || case when w.testers is null then ' (window open to everyone)' else ' (testers-only window)' end
          from public.renewal_records r join public.renewal_windows w on w.id = r.window_id where r.id = s.record_id) as renewal_window,
       (select r.stage from public.renewal_records r where r.id = s.record_id) as renewal_stage,
       coalesce((select s.scholar_id_number = any (w.testers) from public.renewal_records r join public.renewal_windows w on w.id = r.window_id where r.id = s.record_id), false) as is_listed_test_account
from public.counseling_slots s
where s.state <> 'open' and s.record_id is not null
union all
select 'REFERRAL', f.scholar_id_number, f.status, f.created_at::text, null, null, null, null
from public.scholar_counseling_referrals f where f.renewal_record_id is not null
union all
select 'DAILY RECORD', d.scholar_id_number, null, d.created_at::text, null, null, null, null
from public.scholar_counseling_records d where d.renewal_record_id is not null
order by 1, 2;
