-- ─────────────────────────────────────────────────────────────
-- supabase_migration_fix_tag_gate_round2.sql
--
-- Root cause of the recurring "tagged a staff member for a new tool and
-- they can't see the tab, or can see the tab but not its data" reports:
-- public.is_sead_staff() is NOT a generic "is this account SEAD staff"
-- check — its actual body (confirmed by inspecting pg_proc directly) is
--
--   select exists (select 1 from staff_account_tags where staff_id =
--     auth.uid() and tag_key = 'scholar_management')
--
-- i.e. it silently means "has the scholar_management tag," nothing
-- broader. Every policy/function below was written as if it meant "any
-- staff," so a staff account tagged for a DIFFERENT tool (forms_management
-- or quest_management) sees that tool's sidebar tab (App.tsx's tag check
-- is correct) but every read against these tables/RPCs is denied — RLS
-- denial looks like empty data, not an error, so it presents exactly as
-- "tagged them but they can't see the files."
--
-- This is the same bug shape already fixed once for form_materials /
-- form_material_conditions (supabase_migration_forms_management_fix_tag_gate.sql)
-- and for Scholarship Program Information
-- (supabase_migration_scholarship_program_info_fix_tag_gate.sql) — this
-- migration extends that same fix to every other place the audit turned
-- up (a full pg_policies + pg_proc scan for is_sead_staff usage):
--
-- Forms Management (tag: forms_management) — these SELECT policies and
-- RPCs checked is_sead_staff() while their own sibling write policies
-- already correctly checked the forms_management tag:
--   submission_activities, submission_activity_conditions,
--   submission_drive_folders, submission_upload_fields, submission_uploads
--   (table SELECT policies), the "submission-uploads" storage bucket's
--   read policy, and the get_submission_roster_status /
--   submission_uploads_by_activity / submission_uploads_by_year_level /
--   submission_uploads_by_school RPCs (the last three power this
--   update's own new "Submission Files" browser tab).
--
-- Quest Management (tag: quest_management) — these RPCs checked only
-- is_sead_staff() while quest_choices/quest_questions/quest_subjects/
-- quest_topics' own write policies already correctly allow
-- "is_sead_staff() OR has_staff_tag('quest_management')": adds the same
-- OR here rather than replacing outright, matching that existing pattern
--   subject_rankings, subject_progress_page, subject_completion_status,
--   search_quest_scores (Quest Management Tools' Rankings / Scores &
--   Progress / Completion Status sub-tabs).
--
-- Left untouched (confirmed correct, not part of this bug):
--   formation_activities and search_scholars are scholar_management's
--   own tables/RPCs, so is_sead_staff() (== scholar_management) is the
--   right check for them. attendance_codes/attendance_records/
--   attendance_sessions and their RPCs already OR in
--   tag_key = 'sdp_monitoring' correctly.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── Forms Management: table SELECT policies ────────────────────

drop policy if exists "staff read" on public.submission_activities;
create policy "staff read" on public.submission_activities
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "staff read submission activity conditions" on public.submission_activity_conditions;
create policy "staff read submission activity conditions" on public.submission_activity_conditions
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "staff read" on public.submission_drive_folders;
create policy "staff read" on public.submission_drive_folders
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "staff read" on public.submission_upload_fields;
create policy "staff read" on public.submission_upload_fields
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "staff read" on public.submission_uploads;
create policy "staff read" on public.submission_uploads
  for select using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

-- ── Forms Management: submission-uploads storage bucket ────────

drop policy if exists "staff reads submission uploads" on storage.objects;
create policy "staff reads submission uploads" on storage.objects
  for select using (
    bucket_id = 'submission-uploads'
    and exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

-- ── Forms Management: RPCs ──────────────────────────────────────

create or replace function public.get_submission_roster_status(p_activity_id uuid)
 returns table(scholar_id uuid, scholar_id_number text, first_name text, last_name text, year_level text, school text, status text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_required_field_count int;
begin
  if not exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management') then
    raise exception 'Not authorized to view Submission Activity monitoring.';
  end if;

  select count(*) into v_required_field_count
  from public.submission_upload_fields f
  where f.activity_id = p_activity_id and f.is_required = true;

  return query
  with roster as (
    select s.id as roster_scholar_id, s.first_name, s.last_name, s.year_level, s.school, s.scholar_id_number
    from public.scholars s
    join public.submission_activities a on a.id = p_activity_id
    where a.all_year_levels or s.year_level = any(a.target_year_levels)
  ),
  upload_agg as (
    select
      u.scholar_id as roster_scholar_id,
      count(distinct u.field_id) filter (
        where u.status in ('uploaded', 'accepted')
          and u.field_id in (
            select f.id from public.submission_upload_fields f
            where f.activity_id = p_activity_id and f.is_required = true
          )
      ) as completed_required_count,
      bool_or(u.status = 'needs_resubmission') as has_needs_resubmission,
      count(*) as any_upload_count
    from public.submission_uploads u
    where u.activity_id = p_activity_id
    group by u.scholar_id
  ),
  conds as (
    select * from public.submission_activity_conditions c where c.activity_id = p_activity_id
  ),
  quest_subject_progress as (
    select
      r.roster_scholar_id,
      t.subject_id,
      avg(coalesce(best.best_pct, 0)) as subject_percentage
    from roster r
    join (select distinct c.subject_id from conds c where c.condition_type = 'quest_subject') qs_ids on true
    join public.quest_topics t on t.subject_id = qs_ids.subject_id
    left join lateral (
      select max(sqs.score::numeric / nullif(sqs.max_score, 0)) * 100 as best_pct
      from public.scholar_quest_scores sqs
      where sqs.topic_id = t.id and sqs.scholar_id_number = r.scholar_id_number
    ) best on true
    group by r.roster_scholar_id, t.subject_id
  ),
  quest_subject_failures as (
    select r.roster_scholar_id
    from roster r
    join conds c on c.condition_type = 'quest_subject'
    join public.quest_subjects qs on qs.id = c.subject_id
    left join quest_subject_progress p
      on p.roster_scholar_id = r.roster_scholar_id and p.subject_id = c.subject_id
      and p.subject_percentage >= qs.passing_rate_min and p.subject_percentage <= qs.passing_rate_max
    where p.subject_id is null
  ),
  formation_failures as (
    select r.roster_scholar_id
    from roster r
    join conds c on c.condition_type = 'formation_activity'
    left join (
      public.attendance_sessions x join public.attendance_records rec
        on rec.session_id = x.id and rec.status = 'present'
    ) on x.formation_activity_id = c.formation_activity_id and rec.scholar_id_number = r.scholar_id_number
    where rec.scholar_id_number is null
  ),
  sdp_failures as (
    select r.roster_scholar_id
    from roster r
    join conds c on c.condition_type = 'sdp_activity'
    left join (
      public.attendance_sessions x join public.attendance_records rec
        on rec.session_id = x.id and rec.status = 'present'
    ) on x.sdp_activity_id = c.sdp_activity_id and rec.scholar_id_number = r.scholar_id_number
    where rec.scholar_id_number is null
  ),
  course_failures as (
    select r.roster_scholar_id
    from roster r
    join conds c on c.condition_type = 'course'
    left join public.scholars s on s.id = r.roster_scholar_id
      and lower(trim(coalesce(s.course, ''))) = lower(trim(c.course))
    where s.id is null
  ),
  year_level_failures as (
    select r.roster_scholar_id
    from roster r
    join conds c on c.condition_type = 'year_level'
    where not (c.all_year_levels or r.year_level = any(c.target_year_levels))
  ),
  locked_scholars as (
    select distinct roster_scholar_id from (
      select roster_scholar_id from quest_subject_failures
      union all select roster_scholar_id from formation_failures
      union all select roster_scholar_id from sdp_failures
      union all select roster_scholar_id from course_failures
      union all select roster_scholar_id from year_level_failures
    ) f
  )
  select
    r.roster_scholar_id as scholar_id,
    r.scholar_id_number,
    r.first_name,
    r.last_name,
    r.year_level,
    r.school,
    case
      when (
        case
          when v_required_field_count = 0 then coalesce(ua.any_upload_count, 0) > 0
          else coalesce(ua.completed_required_count, 0) >= v_required_field_count
        end
      ) then 'submitted'
      when coalesce(ua.has_needs_resubmission, false) then 'needs_resubmission'
      when ls.roster_scholar_id is not null then 'locked'
      else 'not_submitted'
    end as status
  from roster r
  left join upload_agg ua on ua.roster_scholar_id = r.roster_scholar_id
  left join locked_scholars ls on ls.roster_scholar_id = r.roster_scholar_id
  order by r.last_name, r.first_name, r.roster_scholar_id;
end;
$function$;

create or replace function public.submission_uploads_by_activity()
returns table (
  activity_id uuid,
  activity_name text,
  upload_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management') then
    raise exception 'Not authorized to view Submission Activity files.';
  end if;

  return query
  select sa.id, sa.name, count(su.id)
  from public.submission_activities sa
  left join public.submission_uploads su on su.activity_id = sa.id
  group by sa.id, sa.name;
end;
$$;

create or replace function public.submission_uploads_by_year_level(p_activity_id uuid)
returns table (
  year_level text,
  upload_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management') then
    raise exception 'Not authorized to view Submission Activity files.';
  end if;

  return query
  select coalesce(nullif(trim(s.year_level), ''), 'No Year Level Set'), count(*)
  from public.submission_uploads su
  join public.scholars s on s.id = su.scholar_id
  where su.activity_id = p_activity_id
  group by coalesce(nullif(trim(s.year_level), ''), 'No Year Level Set');
end;
$$;

create or replace function public.submission_uploads_by_school(p_activity_id uuid, p_year_level text)
returns table (
  school text,
  upload_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management') then
    raise exception 'Not authorized to view Submission Activity files.';
  end if;

  return query
  select coalesce(nullif(trim(s.school), ''), 'No School Set'), count(*)
  from public.submission_uploads su
  join public.scholars s on s.id = su.scholar_id
  where su.activity_id = p_activity_id
    and coalesce(nullif(trim(s.year_level), ''), 'No Year Level Set') = p_year_level
  group by coalesce(nullif(trim(s.school), ''), 'No School Set');
end;
$$;

-- ── Quest Management: RPCs (add the OR, matching quest_choices/
--    quest_questions/quest_subjects/quest_topics' own write policies) ──

create or replace function public.subject_rankings(p_subject_id uuid, p_top_n integer default null::integer, p_year_level text default null::text, p_school text default null::text, p_barangay text default null::text, p_barangay_in text[] default null::text[])
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

create or replace function public.subject_progress_page(p_subject_id uuid, p_passed_filter text default 'all'::text, p_limit integer default 10, p_offset integer default 0, p_year_level text default null::text, p_school text default null::text)
 returns table(scholar_id_number text, scholar_name text, topic_count bigint, subject_percentage numeric, passed boolean, total_count bigint, passed_count bigint, not_passed_count bigint, passing_rate_min numeric, passing_rate_max numeric)
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
  with filtered as (
    select
      sp.scholar_id_number,
      (s.first_name || ' ' || s.last_name) as scholar_name,
      sp.topic_count, sp.subject_percentage,
      (sp.subject_percentage >= v_min and sp.subject_percentage <= v_max) as passed
    from scholar_subject_progress sp
    join scholars s on s.scholar_id_number = sp.scholar_id_number
    where (public.is_sead_staff() or public.has_staff_tag('quest_management'))
      and sp.subject_id = p_subject_id
      and sp.topic_count > 0
      and (p_year_level is null or s.year_level = p_year_level)
      and (p_school is null or s.school ilike '%' || p_school || '%')
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

create or replace function public.subject_completion_status(p_subject_id uuid, p_status_filter text default 'all'::text, p_limit integer default 10, p_offset integer default 0, p_year_level text default null::text, p_school text default null::text)
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

create or replace function public.search_quest_scores(p_subject_id uuid default null::uuid, p_topic_id uuid default null::uuid, p_scholar_search text default null::text, p_date_from date default null::date, p_date_to date default null::date, p_limit integer default 10, p_offset integer default 0, p_sort_column text default null::text, p_sort_direction text default 'asc'::text)
 returns table(id uuid, scholar_id_number text, scholar_name text, subject_name text, topic_name text, quest_name text, score numeric, max_score numeric, date_taken date, total_count bigint, distinct_scholar_count bigint, avg_percentage numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  return query
  with filtered as (
    select
      sq.id, sq.scholar_id_number,
      (s.first_name || ' ' || s.last_name) as scholar_name,
      qs.name as subject_name, qt.name as topic_name,
      sq.quest_name, sq.score, sq.max_score, sq.date_taken
    from scholar_quest_scores sq
    join scholars s on s.scholar_id_number = sq.scholar_id_number
    left join quest_subjects qs on qs.id = sq.subject_id
    left join quest_topics qt on qt.id = sq.topic_id
    where (public.is_sead_staff() or public.has_staff_tag('quest_management'))
      and (p_subject_id is null or sq.subject_id = p_subject_id)
      and (p_topic_id is null or sq.topic_id = p_topic_id)
      and (p_date_from is null or sq.date_taken >= p_date_from)
      and (p_date_to is null or sq.date_taken <= p_date_to)
      and (
        p_scholar_search is null or trim(p_scholar_search) = '' or
        sq.scholar_id_number ilike '%' || p_scholar_search || '%' or
        s.first_name ilike '%' || p_scholar_search || '%' or
        s.last_name ilike '%' || p_scholar_search || '%' or
        (s.first_name || ' ' || s.last_name) ilike '%' || p_scholar_search || '%' or
        (s.last_name || ' ' || s.first_name) ilike '%' || p_scholar_search || '%'
      )
  ),
  agg as (
    select
      count(*) as total_count,
      count(distinct filtered.scholar_id_number) as distinct_scholar_count,
      avg(case when filtered.max_score > 0 then (filtered.score::numeric / filtered.max_score) * 100 end) as avg_percentage
    from filtered
  )
  select f.id, f.scholar_id_number, f.scholar_name, f.subject_name, f.topic_name,
    f.quest_name, f.score, f.max_score, f.date_taken,
    agg.total_count, agg.distinct_scholar_count, agg.avg_percentage
  from filtered f cross join agg
  order by
    case when p_sort_column = 'scholar' and p_sort_direction = 'asc' then f.scholar_name end asc,
    case when p_sort_column = 'scholar' and p_sort_direction = 'desc' then f.scholar_name end desc,
    case when p_sort_column = 'subject' and p_sort_direction = 'asc' then f.subject_name end asc,
    case when p_sort_column = 'subject' and p_sort_direction = 'desc' then f.subject_name end desc,
    case when p_sort_column = 'topic' and p_sort_direction = 'asc' then f.topic_name end asc,
    case when p_sort_column = 'topic' and p_sort_direction = 'desc' then f.topic_name end desc,
    case when p_sort_column = 'quest' and p_sort_direction = 'asc' then f.quest_name end asc,
    case when p_sort_column = 'quest' and p_sort_direction = 'desc' then f.quest_name end desc,
    case when p_sort_column = 'score' and p_sort_direction = 'asc' then f.score end asc,
    case when p_sort_column = 'score' and p_sort_direction = 'desc' then f.score end desc,
    case when p_sort_column = 'date' and p_sort_direction = 'asc' then f.date_taken end asc,
    case when p_sort_column = 'date' and p_sort_direction = 'desc' then f.date_taken end desc,
    f.date_taken desc nulls last, f.id
  limit p_limit offset p_offset;
end;
$function$;

revoke all on function public.get_submission_roster_status(uuid) from public;
grant execute on function public.get_submission_roster_status(uuid) to authenticated;
revoke all on function public.submission_uploads_by_activity() from public;
grant execute on function public.submission_uploads_by_activity() to authenticated;
revoke all on function public.submission_uploads_by_year_level(uuid) from public;
grant execute on function public.submission_uploads_by_year_level(uuid) to authenticated;
revoke all on function public.submission_uploads_by_school(uuid, text) from public;
grant execute on function public.submission_uploads_by_school(uuid, text) to authenticated;
revoke all on function public.subject_rankings(uuid, integer, text, text, text, text[]) from public;
grant execute on function public.subject_rankings(uuid, integer, text, text, text, text[]) to authenticated;
revoke all on function public.subject_progress_page(uuid, text, integer, integer, text, text) from public;
grant execute on function public.subject_progress_page(uuid, text, integer, integer, text, text) to authenticated;
revoke all on function public.subject_completion_status(uuid, text, integer, integer, text, text) from public;
grant execute on function public.subject_completion_status(uuid, text, integer, integer, text, text) to authenticated;
revoke all on function public.search_quest_scores(uuid, uuid, text, date, date, integer, integer, text, text) from public;
grant execute on function public.search_quest_scores(uuid, uuid, text, date, date, integer, integer, text, text) to authenticated;
