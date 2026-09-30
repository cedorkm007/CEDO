-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_upload_counts_per_scholar_fix.sql
--
-- Reported: the "Files per Submission Activity" table (and its Year
-- Level / School drill-down levels) in the staff Submission Files
-- browser -- labeled "Scholars" in the UI (GroupCountBreakdown's column
-- header) -- was actually counting raw submission_uploads rows, not
-- distinct scholars. An activity can have several upload fields
-- (SubmissionActivitiesSection.tsx's uploadFields), so one scholar
-- easily has 2-3 rows there, inflating the number well past the actual
-- headcount (same class of bug just fixed for the Accepted/Needs
-- Resubmission/Pending breakdown in
-- supabase_migration_submission_upload_status_counts_rpc.sql).
--
-- Redefines all three drill-down RPCs from
-- supabase_migration_submission_upload_counts_rpc.sql with the exact
-- same signatures and return columns (so no frontend change is
-- needed) -- just count(distinct su.scholar_id) instead of count(su.id)
-- / count(*).
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
  select sa.id, sa.name, count(distinct su.scholar_id)
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
  select coalesce(nullif(trim(s.year_level), ''), 'No Year Level Set'), count(distinct su.scholar_id)
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
  select coalesce(nullif(trim(s.school), ''), 'No School Set'), count(distinct su.scholar_id)
  from public.submission_uploads su
  join public.scholars s on s.id = su.scholar_id
  where su.activity_id = p_activity_id
    and coalesce(nullif(trim(s.year_level), ''), 'No Year Level Set') = p_year_level
  group by coalesce(nullif(trim(s.school), ''), 'No School Set');
end;
$$;
