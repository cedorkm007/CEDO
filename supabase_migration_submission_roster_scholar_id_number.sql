-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_roster_scholar_id_number.sql
--
-- Adds scholar_id_number to get_submission_roster_status()'s output —
-- needed for Submission Monitoring's new "search by name or Scholar ID"
-- box, since the roster row's own scholar_id (a uuid) isn't something a
-- staff member can type or recognize. The roster CTE already selects
-- s.scholar_id_number internally (used by quest_subject_progress's
-- lateral join condition) — this just also returns it, no new join or
-- computation added, so this doesn't change the function's performance
-- characteristics (already verified fast under a real authenticated
-- session in an earlier fix, ~480ms for the full-population worst
-- case).
--
-- Same "drop the old signature first" reasoning as this session's other
-- signature-changing migrations: CREATE OR REPLACE FUNCTION cannot add
-- a column to an existing RETURNS TABLE.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.get_submission_roster_status(uuid);

create or replace function public.get_submission_roster_status(p_activity_id uuid)
returns table(scholar_id uuid, scholar_id_number text, first_name text, last_name text, year_level text, school text, status text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_required_field_count int;
begin
  if not public.is_sead_staff() then
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
    -- Same semantics as scholar_subject_progress (per scholar, per
    -- subject, average of each topic's best score% with an unattempted
    -- topic counted as 0%) but scoped to this activity's own roster and
    -- only the subject(s) its own conditions reference — see this file's
    -- header for why that scoping is the actual fix.
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

revoke all on function public.get_submission_roster_status(uuid) from public;
grant execute on function public.get_submission_roster_status(uuid) to authenticated;
