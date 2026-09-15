-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_upload_counts_rpc.sql
--
-- Three drill-down count RPCs powering the new staff "Submission Files"
-- browser tab (Activity -> Year Level -> School -> file list). Each is a
-- plain GROUP BY scoped to the level above it, mirroring the exact
-- pattern already established for Scholarship Program Information's own
-- School drill-down (supabase_migration_scholarship_program_info_phase3.sql).
-- The leaf-level file list itself is a plain filtered select from the
-- frontend, not an RPC — same as that other drill-down's leaf level.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

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
  if not public.is_sead_staff() then
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
  if not public.is_sead_staff() then
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
  if not public.is_sead_staff() then
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

revoke all on function public.submission_uploads_by_activity() from public;
grant execute on function public.submission_uploads_by_activity() to authenticated;
revoke all on function public.submission_uploads_by_year_level(uuid) from public;
grant execute on function public.submission_uploads_by_year_level(uuid) to authenticated;
revoke all on function public.submission_uploads_by_school(uuid, text) from public;
grant execute on function public.submission_uploads_by_school(uuid, text) to authenticated;
