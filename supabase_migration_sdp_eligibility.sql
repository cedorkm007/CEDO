-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_eligibility.sql
--
-- Phase 1 of the per-activity attendance monitor feature.
--
-- SDP activities gain the same year-level eligibility gating
-- formation_activities already has (supabase_migration_formation_activities.sql:9-10,15).
-- Existing rows are backfilled all_year_levels = true so today's "open to
-- every scholar" behavior is preserved for anything created before this
-- migration — only activities created/edited after this ships can
-- actually restrict by year level.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.sdp_activities add column if not exists target_year_levels text[] not null default '{}';
alter table public.sdp_activities add column if not exists all_year_levels boolean not null default false;

update public.sdp_activities
set all_year_levels = true
where all_year_levels = false and cardinality(target_year_levels) = 0;

alter table public.sdp_activities drop constraint if exists sdp_activities_year_level_check;
alter table public.sdp_activities add constraint sdp_activities_year_level_check
  check (all_year_levels or cardinality(target_year_levels) > 0);

-- Enforce it: the scholar-facing read policy ("scholar reads open
-- activities" — supabase_migration_sdp_remove_status_and_proposals.sql:23-25,
-- currently just `submitted_by_scholar_id is null`) gains the same
-- eligibility clause formation_activities' own read policy already uses.
drop policy if exists "scholar reads open activities" on public.sdp_activities;
create policy "scholar reads open activities" on public.sdp_activities for select
  using (
    submitted_by_scholar_id is null
    and (
      all_year_levels or exists (
        select 1 from public.scholars
        where scholars.id = auth.uid() and scholars.year_level = any(sdp_activities.target_year_levels)
      )
    )
  );
