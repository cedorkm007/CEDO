-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_roster_status_rpc_v4.sql
--
-- Fixes "Submission Monitoring takes a significant amount of time to
-- load." v2's own header comment already named the culprit
-- (public.scholar_subject_progress, defined in
-- supabase_migration_subject_passing_rate.sql) as "almost certainly what
-- tipped this over the statement timeout" — but only fixed the N+1-calls
-- problem, not the view's own cost. That view CROSS JOINs every quest
-- topic in the entire system against every scholar in the entire org
-- (1,000+ scholars, per v3's own comment) and runs a correlated subquery
-- against scholar_quest_scores for each pair, before any join predicate
-- from this RPC's quest_subject_failures CTE can be pushed down — so
-- every Submission Activity with a "Pass: [quest subject]" unlock
-- condition recomputed that entire cross join from scratch, every roster
-- load, regardless of how few scholars are actually in this one
-- activity's roster or how few topics are in the relevant subject.
--
-- FIX: replace the join against scholar_subject_progress with an inline
-- CTE computing the exact same per-scholar/per-subject metric (average
-- of each topic's best score%, an unattempted topic counted as 0% — see
-- subject_passing_rate.sql for that original definition, unchanged here)
-- but scoped to just this activity's own roster and the specific
-- subject(s) its own 'quest_subject' conditions reference, instead of
-- every scholar and every subject in the system. Mirrors the scoped,
-- properly-indexed pattern supabase_migration_subject_completion_status_
-- rpc.sql already established for a different Quest Monitoring screen
-- rather than reusing the expensive view.
--
-- Every other CTE, join, and the Q2/Q3 status logic are byte-for-byte
-- unchanged from v3 — this is not a reconsideration of that logic, only
-- of how quest_subject_failures computes its one join key.
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
$$;

revoke all on function public.get_submission_roster_status(uuid) from public;
grant execute on function public.get_submission_roster_status(uuid) to authenticated;
