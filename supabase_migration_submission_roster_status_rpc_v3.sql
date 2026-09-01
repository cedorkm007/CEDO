-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_roster_status_rpc_v3.sql
--
-- Fixes a second, related bug found while diagnosing "Submission
-- Monitoring doesn't display all scholars from the filtered/unfiltered
-- roster" (incorrect submitted/locked/not-submitted/etc. totals): the
-- REAL root cause of that report is fetchSubmissionRosterStatus() in
-- submissionActivitiesApi.ts calling this RPC as a single, unpaginated
-- request — PostgREST's default 1,000-row response cap silently
-- truncates any activity whose eligible roster exceeds 1,000 scholars
-- (this org is already confirmed, from an earlier unrelated bug in this
-- same project, to have more than 1,000 scholars). That's fixed on the
-- calling side (submissionActivitiesApi.ts, this same round) by paging
-- through with .range(), mirroring fetchSubjectRankings()'s established
-- pattern in seadApi.ts.
--
-- THIS migration exists because that pagination fix only works
-- correctly if the underlying query result has a fully deterministic
-- row order across repeated calls. v2's `order by r.last_name,
-- r.first_name` has no tiebreaker — two scholars sharing the same
-- last+first name could be returned in a different relative order
-- between consecutive .range() page calls, which would silently skip or
-- duplicate a row right at a page boundary (a second, subtler bug on
-- top of the main one, worth fixing in the same round rather than
-- shipping a pagination fix that's itself not fully correct).
--
-- FIX: add a unique tiebreaker (the roster scholar's own id) to the
-- final ORDER BY. Every CTE, JOIN, and the Q2/Q3 status logic are
-- otherwise byte-for-byte unchanged from v2 — this is not a
-- reconsideration of that logic, only the ordering guarantee needed for
-- .range()-based pagination to be correct. See v2's own header comment
-- for the original timeout-fix reasoning, which still applies unchanged.
--
-- Safe to re-run — create-or-replace.
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_submission_roster_status(p_activity_id uuid)
returns table (
  scholar_id uuid,
  first_name text,
  last_name text,
  year_level text,
  school text,
  status text
)
language plpgsql
security definer
stable
set search_path = public
as $$
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
  quest_subject_failures as (
    select r.roster_scholar_id
    from roster r
    join conds c on c.condition_type = 'quest_subject'
    join public.quest_subjects qs on qs.id = c.subject_id
    left join public.scholar_subject_progress p
      on p.subject_id = c.subject_id and p.scholar_id_number = r.scholar_id_number
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
  -- v3 change: added r.roster_scholar_id as a tiebreaker so repeated
  -- .range()-paged calls return a fully deterministic, stable row order
  -- even when two scholars share the same last+first name.
  order by r.last_name, r.first_name, r.roster_scholar_id;
end;
$$;

revoke all on function public.get_submission_roster_status(uuid) from public;
grant execute on function public.get_submission_roster_status(uuid) to authenticated;
