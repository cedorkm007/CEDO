-- UNDO for supabase_migration_school_grading_rules_d_functions.sql: grades go back to being saved and judged the old way.
-- Percentages already saved stay in the column (remove them with undo_school_grading_rules_b.sql if you want them gone). No grade is changed. The rules the schools saved stay saved.

-- 1. Renewal goes back to the old passing mark.
do $patch$
declare
  e record; v_def text;
begin
  for e in select * from (values
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id, r.percentage$o$,
      $o$select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id$o$),
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$select l.id, l.subject_code, l.subject, l.grade, null::uuid, null::numeric$o$,
      $o$select l.id, l.subject_code, l.subject, l.grade, null::uuid$o$),
    ('public._renewal_evaluate(text,text,text)'::regprocedure,
      $o$v_outcome := public._grade_outcome_at(v_school, g.grade, g.percentage, v_b_year, v_b_term, v_scholar.course);$o$,
      $o$v_outcome := public._grade_outcome(v_school, g.grade);$o$),
    ('public._renewal_recheck(uuid)'::regprocedure,
      $o$select public._grade_outcome_at(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade, g.percentage, g.school_year, g.semester, v_scholar.course) into v_outcome$o$,
      $o$select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome$o$),
    ('public._school_renewal_rows(text,text)'::regprocedure,
      $o$select public._grade_outcome_at(s.school_id, g.grade, g.percentage, v_by, v_bt, s.course) as o from public.scholar_subjects_grades g$o$,
      $o$select public._grade_outcome(s.school_id, g.grade) as o from public.scholar_subjects_grades g$o$)
  ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(e.fn);
    if position(e.old_text in v_def) > 0 then execute replace(v_def, e.old_text, e.new_text); end if;
  end loop;
end
$patch$;

-- 2. Saving a grade goes back to the grade only (no percentage, no default excluded codes).
drop trigger if exists scholar_grades_rules_trg on public.scholar_subjects_grades;
drop function if exists public._scholar_grade_pct_sync();
drop function if exists public.grading_rules_timeline(uuid[]);

drop function if exists public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean, text, numeric);
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
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
  v_row_id uuid;
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
    update public.scholar_subjects_grades
    set subject_code = p_subject_code, subject = p_subject, grade = nullif(trim(p_grade), ''),
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
      (scholar_id_number, school_year, semester, subject_code, subject, grade, units, exclude_from_gwa, remarks, recorded_by_school_id)
    values
      (p_scholar_id_number, p_school_year, p_semester, p_subject_code, p_subject, nullif(trim(p_grade), ''), p_units, coalesce(p_exclude_from_gwa, false), left(btrim(coalesce(p_remarks, '')), 200), v_school_id)
    returning id into v_row_id;
  end if;
  return v_row_id;
end;
$$;
grant execute on function public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean, text) to authenticated;

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
        case when v_row ? 'remarks' then coalesce(v_row->>'remarks', '') else null end
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

-- 3. The helpers of file D.
drop function if exists public._grading_default_excluded(uuid, text, text, text);
drop function if exists public._grading_entry(uuid, text, text, text, numeric);
drop function if exists public._grade_outcome_at(uuid, text, numeric, text, text, text);
drop function if exists public._grading_passing(uuid, text);
drop function if exists public._grading_same_grade(text, text);
drop function if exists public._grading_version_at(uuid, text, text);

notify pgrst, 'reload schema';
