-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_upload_status_counts_rpc.sql
--
-- Adds the overall Accepted/Needs Resubmission/Pending breakdown shown
-- at the top of the staff "Submission Files" browser tab
-- (src/sead/pages/SubmissionFileBrowserTab.tsx), above the existing
-- per-activity total-uploads table. Same idiom as the sibling count
-- RPCs in supabase_migration_submission_upload_counts_rpc.sql
-- (is_sead_staff() check, security definer, stable) -- just a plain
-- GROUP BY status across every submission_uploads row instead of
-- scoped to one activity/year level/school.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.submission_upload_status_counts()
returns table (
  status text,
  upload_count bigint
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
  select su.status, count(*)
  from public.submission_uploads su
  group by su.status;
end;
$$;

revoke all on function public.submission_upload_status_counts() from public;
grant execute on function public.submission_upload_status_counts() to authenticated;
