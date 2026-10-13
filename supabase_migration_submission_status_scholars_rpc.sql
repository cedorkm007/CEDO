-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_status_scholars_rpc.sql
--
-- Submission Activities → Files tab: the three totals at the top (Accepted / Needs Resubmission / Pending, from
-- submission_upload_status_counts()) become clickable and open the list of scholars behind the number, which staff can
-- then filter by year level and school.
--
-- This adds the list function. It counts exactly like submission_upload_status_counts(): one row per DISTINCT SCHOLAR who has
-- at least one upload in the chosen status, across every submission activity, so with no filter the list is as long as the
-- number on the tile. A scholar with files in more than one status appears in each status's list, same as the totals.
--
-- Each row also says how many of the scholar's files are in that status and for which activities. Year level and school use
-- the same "No Year Level Set" / "No School Set" wording as the other Submission Activities count functions.
--
-- Read-only; same access check as the sibling functions (is_sead_staff()). Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.submission_scholars_by_status(p_status text)
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
  if not public.is_sead_staff() then
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
  where su.status = p_status
  group by s.id, s.scholar_id_number, s.first_name, s.last_name, s.year_level, s.school
  order by s.last_name, s.first_name, s.id;
end;
$$;

revoke all on function public.submission_scholars_by_status(text) from public;
grant execute on function public.submission_scholars_by_status(text) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor): how many scholars each status list will contain (the same numbers the tiles show).
select su.status, count(distinct su.scholar_id) as scholars
from public.submission_uploads su
group by su.status
order by su.status;
