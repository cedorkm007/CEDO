-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_template_filter.sql
-- GRADES AND ACADEMIC MANAGEMENT: THE TEMPLATE OF A SCHOOL FOLLOWS THE FILTERS SET ON THE SCHOOL SCREEN.   Safe to run twice.   Undo: undo_academic_template_filter.sql
--   * "Download the template" now gives only the scholars that match the search and filters currently set on the school screen (status, program, year level, scholarship status, custom passing GWA, removed scholars),
--     in the same order as the list. With no filter it is the whole school, as before.
--   * Replaces 1 function (the original is in the undo file; the new one has one more optional value, the filter). Nothing is deleted.
-- Needs supabase_migration_academic_uploads.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.academic_template_rows(uuid,integer,integer)') is null and to_regprocedure('public.academic_template_rows(uuid,integer,integer,jsonb)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_uploads.sql first.';
  end if;
end $$;

drop function if exists public.academic_template_rows(uuid, integer, integer);
drop function if exists public.academic_template_rows(uuid, integer, integer, jsonb);
create or replace function public.academic_template_rows(p_school uuid, p_offset integer default 0, p_limit integer default 1000, p_filter jsonb default null)
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
  from public.scholars s
  join (select x as id from public._academic_filter_ids(p_school, coalesce(p_filter, '{}'::jsonb), null) x) m on m.id = s.scholar_id_number
  join public.schools sc on sc.id = s.school_id
  left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  order by lower(coalesce(s.last_name, '')), lower(coalesce(s.first_name, '')), s.scholar_id_number
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_template_rows(uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.academic_template_rows(uuid, integer, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
