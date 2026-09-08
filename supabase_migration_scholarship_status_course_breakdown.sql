-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_status_course_breakdown.sql
--
-- Adds Course as a fourth breakdown dimension for the status stat-card
-- drill-down (alongside Year Level / School / Barangay, added in
-- supabase_migration_scholarship_status_breakdowns.sql). Same
-- single-table GROUP BY filtered to one status; Course has no fixed
-- canonical list, same reasoning as School.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.scholars_by_course_for_status(p_status text)
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
  where s.status = p_status and s.course is not null and s.course != ''
  group by s.course;
end;
$$;

revoke all on function public.scholars_by_course_for_status(text) from public;
grant execute on function public.scholars_by_course_for_status(text) to authenticated;
