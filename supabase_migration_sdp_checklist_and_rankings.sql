-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_checklist_and_rankings.sql
--
-- Three things:
--   1. scholars.year_level — needed for the new Rankings tab's "per year
--      level" filter (staff-managed, same as school/course — set via the
--      Bulk Update tool).
--   2. SDP proposal submission restricted to scholars who hold an actual
--      officer position (any Scholars' Formation Tools position other
--      than a plain "member" roster entry).
--   3. SDP overhaul: drops the point-accumulation system in favor of a
--      3-category checklist — Community Service, Community Volunteerism,
--      Formation Program. A category counts as complete once a scholar
--      has been credited attendance for at least one activity tagged with
--      that category. sdp_points / points_credited are left in place
--      (unused going forward) rather than dropped, so no historical data
--      is destroyed.
--
-- Run this AFTER supabase_migration_formation_positions.sql and
-- supabase_migration_sdp_points.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Year level ─────────────────────────────────────────────
alter table public.scholars add column if not exists year_level text not null default '';

-- ── 2. SDP category ──────────────────────────────────────────
alter table public.sdp_activities add column if not exists category text
  check (category is null or category in ('community_service', 'community_volunteerism', 'formation_program'));

-- security_invoker: enforces the querying user's own RLS on the
-- underlying tables (scholars, sdp_attendance, sdp_activities) — a
-- scholar querying this only ever sees their own row, staff see everyone's.
create or replace view public.scholar_sdp_category_status
with (security_invoker = true) as
select
  scholars.scholar_id_number,
  cat.category,
  exists (
    select 1
    from public.sdp_attendance att
    join public.sdp_activities act on act.id = att.activity_id
    where att.scholar_id_number = scholars.scholar_id_number
      and act.category = cat.category
  ) as completed
from (select distinct scholar_id_number from public.scholars) scholars
cross join (values ('community_service'), ('community_volunteerism'), ('formation_program')) as cat(category);

grant select on public.scholar_sdp_category_status to authenticated;

-- ── 3. SDP proposals restricted to formation officers ────────
-- Replaces the old "any scholar can propose" policy — now requires the
-- scholar to hold at least one Scholars' Formation Tools position that
-- isn't a plain "member" roster entry.
drop policy if exists "scholar inserts own sdp proposal" on public.sdp_activities;
create policy "scholar inserts own sdp proposal" on public.sdp_activities
  for insert with check (
    submitted_by_scholar_id = (select scholar_id_number from public.scholars where id = auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.formation_positions fp
      where fp.scholar_id_number = (select scholar_id_number from public.scholars where id = auth.uid())
        and fp.role_key <> 'member'
    )
  );
