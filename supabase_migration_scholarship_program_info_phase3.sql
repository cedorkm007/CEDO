-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_program_info_phase3.sql
--
-- Phase 3 of the "Scholarship Program Information" tab: the School
-- subtab's 3-level drill-down (School -> Year Level -> Course). Each RPC
-- is a plain single-table GROUP BY scoped to the level above it, scanning
-- idx_scholars_school_year_course (added in Phase 1) — never a cross
-- join, same reasoning as Phase 2's scholars_by_barangay().
--
-- Unlike Barangay (a fixed, canonical 80-entry list independent of
-- scholar data — ALL_BARANGAYS in cdoBarangays.ts), School has no such
-- canonical universe: it's derived purely from whatever distinct school
-- values currently exist in scholars.school, which is expected to grow
-- or shrink over time as the program adds/drops partner schools. These
-- RPCs return exactly and only the schools that currently have at least
-- one scholar — no hardcoded list, no assumed count — and the frontend
-- must size its chart/list off the actual returned row count each time,
-- not any number observed during development.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.scholars_by_school()
returns table (
  school text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_sead_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.school, count(*) as scholar_count
  from public.scholars s
  where s.school is not null and s.school != ''
  group by s.school;
end;
$$;

create or replace function public.scholars_by_school_year_level(p_school text)
returns table (
  year_level text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_sead_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.year_level, count(*) as scholar_count
  from public.scholars s
  where s.school = p_school and s.year_level is not null and s.year_level != ''
  group by s.year_level;
end;
$$;

create or replace function public.scholars_by_school_year_level_course(p_school text, p_year_level text)
returns table (
  course text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_sead_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.course, count(*) as scholar_count
  from public.scholars s
  where s.school = p_school and s.year_level = p_year_level and s.course is not null and s.course != ''
  group by s.course;
end;
$$;

revoke all on function public.scholars_by_school() from public;
grant execute on function public.scholars_by_school() to authenticated;
revoke all on function public.scholars_by_school_year_level(text) from public;
grant execute on function public.scholars_by_school_year_level(text) to authenticated;
revoke all on function public.scholars_by_school_year_level_course(text, text) from public;
grant execute on function public.scholars_by_school_year_level_course(text, text) to authenticated;
