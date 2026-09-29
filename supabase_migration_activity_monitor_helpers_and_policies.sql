-- ─────────────────────────────────────────────────────────────
-- supabase_migration_activity_monitor_helpers_and_policies.sql
--
-- Phase 2 of the per-activity attendance monitor feature.
--
-- is_activity_monitor()/has_any_monitor_assignment() follow the exact
-- security-definer idiom already used throughout this schema (is_scholar(),
-- current_scholar_id_number() — supabase_migration_fix_quest_scholar_read_timeout.sql).
--
-- IMPORTANT: this migration never touches (drops/replaces) any existing
-- policy on sdp_activities/formation_activities — it only ADDS new,
-- supplementary UPDATE and SELECT policies scoped to is_activity_monitor().
-- Postgres RLS ORs together every applicable policy for a given command,
-- so this purely widens access via the new monitor path without needing
-- to know or touch whatever policy already governs staff access today
-- (confirmed untracked/live-only for sdp_activities — see the Phase 1
-- migration's own note). This is different from, and safer than, the
-- "drop and rebuild" pattern used in supabase_migration_fix_scholar_profile
-- _load_timeout.sql, which was necessary there only because the old
-- policy was itself the performance bug being removed — there's no such
-- need here.
--
-- Confirmed via direct code search: Formation Activities has no tool-
-- specific staff_account_tags key at all (it's nested under Scholar
-- Management Tools, gated purely by is_sead_staff()) — unlike SDP
-- Monitoring, which is gated by has_staff_tag('sdp_monitoring'). The
-- "who manages the monitor list" policy below reflects this: SDP checks
-- is_sead_staff() OR has_staff_tag('sdp_monitoring'); Formation checks
-- is_sead_staff() alone.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_activity_monitor(p_activity_type text, p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.activity_monitors m
      where m.activity_type = p_activity_type and m.activity_id = p_activity_id and m.staff_id = auth.uid()
    )
    or (p_activity_type = 'sdp' and exists (
      select 1 from public.sdp_activities a where a.id = p_activity_id and a.created_by = auth.uid()
    ))
    or (p_activity_type = 'formation' and exists (
      select 1 from public.formation_activities a where a.id = p_activity_id and a.created_by = auth.uid()
    ));
$$;
grant execute on function public.is_activity_monitor(text, uuid) to authenticated;

create or replace function public.has_any_monitor_assignment()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.activity_monitors where staff_id = auth.uid())
    or exists (select 1 from public.sdp_activities where created_by = auth.uid())
    or exists (select 1 from public.formation_activities where created_by = auth.uid());
$$;
grant execute on function public.has_any_monitor_assignment() to authenticated;

-- ── activity_monitors' own RLS ──────────────────────────────────
drop policy if exists "read activity monitors" on public.activity_monitors;
create policy "read activity monitors" on public.activity_monitors for select
  using (
    public.is_sead_staff() or public.has_staff_tag('sdp_monitoring') or staff_id = auth.uid()
  );

drop policy if exists "manage activity monitors" on public.activity_monitors;
create policy "manage activity monitors" on public.activity_monitors for all
  using (
    (activity_type = 'sdp' and (
      public.is_sead_staff() or public.has_staff_tag('sdp_monitoring')
      or exists (select 1 from public.sdp_activities a where a.id = activity_id and a.created_by = auth.uid())
    ))
    or (activity_type = 'formation' and (
      public.is_sead_staff()
      or exists (select 1 from public.formation_activities a where a.id = activity_id and a.created_by = auth.uid())
    ))
  )
  with check (
    (activity_type = 'sdp' and (
      public.is_sead_staff() or public.has_staff_tag('sdp_monitoring')
      or exists (select 1 from public.sdp_activities a where a.id = activity_id and a.created_by = auth.uid())
    ))
    or (activity_type = 'formation' and (
      public.is_sead_staff()
      or exists (select 1 from public.formation_activities a where a.id = activity_id and a.created_by = auth.uid())
    ))
  );

-- ── Additive monitor access on the activity tables themselves ──
drop policy if exists "monitors update sdp activities" on public.sdp_activities;
create policy "monitors update sdp activities" on public.sdp_activities for update
  using (public.is_activity_monitor('sdp', id)) with check (public.is_activity_monitor('sdp', id));

drop policy if exists "monitors read own sdp activities" on public.sdp_activities;
create policy "monitors read own sdp activities" on public.sdp_activities for select
  using (public.is_activity_monitor('sdp', id));

drop policy if exists "monitors update formation activities" on public.formation_activities;
create policy "monitors update formation activities" on public.formation_activities for update
  using (public.is_activity_monitor('formation', id)) with check (public.is_activity_monitor('formation', id));

drop policy if exists "monitors read own formation activities" on public.formation_activities;
create policy "monitors read own formation activities" on public.formation_activities for select
  using (public.is_activity_monitor('formation', id));
