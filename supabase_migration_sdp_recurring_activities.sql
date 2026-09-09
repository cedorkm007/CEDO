-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_recurring_activities.sql
--
-- Adds a "Type of Activity" field (One-time / Recurring) to SDP
-- activities. A recurring activity can later be updated with a growing
-- list of occurrence dates (e.g. a weekly meeting's actual session
-- dates), tracked as a plain timestamptz array on the row rather than
-- a child table — same "small array column, no join needed" choice
-- already used for nature/source_of_fund/target_partners on this table.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.sdp_activities add column if not exists activity_type text not null default 'one_time';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sdp_activities_activity_type_check'
  ) then
    alter table public.sdp_activities
      add constraint sdp_activities_activity_type_check check (activity_type in ('one_time', 'recurring'));
  end if;
end $$;

alter table public.sdp_activities add column if not exists recurring_dates timestamptz[] not null default '{}';
