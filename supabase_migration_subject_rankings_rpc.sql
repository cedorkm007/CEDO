-- ─────────────────────────────────────────────────────────────
-- supabase_migration_subject_rankings_rpc.sql
--
-- Fixes Rankings — the other slow list found investigating "lists load
-- very slowly" on the admin side, and the worst of the two: its old
-- fetchSubjectRankings() paginated through every scholar with progress
-- in a subject (500-row pages, one full round trip per page), THEN
-- separately paginated through scholars.select().in(...) AGAIN (500-row
-- pages again) just to apply the year-level/school/barangay filters and
-- pull display fields — up to ~14+ sequential round trips for a popular
-- subject at this project's ~7,000-scholar scale. Worse, RankingsTab's
-- own effect re-runs this on every dependency change including the free-
-- text Barangay filter with no debounce, so every keystroke there
-- re-triggered the whole thing.
--
-- subject_rankings() does the same join, filter, sort, and rank
-- computation as one query in Postgres (row_number() over the sorted
-- set), returning only the (optionally top-N) rows actually displayed —
-- one round trip regardless of subject size or scholar count. Gated the
-- same way its sibling subject_progress_page() RPC already is
-- (is_sead_staff() — Quest Monitoring's existing tag), since this reads
-- the same scholar_subject_progress view under the same feature.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.subject_rankings(
  p_subject_id uuid,
  p_top_n integer default null,  -- null = every ranked scholar
  p_year_level text default null,
  p_school text default null,
  p_barangay text default null,
  p_barangay_in text[] default null
)
returns table (
  rank bigint,
  scholar_id_number text,
  scholar_name text,
  school text,
  year_level text,
  barangay text,
  subject_percentage numeric,
  topic_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    row_number() over (order by sp.subject_percentage desc) as rank,
    s.scholar_id_number,
    (s.first_name || ' ' || s.last_name) as scholar_name,
    s.school, s.year_level, s.barangay,
    sp.subject_percentage, sp.topic_count
  from public.scholar_subject_progress sp
  join public.scholars s on s.scholar_id_number = sp.scholar_id_number
  where public.is_sead_staff()
    and sp.subject_id = p_subject_id
    and sp.topic_count > 0
    and (p_year_level is null or s.year_level = p_year_level)
    and (p_school is null or s.school = p_school)
    and (p_barangay is null or s.barangay = p_barangay)
    and (p_barangay_in is null or s.barangay = any(p_barangay_in))
  order by sp.subject_percentage desc
  limit coalesce(p_top_n, 2147483647);
$$;

revoke all on function public.subject_rankings(uuid, integer, text, text, text, text[]) from public;
grant execute on function public.subject_rankings(uuid, integer, text, text, text, text[]) to authenticated;
