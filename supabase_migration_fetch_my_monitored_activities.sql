-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fetch_my_monitored_activities.sql
--
-- Bug found via live testing: the "Scanning Tools" tile grid
-- (fetchMyMonitoredActivities() in activityMonitorsApi.ts) queried
-- sdp_activities/formation_activities directly and relied on RLS to
-- scope the result to just the caller's own monitored activities. That
-- doesn't work — both tables' pre-existing scholar-facing SELECT policies
-- are identity-agnostic for any row with all_year_levels = true (which is
-- every existing activity, per the Phase 1 backfill): the policy's own
-- OR short-circuits true for ANY authenticated caller, staff or scholar,
-- regardless of monitor status. So a monitor account saw every activity,
-- not just their own — RLS being broader than expected isn't a security
-- hole here (this data was already effectively public), but it broke the
-- feature's whole point.
--
-- Fix: a dedicated SECURITY DEFINER RPC that explicitly filters by
-- is_activity_monitor(), so the result is correct regardless of what
-- else RLS happens to permit.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.fetch_my_monitored_activities()
returns table (activity_type text, id uuid, name text, pubmat_path text)
language sql
stable
security definer
set search_path = public
as $$
  select 'sdp'::text, a.id, a.name, a.pubmat_path
  from public.sdp_activities a
  where public.is_activity_monitor('sdp', a.id)
  union all
  select 'formation'::text, a.id, a.name, a.pubmat_path
  from public.formation_activities a
  where public.is_activity_monitor('formation', a.id);
$$;
grant execute on function public.fetch_my_monitored_activities() to authenticated;
