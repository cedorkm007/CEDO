-- ─────────────────────────────────────────────────────────────
-- renewal_status_history_backfill_preview.sql
--
-- READ-ONLY PREVIEW. Run this in the Supabase SQL Editor AFTER supabase_migration_renewal_p1_foundations.sql. It changes NOTHING.
--
-- Scholar status history only started when the Phase 1 migration was applied. This preview shows what the separate "apply" script
-- (renewal_status_history_backfill_apply.sql) would add so that earlier probation is not lost, using the two places the system
-- already kept an old status:
--   * counseling Daily Records (each visit stored the scholar's status at that visit), and
--   * Division Head-approved referrals (On Probation Status / Removal / Renewal), dated by the approval.
-- Plus one "baseline" row per scholar whose current status is not yet in their history, so today's status is always on record
-- (its real start date is unknown).
--
-- Read the numbers, then tell Claude "backfill approved" (or what to change). The result is ONE table: a summary first, then a
-- sample of the rows that would be added.
-- ─────────────────────────────────────────────────────────────
with visits as (
  select r.scholar_id_number, r.status, r.date_visited,
         lag(r.status) over (partition by r.scholar_id_number order by r.date_visited, r.created_at) as prev_status
  from public.scholar_counseling_records r
),
visit_rows as (   -- a row only when the status differs from the previous visit's
  select scholar_id_number, status, date_visited::timestamptz as changed_at, 'counseling_record'::text as source
  from visits where prev_status is distinct from status
),
referral_rows as (
  select f.scholar_id_number,
         case f.endorsed_for when 'On Probation Status' then 'Probationary' when 'Removal' then 'Removed' when 'Renewal' then 'Regular' end as status,
         f.approved_at as changed_at, 'referral'::text as source
  from public.scholar_counseling_referrals f
  where f.status = 'approved' and f.approved_at is not null
),
history_rows as (
  select * from visit_rows union all select * from referral_rows
),
new_rows as (     -- skip anything already recorded (so re-running this never doubles up)
  select h.* from history_rows h
  where h.status is not null
    and not exists (select 1 from public.scholar_status_history x
                    where x.scholar_id_number = h.scholar_id_number and x.status = h.status and x.source = h.source and x.changed_at = h.changed_at)
),
baseline_rows as (
  select s.scholar_id_number, s.status, now() as changed_at, 'baseline'::text as source
  from public.scholars s
  where not exists (select 1 from public.scholar_status_history x where x.scholar_id_number = s.scholar_id_number and x.status = s.status)
    and not exists (select 1 from new_rows n where n.scholar_id_number = s.scholar_id_number and n.status = s.status)   -- a visit / referral row above already records it
),
all_new as (select * from new_rows union all select * from baseline_rows),
probation_before as (   -- scholars who would count as having had REGULAR probation once everything is added
  select distinct scholar_id_number from all_new where status = 'Probationary'
  union select scholar_id_number from public.scholar_status_history where status = 'Probationary' and not is_temporary
),
summary(sort_key, label, value) as (
  select 1, 'Scholars (all statuses)', (select count(*) from public.scholars)::text
  union all select 2, 'Scholars whose current status is Probationary', (select count(*) from public.scholars where status = 'Probationary')::text
  union all select 3, 'History rows already recorded (since the migration)', (select count(*) from public.scholar_status_history)::text
  union all select 4, 'Counseling-visit rows that would be added', (select count(*) from new_rows where source = 'counseling_record')::text
  union all select 5, '   of which Probationary', (select count(*) from new_rows where source = 'counseling_record' and status = 'Probationary')::text
  union all select 6, 'Approved-referral rows that would be added', (select count(*) from new_rows where source = 'referral')::text
  union all select 7, '   of which On Probation Status (Probationary)', (select count(*) from new_rows where source = 'referral' and status = 'Probationary')::text
  union all select 8, '   of which Removal (Removed)', (select count(*) from new_rows where source = 'referral' and status = 'Removed')::text
  union all select 9, '   of which Renewal (Regular)', (select count(*) from new_rows where source = 'referral' and status = 'Regular')::text
  union all select 10, 'Baseline rows that would be added (current status, date unknown)', (select count(*) from baseline_rows)::text
  union all select 11, 'Total rows that would be added', (select count(*) from all_new)::text
  union all select 12, 'Scholars who would count as having had regular probation afterwards', (select count(*) from probation_before)::text
  union all select 13, '   of which ONLY because their current status is Probationary', (select count(*) from probation_before p
        where not exists (select 1 from new_rows n where n.scholar_id_number = p.scholar_id_number and n.status = 'Probationary')
          and not exists (select 1 from public.scholar_status_history h where h.scholar_id_number = p.scholar_id_number and h.status = 'Probationary' and not h.is_temporary))::text
),
sample as (
  select 100 + row_number() over (order by changed_at desc, scholar_id_number) as sort_key,
         'Sample: ' || scholar_id_number || ' → ' || status || ' (' || source || ', ' || to_char(changed_at, 'YYYY-MM-DD') || ')' as label,
         '' as value
  from (select * from all_new where source <> 'baseline' order by changed_at desc limit 25) t
)
select label, value from (select * from summary union all select * from sample) u order by sort_key;
