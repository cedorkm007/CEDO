-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_upload_status_counts_rpc.sql
--
-- Adds the overall Accepted/Needs Resubmission/Pending breakdown shown
-- at the top of the staff "Submission Files" browser tab
-- (src/sead/pages/SubmissionFileBrowserTab.tsx), above the existing
-- per-activity total-uploads table. Same idiom as the sibling count
-- RPCs in supabase_migration_submission_upload_counts_rpc.sql
-- (is_sead_staff() check, security definer, stable).
--
-- Counts DISTINCT scholars per status, not raw upload rows -- an
-- activity can have several upload fields (see
-- SubmissionActivitiesSection.tsx's uploadFields), so one scholar can
-- easily have 2-3 upload rows, which would otherwise inflate each
-- bucket. A scholar with uploads in more than one status (e.g. one
-- accepted file and one needing resubmission) is counted in each
-- status they actually have -- these buckets aren't meant to be
-- mutually exclusive partitions of the scholar population, each one
-- answers "how many scholars have at least one upload in this state."
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.submission_upload_status_counts()
returns table (
  status text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_sead_staff() then
    raise exception 'Not authorized to view Submission Activity files.';
  end if;

  return query
  select su.status, count(distinct su.scholar_id)
  from public.submission_uploads su
  group by su.status;
end;
$$;

revoke all on function public.submission_upload_status_counts() from public;
grant execute on function public.submission_upload_status_counts() to authenticated;
