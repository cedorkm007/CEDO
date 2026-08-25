-- ─────────────────────────────────────────────────────────────
-- supabase_migration_subject_progress_page_rpc.sql
--
-- Fixes Quest Monitoring → Scores & Progress → "Passing Rate Progress":
-- fetchSubjectProgress() loaded EVERY scholar enrolled in a subject (all
-- pages via a .range() loop) plus an .in() scholar-name lookup built from
-- that full id list — for a subject with hundreds/thousands of scholars,
-- both the volume of data pulled and the size of that .in() list is what
-- was actually making this slow, not just something to paginate for
-- display. subject_progress_page() computes the pass/fail split as a
-- real Postgres aggregate over the FULL set and returns only one page of
-- already-joined (real JOIN, not a separate id-list lookup) rows, with an
-- optional server-side passed/not-passed filter — the feature requested
-- alongside the performance fix, not a separate concern bolted on after.
--
-- Passing logic (pct >= min and pct <= max) is copied exactly from the
-- existing client-side fetchSubjectProgress() calculation — not
-- reinterpreted — so results before and after this migration match for
-- the same data.
--
-- Safe to re-run — create or replace throughout.
-- ─────────────────────────────────────────────────────────────

create or replace function public.subject_progress_page(
  p_subject_id uuid,
  p_passed_filter text default 'all',  -- 'all' | 'passed' | 'not_passed'
  p_limit integer default 10,
  p_offset integer default 0
)
returns table (
  scholar_id_number text,
  scholar_name text,
  topic_count integer,
  subject_percentage numeric,
  passed boolean,
  total_count bigint,
  passed_count bigint,
  not_passed_count bigint,
  passing_rate_min numeric,
  passing_rate_max numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_min numeric;
  v_max numeric;
begin
  select coalesce(passing_rate_min, 75), coalesce(passing_rate_max, 100)
    into v_min, v_max
    from quest_subjects where id = p_subject_id;

  return query
  with filtered as (
    select
      sp.scholar_id_number,
      (s.first_name || ' ' || s.last_name) as scholar_name,
      sp.topic_count, sp.subject_percentage,
      (sp.subject_percentage >= v_min and sp.subject_percentage <= v_max) as passed
    from scholar_subject_progress sp
    join scholars s on s.scholar_id_number = sp.scholar_id_number
    where public.is_sead_staff()
      and sp.subject_id = p_subject_id
      and sp.topic_count > 0
  ),
  agg as (
    select
      count(*) as total_count,
      count(*) filter (where passed) as passed_count,
      count(*) filter (where not passed) as not_passed_count
    from filtered
  )
  select f.scholar_id_number, f.scholar_name, f.topic_count, f.subject_percentage, f.passed,
    agg.total_count, agg.passed_count, agg.not_passed_count, v_min, v_max
  from filtered f cross join agg
  where p_passed_filter = 'all'
    or (p_passed_filter = 'passed' and f.passed)
    or (p_passed_filter = 'not_passed' and not f.passed)
  order by f.subject_percentage desc, f.scholar_name
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.subject_progress_page(uuid, text, integer, integer) from public;
grant execute on function public.subject_progress_page(uuid, text, integer, integer) to authenticated;

-- NOTE: no CREATE INDEX here. scholar_subject_progress is a VIEW
-- (supabase_migration_subject_passing_rate.sql — `create or replace view
-- public.scholar_subject_progress ... avg(best_pct) as subject_percentage`),
-- not a table — subject_percentage is a live aggregate, not a stored
-- column, and PostgreSQL cannot index a plain view directly. An earlier
-- version of this file had a `create index ... on
-- public.scholar_subject_progress(...)` line here, which is exactly what
-- failed when this migration was run — that line has been removed. This
-- RPC still works correctly without it; a real index to speed up
-- sorting/filtering on subject_percentage at scale would require
-- converting this view to a materialized view with a refresh strategy,
-- which is a bigger, deliberate change than this migration intended —
-- worth deciding separately, not silently bundled in here.
