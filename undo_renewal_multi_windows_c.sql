-- Undo of supabase_migration_renewal_multi_windows_c_old_save.sql: puts the older form of the save back as it was (with the one-window-per-term check).
create or replace function public.renewal_window_save(p_id uuid, p_school_year text, p_term text, p_opens_on date, p_closes_on date, p_late_allowed boolean, p_note text default '', p_testers text[] default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_list text[];
  v_missing text[];
begin
  perform public._renewal_require_evaluator();
  if p_school_year !~ '^\d{4}-\d{4}$' then raise exception 'The school year must look like 2026-2027.'; end if;
  if p_term not in ('1st Semester', '2nd Semester', 'Summer') then raise exception 'Choose 1st Semester, 2nd Semester or Summer.'; end if;
  if p_opens_on is null or p_closes_on is null or p_closes_on < p_opens_on then raise exception 'The closing date cannot be before the opening date.'; end if;
  -- the list: trimmed, no repeats; empty means "everyone"; every ID must be a real scholar
  if p_testers is not null then
    select array_agg(distinct btrim(t)) into v_list from unnest(p_testers) t where btrim(t) <> '';
    if v_list is not null then
      if cardinality(v_list) > 100 then raise exception 'A testers-only window can list at most 100 scholars.'; end if;
      select coalesce(array_agg(t order by t), '{}') into v_missing from unnest(v_list) t where not exists (select 1 from public.scholars s where s.scholar_id_number = t);
      if cardinality(v_missing) > 0 then raise exception 'These scholar IDs were not found: %.', array_to_string(v_missing, ', '); end if;
    end if;
  end if;
  if p_id is null then
    if exists (select 1 from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term) then
      raise exception 'There is already a renewal window for % — edit that one instead.', public._renewal_term_label(p_school_year, p_term);
    end if;
    insert into public.renewal_windows (school_year, term, opens_on, closes_on, late_allowed, note, created_by, testers)
    values (p_school_year, p_term, p_opens_on, p_closes_on, coalesce(p_late_allowed, true), left(btrim(coalesce(p_note, '')), 500), auth.uid(), v_list)
    returning id into v_id;
  else
    update public.renewal_windows set opens_on = p_opens_on, closes_on = p_closes_on, late_allowed = coalesce(p_late_allowed, true),
      note = left(btrim(coalesce(p_note, '')), 500), updated_at = now(),
      testers = case when p_testers is null then testers else v_list end
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'That renewal window was not found.'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[]) from public, anon;
grant execute on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[]) to authenticated;

notify pgrst, 'reload schema';
