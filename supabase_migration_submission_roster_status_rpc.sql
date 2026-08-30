-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_roster_status_rpc.sql
--
-- Milestone 4 of the "Drive folder reorganization + submission
-- monitoring" task. Adds get_submission_roster_status(activity_id) —
-- the roster-based query the original handoff note flagged as not
-- existing anywhere in this codebase yet (SubmissionReviewPanel.tsx's
-- existing filters are all uploads-only: a scholar with zero uploads
-- for an activity never appears there at all).
--
-- Design decisions locked in by the person before this was written
-- (do not re-litigate these without asking again):
--   Q2 — a scholar eligible by year level but currently LOCKED by an
--        unmet unlock condition gets its own 'locked' status, not
--        lumped into 'not_submitted'.
--   Q3 — "submitted" means every REQUIRED upload field has an
--        uploaded/accepted file, not just any field.
--
-- STATUS PRECEDENCE (a design decision made THIS round, flagged in this
-- migration's own handoff note — not something the person was asked
-- directly, since it's a corollary of combining Q2+Q3, not a new fork):
-- when a scholar's data could satisfy more than one status at once,
--   'submitted' > 'needs_resubmission' > 'locked' > 'not_submitted'
-- i.e. an ACTUAL submission/review outcome that already exists always
-- wins over the lock state, since "locked" exists to explain an
-- ABSENCE of a submission — it should never hide one that's already
-- there. Revisit this ordering if the person wants it different.
--
-- EDGE CASE (also flagged, not silently decided): if an activity has
-- ZERO required upload fields, Q3's literal "every required field is
-- satisfied" is vacuously true for a scholar with NO uploads at all —
-- which would wrongly show every eligible scholar as 'submitted'. For
-- this specific case only, falls back to "has at least one upload of
-- any kind" to decide submitted vs. not.
--
-- Safe to re-run — create-or-replace throughout.
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
  select
    s.id as scholar_id,
    s.first_name,
    s.last_name,
    s.year_level,
    s.school,
    case
      -- Submitted: per Q3, every required field has an uploaded/accepted
      -- file. Zero-required-fields fallback: at least one upload of any
      -- kind (see this migration's own header comment on why).
      when (
        case
          when v_required_field_count = 0 then exists (
            select 1 from public.submission_uploads u
            where u.scholar_id = s.id and u.activity_id = p_activity_id
          )
          else (
            select count(distinct u.field_id)
            from public.submission_uploads u
            where u.scholar_id = s.id and u.activity_id = p_activity_id
              and u.status in ('uploaded', 'accepted')
              and u.field_id in (
                select f.id from public.submission_upload_fields f
                where f.activity_id = p_activity_id and f.is_required = true
              )
          ) >= v_required_field_count
        end
      ) then 'submitted'
      -- Needs Resubmission: any file for this activity (required or not)
      -- that staff has explicitly flagged, regardless of required-field
      -- completeness elsewhere — an actual review outcome that exists.
      when exists (
        select 1 from public.submission_uploads u
        where u.scholar_id = s.id and u.activity_id = p_activity_id
          and u.status = 'needs_resubmission'
      ) then 'needs_resubmission'
      -- Locked: eligible by year level (already filtered by the outer
      -- query below) but currently blocked by an unmet unlock condition.
      -- is_submission_activity_unlocked_for_scholar() is only GRANTed to
      -- service_role, but that's not a problem here: this whole function
      -- is SECURITY DEFINER, so its body (including this nested call)
      -- executes as the function's OWNER, not as the 'authenticated'
      -- caller — and an object's owner always implicitly retains
      -- execute rights on functions it owns, independent of any REVOKE/
      -- GRANT statements aimed at other roles. Relies on both functions
      -- sharing the same owner (true for anything applied via the
      -- Supabase SQL migration path, as this project always does).
      when not public.is_submission_activity_unlocked_for_scholar(p_activity_id, s.id)
        then 'locked'
      else 'not_submitted'
    end as status
  from public.scholars s
  join public.submission_activities a on a.id = p_activity_id
  where a.all_year_levels or s.year_level = any(a.target_year_levels)
  order by s.last_name, s.first_name;
end;
$$;

revoke all on function public.get_submission_roster_status(uuid) from public;
grant execute on function public.get_submission_roster_status(uuid) to authenticated;
