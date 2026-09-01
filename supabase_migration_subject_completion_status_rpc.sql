-- ─────────────────────────────────────────────────────────────
-- supabase_migration_subject_completion_status_rpc.sql
--
-- New quest monitoring tasks, Task 2: backs Quest Monitoring's new
-- "Completion Status" sub-tab. Per the person's own confirmed
-- definition (not assumed — this project's standing practice is to ask
-- rather than guess on a genuinely ambiguous design call):
--   completed         = attempted every topic in the subject at least
--                        once, regardless of score
--   did_not_complete  = attempted at least one topic, but not all
--   not_attempted     = zero topics attempted
-- Deliberately NOT tied to passing_rate_min/max at all — a distinct
-- concept from subject_progress_page's own pass/fail split
-- (supabase_migration_subject_progress_page_rpc.sql), which this
-- migration does not touch.
--
-- Why this needs its own query rather than reusing
-- scholar_subject_progress (the view subject_progress_page is built on):
-- that view CROSS JOINs every topic against every scholar and defaults
-- an unattempted topic's score to 0% (supabase_migration_subject_
-- passing_rate.sql) — meaning a scholar who never touched a subject and
-- one who attempted every topic but scored 0% on all of them are
-- currently indistinguishable there; both show subject_percentage = 0.
-- This RPC closes that gap with a real EXISTS-style check (distinct
-- topic_id count from scholar_quest_scores) rather than a percentage
-- threshold.
--
-- quest_subjects has no year-level targeting column (confirmed directly
-- against its CREATE TABLE, supabase_migration_sead_staff.sql) — every
-- scholar is eligible for every subject system-wide, matching
-- scholar_subject_progress's own unconditional cross join. p_year_level/
-- p_school below are display/narrowing filters only, not an eligibility
-- gate — same convention subject_progress_page already established.
--
-- Safe to re-run — create or replace throughout, no prior version of
-- this function has ever existed so no DROP is needed.
-- ─────────────────────────────────────────────────────────────

create or replace function public.subject_completion_status(
  p_subject_id uuid,
  p_status_filter text default 'all',  -- 'all' | 'completed' | 'did_not_complete' | 'not_attempted'
  p_limit integer default 10,
  p_offset integer default 0,
  p_year_level text default null,
  p_school text default null
)
returns table (
  scholar_id_number text,
  scholar_name text,
  year_level text,
  school text,
  topics_attempted bigint,
  total_topics bigint,
  status text,
  total_count bigint,
  completed_count bigint,
  did_not_complete_count bigint,
  not_attempted_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_total_topics bigint;
begin
  select count(*) into v_total_topics from quest_topics where subject_id = p_subject_id;

  return query
  with attempt_counts as (
    select
      s.scholar_id_number,
      (s.first_name || ' ' || s.last_name) as scholar_name,
      s.year_level, s.school,
      count(distinct sqs.topic_id) as topics_attempted
    from scholars s
    left join scholar_quest_scores sqs
      on sqs.scholar_id_number = s.scholar_id_number
      and sqs.subject_id = p_subject_id
    where public.is_sead_staff()
      and (p_year_level is null or s.year_level = p_year_level)
      and (p_school is null or s.school ilike '%' || p_school || '%')
    group by s.scholar_id_number, s.first_name, s.last_name, s.year_level, s.school
  ),
  classified as (
    select
      ac.*,
      case
        when ac.topics_attempted = 0 then 'not_attempted'
        when v_total_topics > 0 and ac.topics_attempted >= v_total_topics then 'completed'
        else 'did_not_complete'
      end as status
    from attempt_counts ac
  ),
  agg as (
    select
      count(*) as total_count,
      count(*) filter (where classified.status = 'completed') as completed_count,
      count(*) filter (where classified.status = 'did_not_complete') as did_not_complete_count,
      count(*) filter (where classified.status = 'not_attempted') as not_attempted_count
    from classified
  )
  select
    c.scholar_id_number, c.scholar_name, c.year_level, c.school,
    c.topics_attempted, v_total_topics, c.status,
    agg.total_count, agg.completed_count, agg.did_not_complete_count, agg.not_attempted_count
  from classified c cross join agg
  where p_status_filter = 'all' or c.status = p_status_filter
  order by c.scholar_name
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.subject_completion_status(uuid, text, integer, integer, text, text) from public;
grant execute on function public.subject_completion_status(uuid, text, integer, integer, text, text) to authenticated;
