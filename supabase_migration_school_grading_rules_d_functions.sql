-- ─────────────────────────────────────────────────────────────
-- SCHOOL GRADING RULES, FILE D of 3 (Phase 2): the saved rules start to be USED.   Safe to run twice.   Undo: undo_school_grading_rules_d.sql
-- Run AFTER supabase_migration_school_grading_rules_a_tables.sql, _b_percentage.sql and _c_functions.sql.
--
-- What it does, in plain words:
--   1. Saving a grade can now carry a PERCENTAGE. When the school's rules (for that semester) have a conversion table, the percentage is turned into the equivalent grade
--      (the grade is what the rest of the system already reads), and both are kept. A school that enters grades keeps entering grades. Nothing is guessed: an unclear row is refused with a message.
--   2. A subject saved for the first time is marked "Exclude from GWA" when its code is on the school's list of default excluded codes (e.g. NSTP). Subjects saved before are never touched.
--   3. Renewal now decides Passed / Failed from the school's conversion table and passing mark (the programme's own passing mark when it has one) for the semester judged.
--      For semesters before the rules start, and for schools with no rules, nothing changes: the old passing mark is used exactly as before.
--   4. One read, grading_rules_timeline(), lets the school, its scholars and CEDO staff see which rules applied in which semester (so every screen shows the same GWA).
--
-- Nothing is deleted and no saved grade is changed. The rules a school saved are never edited here. Past semesters keep the rules they had: a version only applies from the semester it starts at.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.school_grading_versions') is null or to_regprocedure('public._grading_period_rank(text, text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_school_grading_rules_a_tables.sql and _c_functions.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scholar_subjects_grades' and column_name = 'percentage') then
    raise exception 'STOPPED, nothing changed: run supabase_migration_school_grading_rules_b_percentage.sql first.';
  end if;
end $$;

-- 1. Which rules apply to a semester: the latest version that starts at or before it (NULL = the school has saved no rules yet).
create or replace function public._grading_version_at(p_school uuid, p_year text, p_term text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select v.id from public.school_grading_versions v
  where v.school_id = p_school
    and public._grading_period_rank(v.effective_year, v.effective_term) <= public._grading_period_rank(btrim(p_year), coalesce(public.normalize_academic_term(p_term), p_term))
  order by public._grading_period_rank(v.effective_year, v.effective_term) desc, v.version_no desc
  limit 1;
$$;

-- Two grades are the same grade when they read the same ("1.5" and "1.50", "b" and "B").
create or replace function public._grading_same_grade(p_a text, p_b text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_a, ''))) = lower(btrim(coalesce(p_b, '')))
      or (btrim(coalesce(p_a, '')) ~ '^\d+(\.\d+)?$' and btrim(coalesce(p_b, '')) ~ '^\d+(\.\d+)?$' and btrim(p_a)::numeric = btrim(p_b)::numeric);
$$;

-- The passing mark in percent for a programme: its own when the school listed it, else the school's.
create or replace function public._grading_passing(p_version uuid, p_course text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (e ->> 'passingPct')::numeric from public.school_grading_versions v, jsonb_array_elements(v.program_passing_marks) e
     where v.id = p_version and btrim(coalesce(p_course, '')) <> '' and lower(btrim(e ->> 'program')) = lower(btrim(p_course)) limit 1),
    (select v.passing_mark_pct from public.school_grading_versions v where v.id = p_version));
$$;

-- 2. Passed / failed under the rules of the semester. Same answers as _grade_outcome(): ungraded | inc | drp | passed | failed | review | no_passing_mark.
--    INC, DRP and the school's own marks mean what they always meant. A grade or percentage that the conversion table covers is judged by the table; everything else by the old rule.
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

-- 3. What a saved row becomes: the grade and percentage to store, or the message that explains why not.
create or replace function public._grading_entry(p_school uuid, p_year text, p_term text, p_grade text, p_pct numeric)
returns table(grade text, percentage numeric, error text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_ver uuid; v_mode text; b public.school_grade_bands%rowtype; v_special boolean; v_list text;
begin
  grade := v_grade; percentage := null; error := null;
  if p_pct is not null and (p_pct < 0 or p_pct > 100) then error := 'The percentage must be from 0 to 100.'; return next; return; end if;
  v_special := v_grade is not null and (upper(v_grade) in ('INC', 'DRP') or exists (select 1 from public.school_marks m where m.school_id = p_school and lower(btrim(m.mark)) = lower(v_grade)));
  if p_pct is not null and v_special then error := format('%s has no percentage. Leave the percentage empty.', v_grade); return next; return; end if;

  v_ver := public._grading_version_at(p_school, p_year, p_term);
  if v_ver is not null and not exists (select 1 from public.school_grade_bands x where x.version_id = v_ver) then v_ver := null; end if;
  if v_ver is null then
    if p_pct is not null then error := 'Your school has no conversion table for this semester, so a percentage cannot be saved. Enter the grade.'; end if;
    return next; return;
  end if;

  select entry_mode into v_mode from public.school_grading_versions where id = v_ver;
  if p_pct is not null then
    if v_mode = 'grade' then error := 'Your school enters grades, not percentages (see the Grading System tab). Leave the percentage empty.'; return next; return; end if;
    select * into b from public.school_grade_bands x where x.version_id = v_ver and p_pct between x.pct_from and x.pct_to order by x.sort_no limit 1;
    if not found then error := format('A percentage of %s is not in your conversion table.', p_pct::float8::text); return next; return; end if;
    if v_grade is not null and not public._grading_same_grade(v_grade, b.equivalent_grade) then
      error := format('A percentage of %s is %s in your conversion table, not %s.', p_pct::float8::text, b.equivalent_grade, v_grade); return next; return;
    end if;
    grade := b.equivalent_grade; percentage := p_pct; return next; return;
  end if;

  if v_grade is null or v_special then return next; return; end if;
  if v_mode = 'percentage' then error := 'Enter the percentage for this subject: your school enters percentages.'; return next; return; end if;
  if not exists (select 1 from public.school_grade_bands x where x.version_id = v_ver and public._grading_same_grade(v_grade, x.equivalent_grade)) then
    select string_agg(distinct x.equivalent_grade, ', ') into v_list from public.school_grade_bands x where x.version_id = v_ver;
    error := format('Grade "%s" is not in your conversion table. Use one of: %s.', v_grade, v_list);
  end if;
  return next; return;
end;
$$;
revoke all on function public._grading_entry(uuid, text, text, text, numeric) from public, anon;
grant execute on function public._grading_entry(uuid, text, text, text, numeric) to authenticated;

-- A subject saved for the first time starts excluded from the GWA when its code is on the school's list.
create or replace function public._grading_default_excluded(p_school uuid, p_year text, p_term text, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select btrim(coalesce(p_code, '')) <> '' and exists (
    select 1 from public.school_grading_versions v, unnest(v.gwa_excluded_codes) c
    where v.id = public._grading_version_at(p_school, p_year, p_term) and lower(btrim(c)) = lower(btrim(p_code)));
$$;
revoke all on function public._grading_default_excluded(uuid, text, text, text) from public, anon;
grant execute on function public._grading_default_excluded(uuid, text, text, text) to authenticated;

-- 4. Saving one subject (the manual entry screen) and many (the upload): now with a percentage.
drop function if exists public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean, text);
create or replace function public.upsert_scholar_subject_grade(
  p_id uuid,
  p_scholar_id_number text,
  p_school_year text,
  p_semester text,
  p_subject_code text,
  p_subject text,
  p_grade text,
  p_units numeric default null,
  p_exclude_from_gwa boolean default null,
  p_remarks text default null,
  p_percentage numeric default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
  v_row_id uuid;
  v_old record; v_found boolean := false; v_keep boolean;
  v_year text; v_term text;
  v_grade text := nullif(trim(p_grade), '');
  v_pct numeric;
  v_e record;
begin
  if v_school_id is null then
    raise exception 'Not authorized — no school account found.';
  end if;
  if not exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id) then
    raise exception 'That scholar does not belong to your school.';
  end if;
  if p_units is not null and p_units <= 0 then
    raise exception 'Units must be a positive number.';
  end if;

  if p_id is not null then
    select g.school_year, g.semester, g.grade, g.percentage into v_old from public.scholar_subjects_grades g where g.id = p_id and g.scholar_id_number = p_scholar_id_number;
    v_found := found;
  end if;
  if v_found then
    v_year := v_old.school_year; v_term := v_old.semester;
  else
    v_year := btrim(p_school_year); v_term := p_semester;
  end if;

  v_keep := false;
  if v_found and p_percentage is null then
    v_keep := v_grade is not distinct from nullif(btrim(coalesce(v_old.grade, '')), '');
  end if;
  if v_keep then
    v_pct := v_old.percentage;                       -- the grade did not change: it keeps its percentage
  else
    select * into v_e from public._grading_entry(v_school_id, v_year, v_term, v_grade, p_percentage);
    if v_e.error is not null then raise exception '%', v_e.error; end if;
    v_grade := v_e.grade; v_pct := v_e.percentage;
  end if;

  if p_id is not null then
    update public.scholar_subjects_grades
    set subject_code = p_subject_code, subject = p_subject, grade = v_grade, percentage = v_pct,
        units = coalesce(p_units, units),
        exclude_from_gwa = coalesce(p_exclude_from_gwa, exclude_from_gwa),
        remarks = case when p_remarks is null then remarks else left(btrim(p_remarks), 200) end,
        updated_at = now()
    where id = p_id and scholar_id_number = p_scholar_id_number
      and exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id)
    returning id into v_row_id;
    if v_row_id is null then
      raise exception 'Grade row not found or not editable by your school.';
    end if;
  else
    insert into public.scholar_subjects_grades
      (scholar_id_number, school_year, semester, subject_code, subject, grade, percentage, units, exclude_from_gwa, remarks, recorded_by_school_id)
    values
      (p_scholar_id_number, p_school_year, p_semester, p_subject_code, p_subject, v_grade, v_pct, p_units,
       coalesce(p_exclude_from_gwa, public._grading_default_excluded(v_school_id, v_year, v_term, p_subject_code), false),
       left(btrim(coalesce(p_remarks, '')), 200), v_school_id)
    returning id into v_row_id;
  end if;
  return v_row_id;
end;
$$;
grant execute on function public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean, text, numeric) to authenticated;

create or replace function public.bulk_upsert_scholar_subject_grades(p_rows jsonb)
returns table(row_index int, ok boolean, error text, id uuid)
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_index int := 0;
  v_id uuid;
begin
  perform set_config('app.grade_source', 'csv', true);
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_id := public.upsert_scholar_subject_grade(
        case when v_row->>'id' is null or v_row->>'id' = '' then null else (v_row->>'id')::uuid end,
        v_row->>'scholarIdNumber',
        v_row->>'schoolYear',
        v_row->>'semester',
        coalesce(v_row->>'subjectCode', ''),
        v_row->>'subject',
        v_row->>'grade',
        case when v_row->>'units' is null or v_row->>'units' = '' then null else (v_row->>'units')::numeric end,
        case when v_row->>'excludeFromGwa' is null or v_row->>'excludeFromGwa' = '' then null else (v_row->>'excludeFromGwa')::boolean end,
        -- remarks: only touched when the upload carries them (an absent key keeps what is stored)
        case when v_row ? 'remarks' then coalesce(v_row->>'remarks', '') else null end,
        case when v_row->>'percentage' is null or btrim(v_row->>'percentage') = '' then null else (v_row->>'percentage')::numeric end
      );
      row_index := v_index; ok := true; error := null; id := v_id;
    exception when others then
      row_index := v_index; ok := false; error := sqlerrm; id := null;
    end;
    v_index := v_index + 1;
    return next;
  end loop;
end;
$$;
grant execute on function public.bulk_upsert_scholar_subject_grades(jsonb) to authenticated;

-- A grade corrected after submission (CEDO approved it) keeps a percentage only while it still gives that grade.
create or replace function public._scholar_grade_pct_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.percentage is not null and new.grade is distinct from old.grade and new.percentage is not distinct from old.percentage then
    if not exists (
      select 1 from public.school_grade_bands b
      where b.version_id = public._grading_version_at((select s.school_id from public.scholars s where s.scholar_id_number = new.scholar_id_number), new.school_year, new.semester)
        and new.percentage between b.pct_from and b.pct_to and public._grading_same_grade(new.grade, b.equivalent_grade)) then
      new.percentage := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists scholar_grades_rules_trg on public.scholar_subjects_grades;
create trigger scholar_grades_rules_trg before update on public.scholar_subjects_grades
  for each row execute function public._scholar_grade_pct_sync();

-- 5. The renewal decisions read the rules of the semester that is judged. Each edit is an exact find-and-replace inside the live function; if the live function is not what this file expects,
--    the whole file stops and nothing changes. Running it twice does nothing the second time.
do $patch$
declare
  e record; v_def text; n int;
begin
  for e in select * from (values
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id$o$,
      $o$select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id, r.percentage$o$),
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$select l.id, l.subject_code, l.subject, l.grade, null::uuid$o$,
      $o$select l.id, l.subject_code, l.subject, l.grade, null::uuid, null::numeric$o$),
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$v_outcome := public._grade_outcome(v_school, g.grade);$o$,
      $o$v_outcome := public._grade_outcome_at(v_school, g.grade, g.percentage, v_b_year, v_b_term, v_scholar.course);$o$),
    ('public._renewal_recheck(uuid)'::regprocedure,
      $o$select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome$o$,
      $o$select public._grade_outcome_at(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade, g.percentage, g.school_year, g.semester, v_scholar.course) into v_outcome$o$),
    ('public._school_renewal_rows(text,text)'::regprocedure,
      $o$select public._grade_outcome(s.school_id, g.grade) as o from public.scholar_subjects_grades g$o$,
      $o$select public._grade_outcome_at(s.school_id, g.grade, g.percentage, v_by, v_bt, s.course) as o from public.scholar_subjects_grades g$o$)
  ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(e.fn);
    if position(e.new_text in v_def) > 0 then continue; end if;
    n := (length(v_def) - length(replace(v_def, e.old_text, ''))) / length(e.old_text);
    if n <> 1 then
      raise exception 'STOPPED, nothing changed: the live function % is not the version this file was written for (found % matches). Tell CEDO''s developer.', e.fn, n;
    end if;
    execute replace(v_def, e.old_text, e.new_text);
  end loop;
end
$patch$;

-- 6. Which rules applied in which semester, for the screens (the school's own, its scholars', or any school for CEDO staff). Read only.
create or replace function public.grading_rules_timeline(p_school_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_scholar_school uuid;
begin
  if public.is_school_account() and public.current_school_id() is not null then
    v_ids := array[public.current_school_id()];
  else
    select s.school_id into v_scholar_school from public.scholars s where s.id = auth.uid() and s.school_id is not null;
    if v_scholar_school is not null then
      v_ids := array[v_scholar_school];
    elsif public.is_scholars_grades_monitoring_staff() or public.is_sead_staff() or public.can_view_renewals() then
      v_ids := p_school_ids;
    else
      raise exception 'Not authorized to see grading rules.';
    end if;
  end if;
  return coalesce((
    select jsonb_object_agg(x.school_id::text, x.versions)
    from (
      select v.school_id,
             jsonb_agg(public._grading_version_json(v.id) order by public._grading_period_rank(v.effective_year, v.effective_term), v.version_no) as versions
      from public.school_grading_versions v
      where v_ids is null or v.school_id = any(v_ids)
      group by v.school_id
    ) x), '{}'::jsonb);
end;
$$;
revoke all on function public.grading_rules_timeline(uuid[]) from public, anon;
grant execute on function public.grading_rules_timeline(uuid[]) to authenticated;

notify pgrst, 'reload schema';
