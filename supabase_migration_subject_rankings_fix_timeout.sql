-- ─────────────────────────────────────────────────────────────
-- supabase_migration_subject_rankings_fix_timeout.sql
--
-- Fixes a statement timeout in subject_rankings() (added in
-- supabase_migration_subject_rankings_rpc.sql) that only showed up for
-- real authenticated calls, not for a raw SQL query with a literal
-- subject_id typed directly into it. Root cause: SECURITY DEFINER SQL
-- functions are never inlined by the planner, so subject_rankings()'s
-- internal query gets planned generically against p_subject_id as a
-- bound PARAMETER, not the literal value used when testing by hand.
-- That generic plan doesn't get to see "only 9 rows match" ahead of
-- time, and the underlying scholar_subject_progress VIEW is built on a
-- CROSS JOIN (every quest topic x every scholar) plus a PER-ROW
-- correlated subquery against scholar_quest_scores — a structure whose
-- cost hinges entirely on the planner pushing the subject_id filter
-- through the view's GROUP BY before the cross join runs. With a
-- literal value it did; with a bound parameter it evidently didn't,
-- and the query ran long enough to hit the 8s statement_timeout on the
-- authenticated role (confirmed by simulating a real authenticated
-- session against this database directly: the identical call that
-- takes ~450ms as a literal took 25s+ as a parameter).
--
-- Fix: stop depending on scholar_subject_progress altogether here.
-- Filter quest_topics down to the one subject FIRST (a 3-row CTE,
-- trivially cheap and structurally guaranteed regardless of how the
-- planner treats the parameter), pre-aggregate best-score-per-topic
-- with a plain GROUP BY (using the existing
-- idx_scholar_quest_scores_topic index), then LEFT JOIN that small,
-- pre-computed set onto scholars x subject-topics — a shape that's
-- efficient no matter whether the planner knows the exact selectivity
-- of p_subject_id ahead of time. Same output columns/semantics as
-- before (topic_count is still "topics defined for the subject",
-- subject_percentage still averages 0 for any topic never attempted).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.subject_rankings(
  p_subject_id uuid,
  p_top_n integer default null,
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
  with subject_topics as (
    select id from public.quest_topics where subject_id = p_subject_id
  ),
  best_scores as (
    select sqs.scholar_id_number, sqs.topic_id,
      max(sqs.score / nullif(sqs.max_score, 0)) * 100 as best_pct
    from public.scholar_quest_scores sqs
    join subject_topics st on st.id = sqs.topic_id
    group by sqs.scholar_id_number, sqs.topic_id
  ),
  per_scholar as (
    select
      s.scholar_id_number,
      (select count(*) from subject_topics) as topic_count,
      avg(coalesce(bs.best_pct, 0)) as subject_percentage
    from public.scholars s
    cross join subject_topics st
    left join best_scores bs on bs.scholar_id_number = s.scholar_id_number and bs.topic_id = st.id
    group by s.scholar_id_number
  )
  select
    row_number() over (order by ps.subject_percentage desc) as rank,
    s.scholar_id_number,
    (s.first_name || ' ' || s.last_name) as scholar_name,
    s.school, s.year_level, s.barangay,
    ps.subject_percentage, ps.topic_count
  from per_scholar ps
  join public.scholars s on s.scholar_id_number = ps.scholar_id_number
  where public.is_sead_staff()
    and ps.topic_count > 0
    and (p_year_level is null or s.year_level = p_year_level)
    and (p_school is null or s.school = p_school)
    and (p_barangay is null or s.barangay = p_barangay)
    and (p_barangay_in is null or s.barangay = any(p_barangay_in))
  order by ps.subject_percentage desc
  limit coalesce(p_top_n, 2147483647);
$$;

revoke all on function public.subject_rankings(uuid, integer, text, text, text, text[]) from public;
grant execute on function public.subject_rankings(uuid, integer, text, text, text, text[]) to authenticated;
