-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_status_breakdowns.sql
--
-- Scholarship Program Information tab: makes the four status stat cards
-- (Regular / Probationary / On leave / Reconsidered) clickable, drilling
-- into a breakdown of that one status by Year Level, School, or
-- Barangay. Each RPC is a plain single-table GROUP BY filtered to one
-- status, scanning the status/barangay/school indexes already added in
-- Phase 1 — same "scope/index the aggregate" reasoning as every other
-- RPC in this feature, never a cross join.
--
-- Year Level and Barangay both have a fixed canonical universe (5 year
-- levels; the 80 CDO barangays in ALL_BARANGAYS) that the client
-- zero-fills against, same as scholars_by_barangay() already does.
-- School has no such canonical list — purely derived from whatever
-- distinct scholars.school values exist for that status, since schools
-- can be added or dropped over time (see Phase 3's migration for the
-- same reasoning).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.scholars_by_year_level_for_status(p_status text)
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
  where s.status = p_status and s.year_level is not null and s.year_level != ''
  group by s.year_level;
end;
$$;

create or replace function public.scholars_by_school_for_status(p_status text)
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
  where s.status = p_status and s.school is not null and s.school != ''
  group by s.school;
end;
$$;

create or replace function public.scholars_by_barangay_for_status(p_status text)
returns table (
  barangay text,
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
  select s.barangay, count(*) as scholar_count
  from public.scholars s
  where s.status = p_status and s.barangay is not null and s.barangay != ''
  group by s.barangay;
end;
$$;

revoke all on function public.scholars_by_year_level_for_status(text) from public;
grant execute on function public.scholars_by_year_level_for_status(text) to authenticated;
revoke all on function public.scholars_by_school_for_status(text) from public;
grant execute on function public.scholars_by_school_for_status(text) to authenticated;
revoke all on function public.scholars_by_barangay_for_status(text) from public;
grant execute on function public.scholars_by_barangay_for_status(text) to authenticated;
