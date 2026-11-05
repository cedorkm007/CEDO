-- Undo of supabase_migration_renewal_multi_windows_d_test_window_beside.sql: a test window must be the only window of its term again.
-- It STOPS (changes nothing) while a term has a test window AND another window: delete or open the test window to everyone first.
do $$ begin
  if exists (select 1 from public.renewal_windows t where t.testers is not null and exists (select 1 from public.renewal_windows o where o.id <> t.id and o.school_year = t.school_year and o.term = t.term)) then
    raise exception 'STOPPED, nothing changed: a term has a test window and another window. Delete the test window (or open it to everyone) first.';
  end if;
end $$;

create or replace function public._renewal_window_has_scholar(p_window_id uuid, p_scholar text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (w.testers is null or p_scholar = any (w.testers))
       and public._renewal_window_covers_school(w.id, (select s.school_id from public.scholars s where s.scholar_id_number = p_scholar))
    from public.renewal_windows w where w.id = p_window_id), false);
$$;
revoke all on function public._renewal_window_has_scholar(uuid, text) from public, anon, authenticated;

create or replace function public.renewal_window_save(p_id uuid, p_school_year text, p_term text, p_opens_on date, p_closes_on date, p_late_allowed boolean, p_note text,
                                                      p_testers text[], p_schools uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_list text[];
  v_missing text[];
  v_schools uuid[];
  v_bad integer;
  v_cur public.renewal_windows%rowtype;
  v_new_testers text[];
  v_new_schools uuid[];
  o record;
  v_clash text;
begin
  perform public._renewal_require_evaluator();
  if p_school_year !~ '^\d{4}-\d{4}$' then raise exception 'The school year must look like 2026-2027.'; end if;
  if p_term not in ('1st Semester', '2nd Semester', 'Summer') then raise exception 'Choose 1st Semester, 2nd Semester or Summer.'; end if;
  if p_opens_on is null or p_closes_on is null or p_closes_on < p_opens_on then raise exception 'The closing date cannot be before the opening date.'; end if;
  -- the testers list: trimmed, no repeats; empty means "everyone"; every ID must be a real scholar
  if p_testers is not null then
    select array_agg(distinct btrim(t)) into v_list from unnest(p_testers) t where btrim(t) <> '';
    if v_list is not null then
      if cardinality(v_list) > 100 then raise exception 'A testers-only window can list at most 100 scholars.'; end if;
      select coalesce(array_agg(t order by t), '{}') into v_missing from unnest(v_list) t where not exists (select 1 from public.scholars s where s.scholar_id_number = t);
      if cardinality(v_missing) > 0 then raise exception 'These scholar IDs were not found: %.', array_to_string(v_missing, ', '); end if;
    end if;
  end if;
  -- the schools: no repeats; an empty list means all schools; every school must exist
  if p_schools is not null then
    select array_agg(distinct x) into v_schools from unnest(p_schools) x;
    if v_schools is not null then
      select count(*) into v_bad from unnest(v_schools) x where not exists (select 1 from public.schools sc where sc.id = x);
      if v_bad > 0 then raise exception 'One of the chosen schools was not found. Please reload the page and choose again.'; end if;
    end if;
  end if;
  if p_id is not null then
    select * into v_cur from public.renewal_windows where id = p_id;
    if not found then raise exception 'That renewal window was not found.'; end if;
  end if;
  -- what the window will be after this save (a list that was not sent stays as it is on an edit)
  v_new_testers := case when p_id is null then v_list when p_testers is null then v_cur.testers else v_list end;
  v_new_schools := case when p_id is null then v_schools when p_schools is null then v_cur.school_ids else v_schools end;
  if v_new_schools is not null and cardinality(v_new_schools) = 0 then v_new_schools := null; end if;

  -- the other windows of this term
  for o in select * from public.renewal_windows x where x.school_year = p_school_year and x.term = p_term and x.id is distinct from p_id loop
    if v_new_testers is not null then
      raise exception 'A testers-only window must be the only window of its term, and % already has another window. Finish the test (open the test window to everyone) or delete the other window first.', public._renewal_term_label(p_school_year, p_term);
    end if;
    if o.testers is not null then
      raise exception '% has a testers-only window (a test). Open that window to everyone, or delete it, before adding another window for the term.', public._renewal_term_label(p_school_year, p_term);
    end if;
    if v_new_schools is null and coalesce(cardinality(o.school_ids), 0) = 0 then
      raise exception 'There is already an "all schools" window for %. A term has one "all schools" window; give this one particular schools, or edit the existing window.', public._renewal_term_label(p_school_year, p_term);
    end if;
    if v_new_schools is not null and coalesce(cardinality(o.school_ids), 0) > 0 then
      select string_agg(sc.name, ', ' order by sc.name) into v_clash from public.schools sc where sc.id = any (v_new_schools) and sc.id = any (o.school_ids);
      if v_clash is not null then
        raise exception 'A school can be in only one window of a term. Already in another window of %: %. Un-tick them here, or take them out of the other window first.', public._renewal_term_label(p_school_year, p_term), v_clash;
      end if;
    end if;
  end loop;

  if p_id is null then
    insert into public.renewal_windows (school_year, term, opens_on, closes_on, late_allowed, note, created_by, testers, school_ids)
    values (p_school_year, p_term, p_opens_on, p_closes_on, coalesce(p_late_allowed, true), left(btrim(coalesce(p_note, '')), 500), auth.uid(), v_list, v_schools)
    returning id into v_id;
  else
    update public.renewal_windows set opens_on = p_opens_on, closes_on = p_closes_on, late_allowed = coalesce(p_late_allowed, true),
      note = left(btrim(coalesce(p_note, '')), 500), updated_at = now(),
      testers = case when p_testers is null then testers else v_list end,
      school_ids = case when p_schools is null then school_ids else v_schools end
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[], uuid[]) from public, anon;
grant execute on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[], uuid[]) to authenticated;

notify pgrst, 'reload schema';
