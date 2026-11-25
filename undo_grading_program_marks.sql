-- undo_grading_program_marks.sql: the Grading setup has one passing mark per school again, and every grade is judged by the school's mark as before.
-- The program marks already saved stay in the (now unused) column staff_program_marks, so nothing is lost; running supabase_migration_grading_program_marks.sql again brings the feature back with them.
-- (Run this ONLY together with putting the previous website version back.)
begin;
set local lock_timeout = '5s';

-- the old rules first (they no longer call the 3-argument rule), then the 3-argument rule goes
create or replace function public._grade_outcome_at(p_school uuid, p_grade text, p_pct numeric, p_year text, p_term text, p_course text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_ver uuid; v_pass numeric; v_bands int; v_fail int;
begin
  if v_grade is null and p_pct is null then return 'ungraded'; end if;
  if v_grade is not null and (upper(v_grade) in ('INC', 'DRP') or exists (select 1 from public.school_marks m where m.school_id = p_school and lower(btrim(m.mark)) = lower(v_grade))) then
    return public._grade_outcome(p_school, v_grade);
  end if;
  v_ver := public._grading_version_at(p_school, p_year, p_term);
  if v_ver is null or not exists (select 1 from public.school_grade_bands b where b.version_id = v_ver) then
    return public._grade_outcome(p_school, v_grade);
  end if;
  if p_pct is not null then
    select count(*), count(*) filter (where b.pct_from < coalesce(public._grading_passing(v_ver, p_course), 101)) into v_bands, v_fail
    from public.school_grade_bands b where b.version_id = v_ver and p_pct between b.pct_from and b.pct_to;
  else
    select count(*), count(*) filter (where b.pct_from < coalesce(public._grading_passing(v_ver, p_course), 101)) into v_bands, v_fail
    from public.school_grade_bands b where b.version_id = v_ver and public._grading_same_grade(v_grade, b.equivalent_grade);
  end if;
  if v_bands = 0 then return public._grade_outcome(p_school, v_grade); end if;     -- a grade the table does not know: the old rule decides
  v_pass := public._grading_passing(v_ver, p_course);
  if v_pass is null then return 'no_passing_mark'; end if;
  return case when v_fail > 0 then 'failed' else 'passed' end;                       -- two rows of the same grade on different sides of a programme's passing mark: the stricter reading
end;
$$;
revoke all on function public._grade_outcome_at(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public._grade_outcome_at(uuid, text, numeric, text, text, text) to authenticated;

drop function if exists public._grade_outcome(uuid, text);
create or replace function public._grade_outcome(p_school_id uuid, p_grade text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_cfg public.school_grading_configs%rowtype;
  v_value numeric;
  v_mark_outcome text;
begin
  if v_grade is null then return 'ungraded'; end if;
  if upper(v_grade) = 'INC' then return 'inc'; end if;
  if upper(v_grade) = 'DRP' then return 'drp'; end if;

  select m.outcome into v_mark_outcome from public.school_marks m where m.school_id = p_school_id and lower(btrim(m.mark)) = lower(v_grade) limit 1;
  if v_mark_outcome is not null then
    return case v_mark_outcome when 'passed' then 'passed' when 'failed' then 'failed' when 'incomplete' then 'inc' else 'review' end;
  end if;

  select * into v_cfg from public.school_grading_configs where school_id = p_school_id;
  if not found or v_cfg.passing_mark is null then return 'no_passing_mark'; end if;

  if v_grade ~ '^\d+(\.\d+)?$' then
    v_value := v_grade::numeric;
  elsif v_cfg.uses_letter_grades then
    select l.numeric_value into v_value from public.school_letter_grades l
    where l.school_id = p_school_id and lower(btrim(l.letter)) = lower(v_grade)
    limit 1;
  end if;
  if v_value is null then return 'review'; end if;

  if v_cfg.direction = 'lower_is_better' then
    return case when v_value > v_cfg.passing_mark then 'failed' else 'passed' end;
  end if;
  return case when v_value < v_cfg.passing_mark then 'failed' else 'passed' end;
end;
$$;
revoke all on function public._grade_outcome(uuid, text) from public, anon, authenticated;
drop function if exists public._grade_outcome(uuid, text, text);

drop function if exists public.get_scholar_grading_program_marks();
drop function if exists public.get_scholar_grading_program_marks_for_staff(text);

drop function if exists public.grading_setup_schools();
create or replace function public.grading_setup_schools()
returns table(school_id uuid, name text, scholars bigint, has_setup boolean, passing_mark numeric, set_by_staff boolean, letters bigint, marks bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  return query
  select sc.id, sc.name, (select count(*) from public.scholars s where s.school_id = sc.id and s.status not in ('Removed', 'On leave')),
         c.school_id is not null, c.passing_mark, coalesce(c.set_by_staff, false),
         (select count(*) from public.school_letter_grades l where l.school_id = sc.id), (select count(*) from public.school_marks m where m.school_id = sc.id)
  from public.schools sc left join public.school_grading_configs c on c.school_id = sc.id
  order by sc.name;
end;
$$;
revoke all on function public.grading_setup_schools() from public, anon;
grant execute on function public.grading_setup_schools() to authenticated;

create or replace function public.grading_setup_get(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.school_grading_configs%rowtype;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  select * into c from public.school_grading_configs where school_id = p_school_id;
  return jsonb_build_object(
    'school', (select sc.name from public.schools sc where sc.id = p_school_id),
    'config', case when c.school_id is null then null else jsonb_build_object('scale_min', c.scale_min, 'scale_max', c.scale_max, 'direction', c.direction, 'uses_letter_grades', c.uses_letter_grades,
        'passing_mark', c.passing_mark, 'set_by_staff', c.set_by_staff, 'staff_note', c.staff_note, 'staff_set_at', c.staff_set_at) end,
    'letters', coalesce((select jsonb_agg(jsonb_build_object('letter', l.letter, 'numeric_value', l.numeric_value) order by l.letter) from public.school_letter_grades l where l.school_id = p_school_id), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('mark', m.mark, 'meaning', m.meaning, 'outcome', m.outcome) order by m.mark) from public.school_marks m where m.school_id = p_school_id), '[]'::jsonb));
end;
$$;

create or replace function public.grading_setup_save(p_school_id uuid, p_config jsonb, p_letters jsonb, p_marks jsonb, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min numeric; v_max numeric; v_pass numeric; v_dir text; v_letters boolean;
  v_row jsonb;
  v_text text; v_meaning text; v_outcome text;
  v_seen text[] := '{}';
  v_num numeric;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  if not exists (select 1 from public.schools where id = p_school_id) then raise exception 'That school was not found.'; end if;
  begin v_min := (p_config ->> 'scale_min')::numeric; v_max := (p_config ->> 'scale_max')::numeric; v_pass := (p_config ->> 'passing_mark')::numeric; exception when others then raise exception 'The scale and the passing mark must be numbers.'; end;
  v_dir := coalesce(p_config ->> 'direction', 'lower_is_better');
  v_letters := coalesce((p_config ->> 'uses_letter_grades')::boolean, false);
  if v_min is null or v_max is null or v_min >= v_max then raise exception 'The lowest grade must be smaller than the highest grade.'; end if;
  if v_dir not in ('lower_is_better', 'higher_is_better') then raise exception 'Choose whether a lower or a higher number is better.'; end if;
  if v_pass is null or v_pass < v_min or v_pass > v_max then raise exception 'The passing mark must be on the school''s scale (from % to %).', v_min, v_max; end if;
  if jsonb_typeof(coalesce(p_letters, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_marks, '[]'::jsonb)) <> 'array' then raise exception 'The lists of letters and marks are not valid.'; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_letters, '[]'::jsonb)) loop
    v_text := btrim(coalesce(v_row ->> 'letter', ''));
    if v_text = '' or char_length(v_text) > 12 then raise exception 'Every letter grade needs a letter (12 characters at most).'; end if;
    if lower(v_text) = any (v_seen) then raise exception 'The letter "%" is listed twice.', v_text; end if;
    v_seen := v_seen || lower(v_text);
    if v_row ->> 'numeric_value' is not null and btrim(v_row ->> 'numeric_value') <> '' then
      begin v_num := (v_row ->> 'numeric_value')::numeric; exception when others then raise exception 'The number for "%" is not valid.', v_text; end;
    end if;
  end loop;
  v_seen := '{}';
  for v_row in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    v_text := btrim(coalesce(v_row ->> 'mark', '')); v_meaning := btrim(coalesce(v_row ->> 'meaning', '')); v_outcome := coalesce(v_row ->> 'outcome', '');
    if v_text = '' or char_length(v_text) > 12 then raise exception 'Every mark needs the mark itself (12 characters at most).'; end if;
    if v_text ~ '^\d+([.,]\d+)?$' then raise exception 'The mark "%" is a number; numbers are graded on the scale, not added here.', v_text; end if;
    if upper(v_text) in ('INC', 'DRP') then raise exception 'INC and DRP are built in and cannot be changed.'; end if;
    if v_meaning = '' or char_length(v_meaning) > 120 then raise exception 'Say what "%" stands for (120 characters at most).', v_text; end if;
    if v_outcome not in ('passed', 'failed', 'incomplete', 'review') then raise exception 'Choose what "%" means for renewal.', v_text; end if;
    if lower(v_text) = any (v_seen) then raise exception 'The mark "%" is listed twice.', v_text; end if;
    v_seen := v_seen || lower(v_text);
  end loop;

  insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, passing_mark, set_by_staff, staff_note, staff_set_at, staff_set_by, updated_at)
  values (p_school_id, v_min, v_max, v_dir, v_letters, v_pass, true, left(btrim(coalesce(p_note, '')), 500), now(), auth.uid(), now())
  on conflict (school_id) do update set scale_min = excluded.scale_min, scale_max = excluded.scale_max, direction = excluded.direction, uses_letter_grades = excluded.uses_letter_grades,
    passing_mark = excluded.passing_mark, set_by_staff = true, staff_note = excluded.staff_note, staff_set_at = excluded.staff_set_at, staff_set_by = excluded.staff_set_by, updated_at = now();
  delete from public.school_letter_grades where school_id = p_school_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_letters, '[]'::jsonb)) loop
    insert into public.school_letter_grades (school_id, letter, numeric_value)
    values (p_school_id, btrim(v_row ->> 'letter'), case when v_row ->> 'numeric_value' is null or btrim(v_row ->> 'numeric_value') = '' then null else (v_row ->> 'numeric_value')::numeric end);
  end loop;
  delete from public.school_marks where school_id = p_school_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    insert into public.school_marks (school_id, mark, meaning, outcome) values (p_school_id, btrim(v_row ->> 'mark'), btrim(v_row ->> 'meaning'), v_row ->> 'outcome');
  end loop;
  -- grades that could not be judged before (no passing mark) can be now: check the applications of that school's scholars again
  perform public._renewal_recheck(r.id) from public.renewal_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number
    where s.school_id = p_school_id and r.stage in ('waiting_grades', 'review_needed', 'sdp_on_hold', 'submitted');
end;
$$;

notify pgrst, 'reload schema';
commit;
