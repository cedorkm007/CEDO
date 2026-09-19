-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_removed_status.sql
--
-- Adds a 5th scholarship status, "Removed", used to silo scholars who have
-- left the program into their own tab while deactivating their login.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / DROP+ADD.
--
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query).
-- ─────────────────────────────────────────────────────────────

-- 1. Allow 'Removed' as a scholars.status value, and remember what a
--    scholar's status was right before removal so "Restore" can put it back.
alter table public.scholars drop constraint if exists scholars_status_check;
alter table public.scholars add constraint scholars_status_check
  check (status = any (array['Regular'::text, 'Probationary'::text, 'On leave'::text, 'Reconsidered'::text, 'Removed'::text]));

alter table public.scholars add column if not exists status_before_removal text;
alter table public.scholars drop constraint if exists scholars_status_before_removal_check;
alter table public.scholars add constraint scholars_status_before_removal_check
  check (status_before_removal is null or status_before_removal = any (array['Regular'::text, 'Probationary'::text, 'On leave'::text, 'Reconsidered'::text]));

-- 2. Exclude Removed scholars from full-roster monitoring views. Each RPC
--    below already enumerates every scholar (not just those with activity
--    history) — the only change here is adding a status exclusion.

create or replace function public.scholars_by_barangay()
 returns table(barangay text, scholar_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.barangay, count(*) as scholar_count
  from public.scholars s
  where s.status <> 'Removed'
  group by s.barangay;
end;
$function$;

create or replace function public.scholars_by_school()
 returns table(school text, scholar_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.school, count(*) as scholar_count
  from public.scholars s
  where s.school is not null and s.school != '' and s.status <> 'Removed'
  group by s.school;
end;
$function$;

create or replace function public.scholars_by_school_year_level(p_school text)
 returns table(year_level text, scholar_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.year_level, count(*) as scholar_count
  from public.scholars s
  where s.school = p_school and s.year_level is not null and s.year_level != '' and s.status <> 'Removed'
  group by s.year_level;
end;
$function$;

create or replace function public.scholars_by_school_year_level_course(p_school text, p_year_level text)
 returns table(course text, scholar_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.course, count(*) as scholar_count
  from public.scholars s
  where s.school = p_school and s.year_level = p_year_level and s.course is not null and s.course != '' and s.status <> 'Removed'
  group by s.course;
end;
$function$;

create or replace function public.scholars_sdp_checklist()
 returns table(scholar_id_number text, name text, community_service boolean, community_volunteerism boolean, formation_program boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name as name,
    coalesce(bool_or(st.category = 'community_service' and st.completed), false) as community_service,
    coalesce(bool_or(st.category = 'community_volunteerism' and st.completed), false) as community_volunteerism,
    coalesce(bool_or(st.category = 'formation_program' and st.completed), false) as formation_program
  from public.scholars s
  left join public.scholar_sdp_category_status st on st.scholar_id_number = s.scholar_id_number
  where public.has_staff_tag('sdp_monitoring') and s.status <> 'Removed'
  group by s.scholar_id_number, s.first_name, s.last_name
  order by s.last_name, s.first_name;
$function$;

create or replace function public.search_scholars(p_search text DEFAULT ''::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort_column text DEFAULT NULL::text, p_sort_direction text DEFAULT 'asc'::text)
 returns table(id uuid, scholar_id_number text, first_name text, last_name text, middle_name text, school text, status text, total_count bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id, s.scholar_id_number, s.first_name, s.last_name, s.middle_name,
    s.school, s.status, count(*) over () as total_count
  from public.scholars s
  where public.is_sead_staff()
    and s.status <> 'Removed'
    and (
      nullif(trim(p_search), '') is null
      or s.scholar_id_number ilike '%' || trim(p_search) || '%'
      or s.first_name ilike '%' || trim(p_search) || '%'
      or s.last_name ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.first_name, s.last_name) ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.last_name, s.first_name) ilike '%' || trim(p_search) || '%'
    )
  order by
    case when p_sort_column = 'scholarIdNumber' and p_sort_direction = 'asc' then s.scholar_id_number end asc,
    case when p_sort_column = 'scholarIdNumber' and p_sort_direction = 'desc' then s.scholar_id_number end desc,
    case when p_sort_column = 'name' and p_sort_direction = 'asc' then concat_ws(' ', s.last_name, s.first_name) end asc,
    case when p_sort_column = 'name' and p_sort_direction = 'desc' then concat_ws(' ', s.last_name, s.first_name) end desc,
    case when p_sort_column = 'school' and p_sort_direction = 'asc' then s.school end asc,
    case when p_sort_column = 'school' and p_sort_direction = 'desc' then s.school end desc,
    case when p_sort_column = 'status' and p_sort_direction = 'asc' then s.status end asc,
    case when p_sort_column = 'status' and p_sort_direction = 'desc' then s.status end desc,
    s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$function$;

create or replace function public.subject_completion_status(p_subject_id uuid, p_status_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_year_level text DEFAULT NULL::text, p_school text DEFAULT NULL::text)
 returns table(scholar_id_number text, scholar_name text, year_level text, school text, topics_attempted bigint, total_topics bigint, status text, total_count bigint, completed_count bigint, did_not_complete_count bigint, not_attempted_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    where (public.is_sead_staff() or public.has_staff_tag('quest_management'))
      and s.status <> 'Removed'
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
$function$;

create or replace function public.subject_rankings(p_subject_id uuid, p_top_n integer DEFAULT NULL::integer, p_year_level text DEFAULT NULL::text, p_school text DEFAULT NULL::text, p_barangay text DEFAULT NULL::text, p_barangay_in text[] DEFAULT NULL::text[])
 returns table(rank bigint, scholar_id_number text, scholar_name text, school text, year_level text, barangay text, subject_percentage numeric, topic_count bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    where s.status <> 'Removed'
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
  where (public.is_sead_staff() or public.has_staff_tag('quest_management'))
    and ps.topic_count > 0
    and (p_year_level is null or s.year_level = p_year_level)
    and (p_school is null or s.school = p_school)
    and (p_barangay is null or s.barangay = p_barangay)
    and (p_barangay_in is null or s.barangay = any(p_barangay_in))
  order by ps.subject_percentage desc
  limit coalesce(p_top_n, 2147483647);
$function$;

-- 3. Add a 5th "Removed" bucket to the Scholarship Program Info stat cards.
--    Return shape changed (new column), so the old signature must be dropped first.
drop function if exists public.scholarship_status_counts();

create or replace function public.scholarship_status_counts()
 returns table(regular_count bigint, probationary_count bigint, on_leave_count bigint, reconsidered_count bigint, removed_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select
    count(*) filter (where status = 'Regular'),
    count(*) filter (where status = 'Probationary'),
    count(*) filter (where status = 'On leave'),
    count(*) filter (where status = 'Reconsidered'),
    count(*) filter (where status = 'Removed')
  from public.scholars;
end;
$function$;
