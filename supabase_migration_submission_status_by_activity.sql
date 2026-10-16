-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_status_by_activity.sql
--
-- Forms Management → Submission Files: the three totals (Accepted / Needs Resubmission / Pending) and the scholar lists behind them
-- now follow ONE SUBMISSION ACTIVITY that was created in Submission Activities (or "All activities"), instead of always counting every
-- file ever uploaded. Run after supabase_migration_submission_status_scholars_rpc.sql. Additive, read-only, safe to run twice.
--
--   submission_files_status_counts(p_activity_id)          one row per status: how many DISTINCT SCHOLARS have at least one file in it
--   submission_files_status_scholars(p_status, p_activity_id)   the scholars behind one number (with Year Level / School, how many of their
--                                                           files are in that status, and for which activities)
--
-- p_activity_id null = all activities (what the old totals showed). Only files that belong to an existing submission activity are
-- counted. Same counting rules as the older submission_upload_status_counts() / submission_scholars_by_status(), which stay untouched.
--
-- Who may read: staff with the Forms Management tag, or SEAD staff (the old pair only accepted is_sead_staff(), which tests a different
-- tag, so a Forms Management account that is not "scholar management" could not open these totals at all).
-- ─────────────────────────────────────────────────────────────

create or replace function public._can_view_submission_files()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'forms_management') or public.is_sead_staff();
$$;
revoke all on function public._can_view_submission_files() from public, anon, authenticated;

create or replace function public.submission_files_status_counts(p_activity_id uuid default null)
returns table (status text, scholar_count bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public._can_view_submission_files() then
    raise exception 'Not authorized to view Submission Activity files.';
  end if;
  return query
  select su.status, count(distinct su.scholar_id)
  from public.submission_uploads su
  join public.submission_activities sa on sa.id = su.activity_id
  where p_activity_id is null or su.activity_id = p_activity_id
  group by su.status;
end;
$$;
revoke all on function public.submission_files_status_counts(uuid) from public, anon;
grant execute on function public.submission_files_status_counts(uuid) to authenticated;

create or replace function public.submission_files_status_scholars(p_status text, p_activity_id uuid default null)
returns table (
  scholar_id uuid,
  scholar_id_number text,
  first_name text,
  last_name text,
  year_level text,
  school text,
  file_count bigint,
  activity_names text[]
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public._can_view_submission_files() then
    raise exception 'Not authorized to view Submission Activity files.';
  end if;
  if p_status is null or p_status not in ('uploaded', 'needs_resubmission', 'accepted') then
    raise exception 'Unknown status.';
  end if;
  return query
  select
    s.id,
    s.scholar_id_number,
    s.first_name,
    s.last_name,
    coalesce(nullif(trim(s.year_level), ''), 'No Year Level Set'),
    coalesce(nullif(trim(s.school), ''), 'No School Set'),
    count(su.id),
    array_agg(distinct sa.name order by sa.name)
  from public.submission_uploads su
  join public.scholars s on s.id = su.scholar_id
  join public.submission_activities sa on sa.id = su.activity_id
  where su.status = p_status and (p_activity_id is null or su.activity_id = p_activity_id)
  group by s.id, s.scholar_id_number, s.first_name, s.last_name, s.year_level, s.school
  order by s.last_name, s.first_name, s.id;
end;
$$;
revoke all on function public.submission_files_status_scholars(text, uuid) from public, anon;
grant execute on function public.submission_files_status_scholars(text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor): for every submission activity, how many scholars are in each status.
select sa.name as activity, su.status, count(distinct su.scholar_id) as scholars
from public.submission_activities sa
left join public.submission_uploads su on su.activity_id = sa.id
group by sa.name, su.status
order by sa.name, su.status;
