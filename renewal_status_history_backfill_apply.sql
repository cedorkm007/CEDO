-- ─────────────────────────────────────────────────────────────
-- renewal_status_history_backfill_apply.sql
--
-- APPLY the status-history backfill. Run this ONLY AFTER you have read the result of renewal_status_history_backfill_preview.sql and said
-- "backfill approved". It ADDS rows to scholar_status_history; it never changes or deletes a scholar, a status, or any existing
-- history row. Safe to run twice (anything already recorded is skipped).
--
-- Adds, exactly as the preview described:
--   * a history row for each counseling Daily Record whose status differs from the scholar's previous visit,
--   * a history row for each Division Head-approved referral (dated by the approval, with who approved it),
--   * a "baseline" row for each scholar whose current status is not yet in their history (real start date unknown).
-- ─────────────────────────────────────────────────────────────
with visits as (
  select r.scholar_id_number, r.status, r.date_visited,
         lag(r.status) over (partition by r.scholar_id_number order by r.date_visited, r.created_at) as prev_status
  from public.scholar_counseling_records r
)
insert into public.scholar_status_history (scholar_id_number, status, previous_status, is_temporary, changed_at, source, note)
select v.scholar_id_number, v.status, v.prev_status, false, v.date_visited::timestamptz, 'counseling_record', 'Status recorded at a counseling visit'
from visits v
where v.prev_status is distinct from v.status
  and exists (select 1 from public.scholars s where s.scholar_id_number = v.scholar_id_number)
  and not exists (select 1 from public.scholar_status_history x
                  where x.scholar_id_number = v.scholar_id_number and x.status = v.status and x.source = 'counseling_record' and x.changed_at = v.date_visited::timestamptz);

insert into public.scholar_status_history (scholar_id_number, status, previous_status, is_temporary, changed_by, changed_at, source, note)
select f.scholar_id_number,
       case f.endorsed_for when 'On Probation Status' then 'Probationary' when 'Removal' then 'Removed' when 'Renewal' then 'Regular' end,
       null, false, (select u.id from public.users u where u.id = f.approved_by), f.approved_at, 'referral',
       'Division Head approved a referral endorsed for ' || f.endorsed_for
from public.scholar_counseling_referrals f
where f.status = 'approved' and f.approved_at is not null
  and f.endorsed_for in ('On Probation Status', 'Removal', 'Renewal')
  and exists (select 1 from public.scholars s where s.scholar_id_number = f.scholar_id_number)
  and not exists (select 1 from public.scholar_status_history x
                  where x.scholar_id_number = f.scholar_id_number and x.source = 'referral' and x.changed_at = f.approved_at
                    and x.status = case f.endorsed_for when 'On Probation Status' then 'Probationary' when 'Removal' then 'Removed' when 'Renewal' then 'Regular' end);

insert into public.scholar_status_history (scholar_id_number, status, previous_status, is_temporary, changed_at, source, note)
select s.scholar_id_number, s.status, null, false, now(), 'baseline', 'Status when history started — the real start date is unknown'
from public.scholars s
where not exists (select 1 from public.scholar_status_history x where x.scholar_id_number = s.scholar_id_number and x.status = s.status);

-- Result check (shown in the SQL editor)
select
  (select count(*) from public.scholar_status_history) as history_rows_now,
  (select count(*) from public.scholar_status_history where source = 'counseling_record') as from_counseling_records,
  (select count(*) from public.scholar_status_history where source = 'referral') as from_referrals,
  (select count(*) from public.scholar_status_history where source = 'baseline') as baseline_rows,
  (select count(distinct scholar_id_number) from public.scholar_status_history where status = 'Probationary' and not is_temporary) as scholars_with_regular_probation;
