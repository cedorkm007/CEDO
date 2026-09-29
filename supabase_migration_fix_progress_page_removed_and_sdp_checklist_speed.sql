-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fix_progress_page_removed_and_sdp_checklist_speed.sql
--
-- Two independent fixes found during the admin-side slow-query audit:
--
-- 1. subject_progress_page() (Quest Management Tools' "Scores & Progress"
--    tab, rewritten in supabase_migration_subject_progress_page_fix_timeout.sql)
--    was missed when supabase_migration_scholar_removed_status.sql added a
--    "s.status <> 'Removed'" exclusion to every one of its sibling RPCs
--    (subject_rankings, subject_completion_status, scholars_by_*,
--    scholarship_status_counts) — a correctness gap, not a performance one:
--    Removed scholars still show up in this one tab's counts. Fixed by
--    adding the same exclusion here.
--
-- 2. scholars_sdp_checklist() (SDP Checklist tab) measured at ~1.5s per
--    1000-row page against a real staff session — the slowest thing found
--    on the admin side, needing ~8 sequential page loads (PostgREST's
--    1000-row cap, ~7,136 scholars) to fully load, roughly 10-12s total.
--    Root cause: for every scholar row it calls _sdp_period_credits()
--    three times (once per SDP category) plus three more correlated
--    subqueries against sdp_reserved_credits for the "reserved, unclaimed"
--    columns — 9 separate correlated-subquery evaluations per scholar,
--    ~64,000 total for one page. Fixed with the same technique as the
--    quest_subjects/subject_progress_page fixes: pre-aggregate each of the
--    three data sources ONCE with a plain GROUP BY (using FILTER to pivot
--    the 3 categories into columns), then LEFT JOIN those three small,
--    pre-computed sets onto scholars — same output values, computed via
--    3 aggregation scans instead of ~64,000 per-row subquery calls.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. subject_progress_page(): exclude Removed scholars ─────
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
    where s.status <> 'Removed'
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

-- ── 2. scholars_sdp_checklist(): pre-aggregate instead of per-row calls ──
drop function if exists public.scholars_sdp_checklist();

create or replace function public.scholars_sdp_checklist()
returns table(
  scholar_id_number text, name text,
  community_service integer, community_volunteerism integer, formation_program integer,
  community_service_reserved integer, community_volunteerism_reserved integer, formation_program_reserved integer
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_school_year text;
  v_semester text;
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  return query
  with period_attendance as (
    select
      a.scholar_id_number,
      sum(act.credits) filter (where act.category = 'community_service') as cs,
      sum(act.credits) filter (where act.category = 'community_volunteerism') as cv,
      sum(act.credits) filter (where act.category = 'formation_program') as fp
    from public.sdp_attendance a
    join public.sdp_activities act on act.id = a.activity_id
    where a.school_year = v_school_year and a.semester = v_semester
    group by a.scholar_id_number
  ),
  claimed_this_period as (
    select
      rc.scholar_id_number,
      sum(rc.amount) filter (where rc.category = 'community_service') as cs,
      sum(rc.amount) filter (where rc.category = 'community_volunteerism') as cv,
      sum(rc.amount) filter (where rc.category = 'formation_program') as fp
    from public.sdp_reserved_credits rc
    where rc.claimed and rc.claimed_school_year = v_school_year and rc.claimed_semester = v_semester
    group by rc.scholar_id_number
  ),
  unclaimed_reserved as (
    select
      rc.scholar_id_number,
      sum(rc.amount) filter (where rc.category = 'community_service') as cs,
      sum(rc.amount) filter (where rc.category = 'community_volunteerism') as cv,
      sum(rc.amount) filter (where rc.category = 'formation_program') as fp
    from public.sdp_reserved_credits rc
    where not rc.claimed
    group by rc.scholar_id_number
  )
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name,
    (coalesce(pa.cs, 0) + coalesce(cp.cs, 0))::integer,
    (coalesce(pa.cv, 0) + coalesce(cp.cv, 0))::integer,
    (coalesce(pa.fp, 0) + coalesce(cp.fp, 0))::integer,
    coalesce(ur.cs, 0)::integer,
    coalesce(ur.cv, 0)::integer,
    coalesce(ur.fp, 0)::integer
  from public.scholars s
  left join period_attendance pa on pa.scholar_id_number = s.scholar_id_number
  left join claimed_this_period cp on cp.scholar_id_number = s.scholar_id_number
  left join unclaimed_reserved ur on ur.scholar_id_number = s.scholar_id_number
  where s.status <> 'Removed'
  order by s.last_name, s.first_name;
end;
$function$;

revoke all on function public.scholars_sdp_checklist() from public;
grant execute on function public.scholars_sdp_checklist() to authenticated;
