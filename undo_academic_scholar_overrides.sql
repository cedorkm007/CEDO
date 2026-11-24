-- undo_academic_scholar_overrides.sql: the scholars' own academic status goes away as a rule: every scholar follows the academic status of the program again (as before the bulk upload).
-- Puts back the earlier function and removes the four new ones. The table of the own statuses stays with its data (nothing is deleted); it is simply not used any more.
-- (Run this ONLY together with putting the previous website version back.)
begin;
create or replace function public._scholar_academic(p_scholar text)
returns table(academic_status text, is_set boolean, passing_gwa numeric, special boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sp.academic_status, 'academic'), sp.program_key is not null,
         coalesce(sp.special_passing_gwa, case coalesce(sp.academic_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end),
         sp.special_passing_gwa is not null
  from public.scholars s
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  left join public.academic_school_programs sp on sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)
  where s.scholar_id_number = p_scholar;
$$;
revoke all on function public._scholar_academic(text) from public, anon, authenticated;

drop function if exists public.academic_overrides_list();
drop function if exists public.academic_bulk_save(jsonb);
drop function if exists public.academic_bulk_check(jsonb);
drop function if exists public._academic_bulk_eval(jsonb);
drop function if exists public._academic_status_of(text);
update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;      -- the open renewals are checked again in the background
notify pgrst, 'reload schema';
commit;
