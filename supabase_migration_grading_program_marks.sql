-- ─────────────────────────────────────────────────────────────
-- supabase_migration_grading_program_marks.sql
-- SCHOLARS' GRADES MONITORING > GRADING SETUP: A PASSING MARK FOR A SPECIFIC PROGRAM OF A SCHOOL.   Safe to run twice.   Undo: undo_grading_program_marks.sql
--   * While a school has not set up its own grading system, CEDO staff set one up for the time being (Grading setup tab). Now staff can also give a single PROGRAM of that school its own passing mark
--     (for example BS Nursing 2.5 while the school's passing mark is 3.0). The mark is on the same scale as the school's passing mark.
--   * A program's own mark is used only while the setup is the one staff made for the time being. When the school saves its own grading system, its own rules apply again and these marks are no longer used.
--   * A subject is judged with the scholar's program: the program's mark when there is one, else the school's passing mark. Grades of other programs and of schools without program marks are judged exactly as before.
--   * What it does: adds 1 column to school_grading_configs (a list, empty for every school now), adds a 3-argument pass/fail rule (the old 2-argument rule stays and gives the same answers),
--     replaces 4 functions (the pass/fail rule of a semester, and the staff setup list / read / save) and adds 2 small read functions for the scholar's and the staff's grade screens. No grade and no school's setup is changed or deleted.
-- Needs the entered grades files and supabase_migration_school_grading_rules_d_functions.sql.
-- ─────────────────────────────────────────────────────────────

begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.school_grading_configs') is null or to_regprocedure('public._grade_outcome(uuid,text)') is null or to_regprocedure('public._grade_outcome_at(uuid,text,numeric,text,text,text)') is null
     or to_regprocedure('public.grading_setup_save(uuid,jsonb,jsonb,jsonb,text)') is null then
    raise exception 'STOPPED, nothing changed: run the entered grades files and supabase_migration_school_grading_rules_d_functions.sql first.';
  end if;
end $$;

-- 1. The programs with their own passing mark, kept with the school's setup (empty for every school now).
alter table public.school_grading_configs add column if not exists staff_program_marks jsonb not null default '[]'::jsonb;

-- 2. The pass / fail rule with the programme.
create or replace function public._grade_outcome(p_school_id uuid, p_grade text, p_course text)
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
  v_pass numeric;
  v_prog numeric;
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
  -- the passing mark of the school, or of the programme when CEDO staff set one for it (only while the grading setup is the one staff made for the time being)
  v_pass := v_cfg.passing_mark;
  if v_cfg.set_by_staff and btrim(coalesce(p_course, '')) <> '' then
    select (e ->> 'passing_mark')::numeric into v_prog from jsonb_array_elements(coalesce(v_cfg.staff_program_marks, '[]'::jsonb)) e
    where lower(btrim(e ->> 'program')) = lower(btrim(p_course)) limit 1;
    if v_prog is not null then v_pass := v_prog; end if;
  end if;

  if v_grade ~ '^\d+(\.\d+)?$' then
    v_value := v_grade::numeric;
  elsif v_cfg.uses_letter_grades then
    select l.numeric_value into v_value from public.school_letter_grades l
    where l.school_id = p_school_id and lower(btrim(l.letter)) = lower(v_grade)
    limit 1;
  end if;
  if v_value is null then return 'review'; end if;

  if v_cfg.direction = 'lower_is_better' then
    return case when v_value > v_pass then 'failed' else 'passed' end;
  end if;
  return case when v_value < v_pass then 'failed' else 'passed' end;
end;
$$;
revoke all on function public._grade_outcome(uuid, text, text) from public, anon, authenticated;

-- the old two-argument rule stays (many functions call it); it is the same rule without a programme
create or replace function public._grade_outcome(p_school_id uuid, p_grade text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public._grade_outcome(p_school_id, p_grade, null::text);
$$;
revoke all on function public._grade_outcome(uuid, text) from public, anon, authenticated;

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
    return public._grade_outcome(p_school, v_grade, p_course);
  end if;
  v_ver := public._grading_version_at(p_school, p_year, p_term);
  if v_ver is null or not exists (select 1 from public.school_grade_bands b where b.version_id = v_ver) then
    return public._grade_outcome(p_school, v_grade, p_course);
  end if;
  if p_pct is not null then
    select count(*), count(*) filter (where b.pct_from < coalesce(public._grading_passing(v_ver, p_course), 101)) into v_bands, v_fail
    from public.school_grade_bands b where b.version_id = v_ver and p_pct between b.pct_from and b.pct_to;
  else
    select count(*), count(*) filter (where b.pct_from < coalesce(public._grading_passing(v_ver, p_course), 101)) into v_bands, v_fail
    from public.school_grade_bands b where b.version_id = v_ver and public._grading_same_grade(v_grade, b.equivalent_grade);
  end if;
  if v_bands = 0 then return public._grade_outcome(p_school, v_grade, p_course); end if;     -- a grade the table does not know: the old rule decides
  v_pass := public._grading_passing(v_ver, p_course);
  if v_pass is null then return 'no_passing_mark'; end if;
  return case when v_fail > 0 then 'failed' else 'passed' end;                       -- two rows of the same grade on different sides of a programme's passing mark: the stricter reading
end;
$$;

-- 3. The staff setup: the list of schools (with how many programs have their own mark), reading one school (with its programs to pick from) and saving it.
drop function if exists public.grading_setup_schools();
create or replace function public.grading_setup_schools()
returns table(school_id uuid, name text, scholars bigint, has_setup boolean, passing_mark numeric, set_by_staff boolean, letters bigint, marks bigint, program_marks bigint)
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
         (select count(*) from public.school_letter_grades l where l.school_id = sc.id), (select count(*) from public.school_marks m where m.school_id = sc.id),
         coalesce(jsonb_array_length(c.staff_program_marks), 0)::bigint
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
        'passing_mark', c.passing_mark, 'set_by_staff', c.set_by_staff, 'staff_note', c.staff_note, 'staff_set_at', c.staff_set_at,
        'program_marks', coalesce(c.staff_program_marks, '[]'::jsonb)) end,
    -- the programmes of this school's scholars (to pick from), with how many scholars each has
    'programs', coalesce((select jsonb_agg(jsonb_build_object('program', x.course, 'scholars', x.n) order by x.course)
                          from (select btrim(s.course) as course, count(*) as n from public.scholars s
                                where s.school_id = p_school_id and btrim(coalesce(s.course, '')) <> '' and s.status <> 'Removed' group by btrim(s.course)) x), '[]'::jsonb),
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
  v_prog_marks jsonb := '[]'::jsonb;
  v_prog_seen text[] := '{}';
  v_prog_name text;
  v_prog_mark numeric;
begin
  if not public.is_scholars_grades_monitoring_staff() then raise exception 'Not authorized to set up grading systems.'; end if;
  if not exists (select 1 from public.schools where id = p_school_id) then raise exception 'That school was not found.'; end if;
  begin v_min := (p_config ->> 'scale_min')::numeric; v_max := (p_config ->> 'scale_max')::numeric; v_pass := (p_config ->> 'passing_mark')::numeric; exception when others then raise exception 'The scale and the passing mark must be numbers.'; end;
  v_dir := coalesce(p_config ->> 'direction', 'lower_is_better');
  v_letters := coalesce((p_config ->> 'uses_letter_grades')::boolean, false);
  if v_min is null or v_max is null or v_min >= v_max then raise exception 'The lowest grade must be smaller than the highest grade.'; end if;
  if v_dir not in ('lower_is_better', 'higher_is_better') then raise exception 'Choose whether a lower or a higher number is better.'; end if;
  if v_pass is null or v_pass < v_min or v_pass > v_max then raise exception 'The passing mark must be on the school''s scale (from % to %).', v_min, v_max; end if;
  -- marks of single programmes (on the same scale as the school's passing mark): [{"program": "BS Nursing", "passing_mark": 2.5}, ...]
  if jsonb_typeof(coalesce(p_config -> 'program_marks', '[]'::jsonb)) <> 'array' then raise exception 'The list of programmes is not valid.'; end if;
  if jsonb_array_length(coalesce(p_config -> 'program_marks', '[]'::jsonb)) > 100 then raise exception 'At most 100 programmes can have their own passing mark.'; end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_config -> 'program_marks', '[]'::jsonb)) loop
    v_prog_name := btrim(coalesce(v_row ->> 'program', ''));
    if v_prog_name = '' or char_length(v_prog_name) > 200 then raise exception 'Every programme needs its name (200 characters at most).'; end if;
    if lower(v_prog_name) = any (v_prog_seen) then raise exception 'The programme "%" is listed twice.', v_prog_name; end if;
    v_prog_seen := v_prog_seen || lower(v_prog_name);
    begin v_prog_mark := (v_row ->> 'passing_mark')::numeric; exception when others then raise exception 'The passing mark of "%" must be a number.', v_prog_name; end;
    if v_prog_mark is null or v_prog_mark < v_min or v_prog_mark > v_max then raise exception 'The passing mark of "%" must be on the school''s scale (from % to %).', v_prog_name, v_min, v_max; end if;
    v_prog_marks := v_prog_marks || jsonb_build_array(jsonb_build_object('program', v_prog_name, 'passing_mark', v_prog_mark));
  end loop;
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

  insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, passing_mark, set_by_staff, staff_note, staff_set_at, staff_set_by, updated_at, staff_program_marks)
  values (p_school_id, v_min, v_max, v_dir, v_letters, v_pass, true, left(btrim(coalesce(p_note, '')), 500), now(), auth.uid(), now(), v_prog_marks)
  on conflict (school_id) do update set scale_min = excluded.scale_min, scale_max = excluded.scale_max, direction = excluded.direction, uses_letter_grades = excluded.uses_letter_grades,
    passing_mark = excluded.passing_mark, set_by_staff = true, staff_note = excluded.staff_note, staff_set_at = excluded.staff_set_at, staff_set_by = excluded.staff_set_by, updated_at = now(), staff_program_marks = excluded.staff_program_marks;
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

-- 4. For the scholar's own grade screen and the staff's scholar screens.
-- for the scholar herself / himself: also the passing mark that applies to this scholar (the program's own while the setup is the staff's, else the school's)
create or replace function public.get_scholar_grading_program_marks()
returns table(set_by_staff boolean, program_marks jsonb, passing_mark numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(c.set_by_staff, false), coalesce(c.staff_program_marks, '[]'::jsonb),
         coalesce(case when c.set_by_staff then (select (e ->> 'passing_mark')::numeric from jsonb_array_elements(coalesce(c.staff_program_marks, '[]'::jsonb)) e
                                                  where lower(btrim(e ->> 'program')) = lower(btrim(coalesce(s.course, ''))) limit 1) end, c.passing_mark)
  from public.school_grading_configs c join public.scholars s on s.school_id = c.school_id
  where s.id = auth.uid();
$$;
revoke all on function public.get_scholar_grading_program_marks() from public, anon;
grant execute on function public.get_scholar_grading_program_marks() to authenticated;

create or replace function public.get_scholar_grading_program_marks_for_staff(p_scholar_id_number text)
returns table(set_by_staff boolean, program_marks jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(c.set_by_staff, false), coalesce(c.staff_program_marks, '[]'::jsonb)
  from public.school_grading_configs c join public.scholars s on s.school_id = c.school_id
  where s.scholar_id_number = p_scholar_id_number and public.is_scholars_grades_monitoring_staff();
$$;
revoke all on function public.get_scholar_grading_program_marks_for_staff(text) from public, anon;
grant execute on function public.get_scholar_grading_program_marks_for_staff(text) to authenticated;

notify pgrst, 'reload schema';
commit;
