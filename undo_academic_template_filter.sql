-- undo_academic_template_filter.sql: the template of a school is the WHOLE school again (it ignores the filters of the screen). Nothing is deleted.
-- (Run this ONLY together with putting the previous website version back.)
begin;
drop function if exists public.academic_template_rows(uuid, integer, integer, jsonb);
drop function if exists public.academic_template_rows(uuid, integer, integer);
create or replace function public.academic_template_rows(p_school uuid, p_offset integer default 0, p_limit integer default 1000)
returns table(scholar_id_number text, name text, school text, program text, year_level text, academic_status text, custom_passing_gwa numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select s.scholar_id_number, btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')), sc.name, s.course, s.year_level, t.academic_status, t.custom_passing_gwa
  from public.scholars s join public.schools sc on sc.id = s.school_id left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school and coalesce(s.status, '') <> 'Removed'
  order by lower(coalesce(s.last_name, '')), lower(coalesce(s.first_name, '')), s.scholar_id_number
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_template_rows(uuid, integer, integer) from public, anon;
grant execute on function public.academic_template_rows(uuid, integer, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
