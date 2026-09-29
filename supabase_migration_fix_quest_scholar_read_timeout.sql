-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fix_quest_scholar_read_timeout.sql
--
-- Bug: "a lot of scholars can't see the subjects in the Quest tab."
--
-- Root cause, confirmed live by impersonating real scholar accounts via
-- admin-generated sessions and timing their own queries: the scholar-read
-- policies on quest_subjects/quest_topics (supabase_migration_quiz_v2.sql)
-- are written as
--
--   using (auth.uid() in (select id from public.scholars))
--
-- The inner `select id from public.scholars` is a normal (not security
-- definer) query, so it is itself subject to `scholars`' OWN row-level
-- security policies — three of them, OR'd together per row: `id =
-- auth.uid()`, `is_cedo_staff()` (a security-definer lookup against
-- public.users), and `school_id = public.current_school_id()` (a
-- security-definer lookup against public.school_accounts). Because the
-- outer query can't push the `auth.uid() = id` equality down through that
-- RLS-guarded subquery, Postgres ends up re-checking all three OR'd
-- policy branches for every one of the (currently ~7,100) scholars rows,
-- for every one of the outer quest_subjects/quest_topics rows being read.
-- At this table size that's slow enough to blow the statement timeout on
-- a cold cache, which is exactly what a real scholar experiences as "the
-- Quest tab is just empty" — fetchQuizSubjects()/fetchQuizTopics() treat
-- any query error as "no subjects" (see quizApi.ts), so a timeout looks
-- identical to a genuinely empty result. Reproduced directly: querying
-- quest_subjects as a real scholar session took 7-8+ seconds and timed
-- out entirely in 2 of 3 trials, spaced 3 seconds apart with no other
-- load on the database — i.e. this isn't a concurrency/load artifact,
-- it fails cold, on its own, essentially every time.
--
-- Fix: replace the correlated/RLS-recursive subquery with a SECURITY
-- DEFINER helper, the same "is_cedo_staff()/is_sead_staff()/
-- has_staff_tag()" idiom already used everywhere else in this schema —
-- security definer functions run as their (table-owning) definer, so the
-- exists() check inside never re-triggers scholars' own RLS at all, and
-- resolves via a single primary-key index lookup instead of an N×M scan.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_scholar()
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.scholars where id = auth.uid());
$$;
grant execute on function public.is_scholar() to authenticated;

drop policy if exists "scholar reads quest subjects" on public.quest_subjects;
create policy "scholar reads quest subjects" on public.quest_subjects
  for select using (public.is_scholar());

drop policy if exists "scholar reads quest topics" on public.quest_topics;
create policy "scholar reads quest topics" on public.quest_topics
  for select using (public.is_scholar());
