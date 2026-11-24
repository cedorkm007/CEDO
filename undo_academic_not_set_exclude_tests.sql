-- undo_academic_not_set_exclude_tests.sql: the test scholars are counted again in the "no academic status" warning and its lists. Nothing is deleted.
begin;
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
  where coalesce(s.status, '') <> 'Removed'
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
  where coalesce(s.status, '') <> 'Removed'
    and not exists (select 1 from public.scholar_academic_status t where t.scholar_id_number = s.scholar_id_number)
    and (p_school is null or s.school_id = p_school)
  order by sc.name, s.last_name, s.first_name, s.scholar_id_number
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_not_set_list(uuid, integer, integer) from public, anon;
grant execute on function public.academic_not_set_list(uuid, integer, integer) to authenticated;

drop function if exists public._academic_is_test(text, text, text);
notify pgrst, 'reload schema';
commit;
