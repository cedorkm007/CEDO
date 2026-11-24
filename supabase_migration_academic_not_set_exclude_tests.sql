-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_not_set_exclude_tests.sql
-- GRADES AND ACADEMIC MANAGEMENT: THE TEST SCHOLARS ARE LEFT OUT OF THE "NO ACADEMIC STATUS" COUNTS AND LISTS.   Safe to run twice.   Undo: undo_academic_not_set_exclude_tests.sql
--   * A test scholar is one in the school named "test" or one whose first and last name are both "test", "test1", "test2" … (the made-up scholars the staff use to try the system).
--   * They are no longer counted in the warning at the top of Grades and Academic Management and no longer appear in its per-school table or in its downloaded lists.
--   * Nothing else changes: they are still in the school screen (so they can be tried), still checked in renewals, and no status or record is changed or deleted.
-- Replaces 2 functions (the originals are in the undo file) and adds 1. Needs supabase_migration_academic_scholar_status.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.academic_not_set_summary()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_scholar_status.sql first.';
  end if;
end $$;

create or replace function public._academic_is_test(p_first text, p_last text, p_school text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_school, ''))) = 'test'
      or (lower(btrim(coalesce(p_first, ''))) ~ '^test[0-9]*$' and lower(btrim(coalesce(p_last, ''))) ~ '^test[0-9]*$');
$$;

create or replace function public.academic_not_set_summary()
returns table(school_id uuid, school text, scholars bigint, not_set bigint, academic_passing_gwa numeric, non_academic_passing_gwa numeric, rule_on boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select sc.id, coalesce(sc.name, '(no school on record)'), count(*), count(*) filter (where t.scholar_id_number is null),
         ss.academic_passing_gwa, ss.non_academic_passing_gwa, (ss.academic_passing_gwa is not null)
  from public.scholars s
  left join public.schools sc on sc.id = s.school_id
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where coalesce(s.status, '') <> 'Removed' and not public._academic_is_test(s.first_name, s.last_name, sc.name)
  group by sc.id, sc.name, ss.academic_passing_gwa, ss.non_academic_passing_gwa
  order by coalesce(sc.name, '(no school on record)');
end;
$$;
revoke all on function public.academic_not_set_summary() from public, anon;
grant execute on function public.academic_not_set_summary() to authenticated;

create or replace function public.academic_not_set_list(p_school uuid default null, p_limit integer default 1000, p_offset integer default 0)
returns table(scholar_id_number text, name text, school text, school_id uuid, program text, year_level text, scholarship_status text, rule_on boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select s.scholar_id_number, btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), sc.name, s.school_id, s.course, s.year_level, s.status, (ss.academic_passing_gwa is not null)
  from public.scholars s
  left join public.schools sc on sc.id = s.school_id
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  where coalesce(s.status, '') <> 'Removed' and not public._academic_is_test(s.first_name, s.last_name, sc.name)
    and not exists (select 1 from public.scholar_academic_status t where t.scholar_id_number = s.scholar_id_number)
    and (p_school is null or s.school_id = p_school)
  order by sc.name, s.last_name, s.first_name, s.scholar_id_number
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_not_set_list(uuid, integer, integer) from public, anon;
grant execute on function public.academic_not_set_list(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
