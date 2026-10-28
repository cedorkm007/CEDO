-- ─────────────────────────────────────────────────────────────
-- IS ANYTHING OF THE RENEWAL TEST LEFT?   READ-ONLY.   Nothing is changed or deleted.
-- The revert found nothing to remove. This confirms what is (and is not) still in the database: the holding copy, the renewal data, and anything still
-- belonging to the test accounts (the testers of the testers-only windows). Scholar ID numbers, counts, states and dates only (no names). Send me all the rows.
-- ─────────────────────────────────────────────────────────────
with t as (select coalesce(array_agg(distinct x), '{}') as ids from public.renewal_windows w, unnest(w.testers) x where w.testers is not null)
select 1 as n, 'HOLDING COPY' as part, b.table_name as item, count(*)::text || ' rows, saved ' || min(b.saved_at)::date || ' to ' || max(b.saved_at)::date as value
  from public._renewal_test_backup b group by b.table_name
union all select 2, 'RENEWAL DATA NOW', 'applications', (select count(*) from public.renewal_records)::text
union all select 2, 'RENEWAL DATA NOW', 'renewal notices to scholars', (select count(*) from public.scholar_notifications where record_id is not null or kind in ('window_open', 'window_closing'))::text
union all select 2, 'RENEWAL DATA NOW', '"already told" marks', (select count(*) from public.renewal_notice_log)::text
union all select 2, 'RENEWAL DATA NOW', 'certificate records / counters', (select count(*) from public.csr_issued)::text || ' / ' || (select count(*) from public.csr_counters)::text
union all select 3, 'WINDOWS', w.term || ' ' || w.school_year, case when w.testers is null then 'open to everyone' else 'testers only (' || cardinality(w.testers) || ')' end || ', ' || w.opens_on || ' to ' || w.closes_on from public.renewal_windows w
union all select 4, 'TEST ACCOUNTS: still on file', 'consultation bookings not open, by state', coalesce((select string_agg(s.state || ': ' || s.c, ', ') from (select state, count(*) c from public.counseling_slots, t where state <> 'open' and scholar_id_number = any (t.ids) group by state) s), 'none')
union all select 4, 'TEST ACCOUNTS: still on file', 'consultation referrals', (select count(*) from public.scholar_counseling_referrals f, t where f.scholar_id_number = any (t.ids))::text
union all select 4, 'TEST ACCOUNTS: still on file', 'Daily Records', (select count(*) from public.scholar_counseling_records d, t where d.scholar_id_number = any (t.ids))::text
union all select 5, 'TEST ACCOUNTS: scholar status', s.scholar_id_number, s.status from public.scholars s, t where s.scholar_id_number = any (t.ids)
order by 1, 2, 3;
