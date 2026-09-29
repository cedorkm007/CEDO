-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fix_scholar_profile_load_timeout.sql
--
-- Bug: "the profile of each scholar takes some time to load" — the Scholar
-- Portal's initial "Loading your profile…" screen waits on 8 queries in
-- parallel (ScholarPortalPage.tsx), and several of them share the exact
-- same RLS anti-pattern already fixed for quest_subjects/quest_topics in
-- supabase_migration_fix_quest_scholar_read_timeout.sql: a scholar-read
-- policy that filters through a normal (non-security-definer) subquery
-- against public.scholars, which is itself RLS-protected, so Postgres
-- ends up re-checking scholars' own policies far more than necessary.
--
-- Confirmed live, by impersonating real scholar accounts and timing their
-- own queries (same method as the quest_subjects fix):
--   scholar_quest_scores            : up to 8.4s, sometimes timed out
--   attendance_records (pending_survey lookup, fetchMyPendingSurveys)  : up to 6.1s
--   scholar_sdp_category_status     : up to 2.9s (inconsistent)
-- scholar_subjects_grades/scholar_sdp/formation_positions use the same
-- shape and are fixed the same way pre-emptively, even though they timed
-- fast in testing today — they will hit the same wall as those tables grow.
--
-- Fix, same idiom as the quest_subjects fix: a SECURITY DEFINER helper
-- that resolves the caller's own scholar_id_number with a single primary
-- key lookup, bypassing scholars' RLS entirely instead of re-triggering it.
--
-- attendance_records' scholar-read policy was never captured in any
-- tracked migration (another instance of this codebase's recurring "live
-- definition drifted from tracked SQL" pattern) — this migration also
-- closes that gap by dropping whatever scholar-facing SELECT policy
-- currently exists there (by introspection, since its exact live name
-- isn't known) and replacing it with the fast, tracked version.
--
-- scholar_sdp_category_status turned out to no longer be the view
-- supabase_migration_sdp_checklist_and_rankings.sql created — it was
-- converted to a real TABLE live at some point (kept in sync by the
-- recompute_sdp_category_status() trigger, per supabase_migration_sdp_credits.sql's
-- own note), with no tracked migration ever defining its RLS. This
-- migration gives it a proper, fast, tracked scholar-read policy for the
-- first time, using the same current_scholar_id_number() helper.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.current_scholar_id_number()
returns text
language sql
stable
security definer
as $$
  select scholar_id_number from public.scholars where id = auth.uid();
$$;
grant execute on function public.current_scholar_id_number() to authenticated;

-- ── scholar_quest_scores ────────────────────────────────────
drop policy if exists "scholar reads own quest scores" on public.scholar_quest_scores;
create policy "scholar reads own quest scores" on public.scholar_quest_scores
  for select using (scholar_id_number = public.current_scholar_id_number());

-- ── scholar_subjects_grades ─────────────────────────────────
drop policy if exists "scholar reads own grades" on public.scholar_subjects_grades;
create policy "scholar reads own grades" on public.scholar_subjects_grades
  for select using (scholar_id_number = public.current_scholar_id_number());

-- ── scholar_sdp ──────────────────────────────────────────────
drop policy if exists "scholar reads own sdp" on public.scholar_sdp;
create policy "scholar reads own sdp" on public.scholar_sdp
  for select using (scholar_id_number = public.current_scholar_id_number());

-- ── formation_positions (already selective, standardized for consistency) ──
drop policy if exists "scholar reads own positions" on public.formation_positions;
create policy "scholar reads own positions" on public.formation_positions
  for select using (scholar_id_number = public.current_scholar_id_number());

-- ── attendance_records: replace whatever scholar-facing SELECT policy is
--    currently live (name unknown/untracked) with the fast version, while
--    leaving the two known staff SELECT policies untouched ──
do $$
declare
  pol record;
begin
  for pol in
    select polname from pg_policy
    where polrelid = 'public.attendance_records'::regclass
      and polcmd = 'r'
      and polname not in ('cedo monitors read attendance records', 'sdp monitors read attendance records')
  loop
    execute format('drop policy if exists %I on public.attendance_records', pol.polname);
  end loop;
end $$;

create policy "scholar reads own attendance" on public.attendance_records
  for select using (scholar_id_number = public.current_scholar_id_number());

-- ── scholar_sdp_category_status: it's a real table now (see note above),
--    not the view its original migration created — give it RLS for the
--    first time, replacing whatever untracked policy (if any) is live ──
alter table public.scholar_sdp_category_status enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select polname from pg_policy
    where polrelid = 'public.scholar_sdp_category_status'::regclass and polcmd = 'r'
  loop
    execute format('drop policy if exists %I on public.scholar_sdp_category_status', pol.polname);
  end loop;
end $$;

drop policy if exists "staff full access" on public.scholar_sdp_category_status;
create policy "staff full access" on public.scholar_sdp_category_status for all
  using (public.is_cedo_staff()) with check (public.is_cedo_staff());

create policy "scholar reads own sdp category status" on public.scholar_sdp_category_status
  for select using (scholar_id_number = public.current_scholar_id_number());

create index if not exists idx_scholar_sdp_category_status_scholar on public.scholar_sdp_category_status (scholar_id_number);
create index if not exists idx_sdp_attendance_scholar_id on public.sdp_attendance (scholar_id_number);
