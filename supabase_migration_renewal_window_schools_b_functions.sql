-- ─────────────────────────────────────────────────────────────
-- RENEWAL WINDOW: CHOOSE THE SCHOOLS, FILE B of 2: the rules and the save.   Safe to run twice.   Undo: undo_renewal_window_schools_b.sql
-- Run AFTER supabase_migration_renewal_window_schools_a_column.sql and AFTER the two consultation-types files.
--
-- A renewal window can be limited to some schools (renewal_windows.school_ids; empty = all schools). A scholar belongs to a school through the school link on the scholar's
-- record (the one the Scholars tool and the School Portal already use). The window is then for the scholars of the chosen schools ONLY:
--   • they alone see it on their Renewal tile, get its alerts ("Renewal is now open", "closes in 3 days"), and can apply (the database refuses anyone else, whatever screen asks);
--   • the "Not applied" list, the dashboard numbers and the Excel file count only them;
--   • a scholar who ALREADY applied keeps seeing their application even if their school is un-ticked later (nothing is taken away from an application that exists);
--   • a scholar whose record has no school set cannot be matched to a school, so is NOT included when schools are chosen (the screen says how many there are).
-- A testers-only window works as before; if both a tester list and schools are set, a scholar must satisfy BOTH.
-- Replaces functions and one reading rule. Creates one function. No table is changed here. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

-- Is this scholar part of this window? (the ONE place every list, alert and the dashboard ask)
create or replace function public._renewal_window_includes(p_school_year text, p_term text, p_scholar text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (w.testers is null or p_scholar = any (w.testers))
       and (coalesce(cardinality(w.school_ids), 0) = 0
            or exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar and s.school_id = any (w.school_ids)))
    from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term), true);
$$;
revoke all on function public._renewal_window_includes(text, text, text) from public, anon, authenticated;

-- Nobody outside the window can be given an application in it, whatever screen or call tries it.
create or replace function public._renewal_trg_testers_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.renewal_windows%rowtype;
begin
  if new.window_id is null then return new; end if;
  select * into w from public.renewal_windows where id = new.window_id;
  if not found then return new; end if;
  if w.testers is not null and not (new.scholar_id_number = any (w.testers)) then
    raise exception 'This renewal window is not open for you.';
  end if;
  if coalesce(cardinality(w.school_ids), 0) > 0
     and not exists (select 1 from public.scholars s where s.scholar_id_number = new.scholar_id_number and s.school_id = any (w.school_ids)) then
    raise exception 'This renewal window is not open for your school.';
  end if;
  return new;
end;
$$;
revoke all on function public._renewal_trg_testers_only() from public, anon, authenticated;

-- Reading the windows: a scholar sees only a window that is for them (their school and, for a testers-only window, their ID). Staff see every window.
drop policy if exists "signed in users read renewal windows" on public.renewal_windows;
drop policy if exists "windows are read by who they are for" on public.renewal_windows;
create policy "windows are read by who they are for" on public.renewal_windows for select
  using (auth.uid() is not null and (
    public.can_view_renewal_reports()
    or (
      (testers is null or coalesce(public.current_scholar_id_number() = any (testers), false))
      and (coalesce(cardinality(school_ids), 0) = 0 or public.current_scholar_id_number() is null
           or exists (select 1 from public.scholars s where s.scholar_id_number = public.current_scholar_id_number() and s.school_id = any (school_ids)))
    )));

-- Saving a window, with the schools (p_schools: null = leave as it is when editing, all schools when new; an empty list = all schools). This is a NEW form of the save that takes the schools;
-- the older save (without schools) is left exactly as it is and keeps working, and it never touches the schools. p_testers: null = leave the testers as they are.
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
  if p_id is null then
    if exists (select 1 from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term) then
      raise exception 'There is already a renewal window for % — edit that one instead.', public._renewal_term_label(p_school_year, p_term);
    end if;
    insert into public.renewal_windows (school_year, term, opens_on, closes_on, late_allowed, note, created_by, testers, school_ids)
    values (p_school_year, p_term, p_opens_on, p_closes_on, coalesce(p_late_allowed, true), left(btrim(coalesce(p_note, '')), 500), auth.uid(), v_list, v_schools)
    returning id into v_id;
  else
    update public.renewal_windows set opens_on = p_opens_on, closes_on = p_closes_on, late_allowed = coalesce(p_late_allowed, true),
      note = left(btrim(coalesce(p_note, '')), 500), updated_at = now(),
      testers = case when p_testers is null then testers else v_list end,
      school_ids = case when p_schools is null then school_ids else v_schools end
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'That renewal window was not found.'; end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[], uuid[]) from public, anon;
grant execute on function public.renewal_window_save(uuid, text, text, date, date, boolean, text, text[], uuid[]) to authenticated;

-- The schools to tick: every school with how many active scholars (not Removed, not On leave) are enrolled in it, plus how many scholars have no school set.
create or replace function public.renewal_window_schools()
returns table(school_id uuid, name text, scholars bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._renewal_require_evaluator();
  return query
  select sc.id, sc.name, count(s.scholar_id_number)
  from public.schools sc
  left join public.scholars s on s.school_id = sc.id and s.status not in ('Removed', 'On leave')
  group by sc.id, sc.name
  union all
  select null::uuid, ''::text, count(*) from public.scholars s2 where s2.school_id is null and s2.status not in ('Removed', 'On leave')
  order by 2;
end;
$$;
revoke all on function public.renewal_window_schools() from public, anon;
grant execute on function public.renewal_window_schools() to authenticated;

-- The scholar's own overview: the window shows only when it is for the scholar (or the scholar already has an application in it).
create or replace function public.renewal_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_out jsonb := '[]'::jsonb;
  w record;
  v_rec public.renewal_records%rowtype;
  v_state text;
  v_slot public.counseling_slots%rowtype;
  v_booking jsonb;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  for w in
    select * from public.renewal_windows
    where (opens_on <= v_today + 14 or exists (select 1 from public.renewal_records r where r.window_id = renewal_windows.id and r.scholar_id_number = v_id))
      and (public._renewal_window_includes(renewal_windows.school_year, renewal_windows.term, v_id)
           or exists (select 1 from public.renewal_records r2 where r2.window_id = renewal_windows.id and r2.scholar_id_number = v_id))
    order by opens_on desc limit 6
  loop
    select * into v_rec from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term;
    v_state := case when v_today < w.opens_on then 'upcoming' when v_today <= w.closes_on then 'open'
                    when w.late_allowed then 'late' else 'closed' end;
    v_booking := null;
    if v_rec.id is not null then
      select * into v_slot from public.counseling_slots x where x.record_id = v_rec.id and x.state = 'booked';
      if found then
        v_booking := jsonb_build_object('slot_id', v_slot.id, 'starts_at', v_slot.starts_at, 'ends_at', v_slot.ends_at, 'staff_name', public._staff_display_name(v_slot.staff_id),
          'can_change', v_slot.starts_at >= now() + interval '12 hours',
          'consult_type', v_slot.consult_type, 'type_label', (select t.label from public.consultation_types t where t.key = v_slot.consult_type), 'minutes', v_slot.minutes);
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'window', to_jsonb(w), 'state', v_state,
      'record', case when v_rec.id is null then null else to_jsonb(v_rec) end,
      'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
      'inc_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.subject) from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb),
      'booking', v_booking,
      'consult_needed', v_rec.id is not null and public._renewal_consult_eligible(v_rec.id),
      'consult_state', case when v_rec.id is null then null else public._renewal_consult_state(v_rec.id) end));
  end loop;
  return jsonb_build_object(
    'scholar', jsonb_build_object('scholar_id_number', v_scholar.scholar_id_number, 'school', v_scholar.school, 'program', v_scholar.course, 'year_level', v_scholar.year_level, 'status', v_scholar.status),
    'windows', v_out);
end;
$$;
revoke all on function public.renewal_my_overview() from public, anon;
grant execute on function public.renewal_my_overview() to authenticated;

notify pgrst, 'reload schema';
