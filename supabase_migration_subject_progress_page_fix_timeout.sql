-- ─────────────────────────────────────────────────────────────
-- supabase_migration_subject_progress_page_fix_timeout.sql
--
-- subject_progress_page() (Quest Management Tools' "Scores & Progress"
-- tab) is the one remaining live caller of the public.scholar_subject_progress
-- view that isn't already scoped to a single scholar — it wants every
-- scholar's progress for one subject, paginated. That view is built on a
-- CROSS JOIN of every quest topic x every scholar plus a per-row
-- correlated subquery against scholar_quest_scores, whose cost "hinges
-- entirely on the planner pushing the subject_id filter through... before
-- the cross join runs" (see supabase_migration_subject_rankings_fix_timeout.sql,
-- which hit exactly this: instant with a literal subject_id, 25s+ with a
-- bound parameter — SECURITY DEFINER SQL functions are never inlined, so
-- every call here is planned generically against a parameter, never a
-- literal). subject_rankings() already got this fix; subject_progress_page()
-- didn't, and shares the identical risk.
--
-- Fix: identical technique — stop depending on scholar_subject_progress.
-- Filter quest_topics down to the one subject FIRST (a small CTE,
-- structurally guaranteed cheap regardless of how the planner treats the
-- parameter), pre-aggregate best-score-per-topic with a plain GROUP BY,
-- then LEFT JOIN that onto scholars x subject-topics. Same output
-- columns/semantics as before (topic_count is still "topics defined for
-- the subject," subject_percentage still averages 0 for any topic never
-- attempted, an unauthorized/tagless caller still gets zero rows).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.subject_progress_page(
  p_subject_id uuid,
  p_passed_filter text default 'all',
  p_limit integer default 10,
  p_offset integer default 0,
  p_year_level text default null,
  p_school text default null
)
returns table(
  scholar_id_number text, scholar_name text, topic_count bigint, subject_percentage numeric,
  passed boolean, total_count bigint, passed_count bigint, not_passed_count bigint,
  passing_rate_min numeric, passing_rate_max numeric
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_min numeric;
  v_max numeric;
begin
  select coalesce(quest_subjects.passing_rate_min, 75), coalesce(quest_subjects.passing_rate_max, 100)
    into v_min, v_max
    from quest_subjects where id = p_subject_id;

  return query
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
      (s.first_name || ' ' || s.last_name) as scholar_name,
      s.year_level, s.school,
      (select count(*) from subject_topics) as topic_count,
      avg(coalesce(bs.best_pct, 0)) as subject_percentage
    from public.scholars s
    cross join subject_topics st
    left join best_scores bs on bs.scholar_id_number = s.scholar_id_number and bs.topic_id = st.id
    group by s.scholar_id_number, s.first_name, s.last_name, s.year_level, s.school
  ),
  filtered as (
    select
      ps.scholar_id_number, ps.scholar_name, ps.topic_count, ps.subject_percentage,
      (ps.subject_percentage >= v_min and ps.subject_percentage <= v_max) as passed
    from per_scholar ps
    where (public.is_sead_staff() or public.has_staff_tag('quest_management'))
      and ps.topic_count > 0
      and (p_year_level is null or ps.year_level = p_year_level)
      and (p_school is null or ps.school ilike '%' || p_school || '%')
  ),
  agg as (
    select
      count(*) as total_count,
      count(*) filter (where filtered.passed) as passed_count,
      count(*) filter (where not filtered.passed) as not_passed_count
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
$function$;
