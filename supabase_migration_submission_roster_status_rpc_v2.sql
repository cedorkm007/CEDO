-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_roster_status_rpc_v2.sql
--
-- Fixes a live "canceling statement due to statement timeout" error in
-- get_submission_roster_status() (Milestone 4). Following this
-- project's own precedent (see supabase_migration_quiz_v2.sql) of
-- shipping a fix as a NEW migration rather than editing an
-- already-applied one in place.
--
-- ROOT CAUSE: the original version called
-- is_submission_activity_unlocked_for_scholar() once per eligible
-- scholar (N+1). That function is SECURITY DEFINER, which Postgres
-- never inlines into the outer plan, so each call ran as a fully
-- opaque, separately-planned subquery — no shared work, no index/join
-- optimization across rows. This was made significantly worse for any
-- activity with a quest_subject unlock condition: that check joins
-- against scholar_subject_progress, a VIEW built from a CROSS JOIN of
-- every quest topic x every scholar in the ENTIRE system, each with its
-- own correlated subquery — paying that cost once per roster scholar
-- (instead of once for the whole roster) is almost certainly what
-- tipped this over the statement timeout as the roster grew.
--
-- FIX: compute everything for the WHOLE roster in one query.
--   1. required-field completion + needs_resubmission, previously N
--      correlated subqueries, is now one aggregated LEFT JOIN against
--      submission_uploads grouped by scholar_id.
--   2. lock status, previously N opaque function calls, is now a
--      UNION ALL of per-condition-type "which roster scholars fail
--      this condition" sets, each a real, indexable JOIN across the
--      whole roster at once — then a scholar is locked iff they appear
--      in that combined failing-set at least once.
-- The Q2/Q3 status logic and precedence decided in Milestone 4 are
-- UNCHANGED — this only changes HOW the same result is computed, not
-- what it computes. Do not re-litigate Q2/Q3 or the precedence order
-- while reviewing this file; see the original migration's own header
-- comment for that reasoning, which still applies unchanged.
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
  -- One aggregated pass over this activity's uploads, grouped by
  -- scholar, instead of a correlated subquery per roster row.
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
  -- Per-condition-type failing-scholar sets, each computed as a single
  -- set-based JOIN across the whole roster at once (not per-scholar).
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
      -- Submitted (Q3: every required field satisfied; zero-required
      -- fallback: at least one upload of any kind — same rule as the
      -- original migration, just reading from the pre-aggregated
      -- upload_agg row instead of a fresh correlated subquery).
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
  order by r.last_name, r.first_name;
end;
$$;

revoke all on function public.get_submission_roster_status(uuid) from public;
grant execute on function public.get_submission_roster_status(uuid) to authenticated;
