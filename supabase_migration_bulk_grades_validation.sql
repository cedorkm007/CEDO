-- ─────────────────────────────────────────────────────────────
-- supabase_migration_bulk_grades_validation.sql
--
-- Phase 3 of the Scholar Grades improvements (bulk CSV with validate-then-save).
-- Run AFTER supabase_migration_academic_periods.sql. Nothing is deleted; safe to re-run.
--
--   1. scholar_subjects_grades.units — the CSV template has a units column, so it has to
--      be stored. Optional, and must be positive when present. (Phase 4 uses it to weight
--      the GWA; existing subjects without units will count as 1 unit there.)
--   2. _school_grade_error() — "is this grade on this school's own scale or in its letter
--      table?", answered by the database so it holds for every way a school can save a
--      grade (the bulk upload, the grade-entry screen, anything else). A blank grade is
--      always allowed ("declared, not graded yet"). A school that has not set up its
--      grading scale yet cannot save a grade.
--   3. The period guard trigger from Phase 2 now also runs that check for SCHOOL accounts
--      (on insert, and on update only when the grade itself changes — so an old
--      out-of-range grade does not block editing a subject name). Staff and other writers
--      are not checked.
--   4. upsert_scholar_subject_grade() gets an optional p_units (keeps the stored units when
--      it is left out, so the grade-entry screen does not wipe units set by a CSV), and
--      bulk_upsert_scholar_subject_grades() passes units through. Existing callers that send
--      the old 7 arguments keep working.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Units ────────────────────────────────────────────────
alter table public.scholar_subjects_grades add column if not exists units numeric;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scholar_subjects_grades_units_positive') then
    alter table public.scholar_subjects_grades
      add constraint scholar_subjects_grades_units_positive check (units is null or units > 0);
  end if;
end $$;

-- ── 2. Grade-on-scale check ─────────────────────────────────
-- Returns NULL when the grade is acceptable, otherwise a message fit to show the school.
create or replace function public._school_grade_error(p_school_id uuid, p_grade text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grade text := nullif(btrim(coalesce(p_grade, '')), '');
  v_cfg public.school_grading_configs%rowtype;
  v_min text; v_max text;
begin
  if v_grade is null then return null; end if;

  select * into v_cfg from public.school_grading_configs where school_id = p_school_id;
  if not found then
    return 'Set up your grading scale in the Grading System tab before entering grades.';
  end if;
  v_min := v_cfg.scale_min::float8::text;
  v_max := v_cfg.scale_max::float8::text;

  if v_grade ~ '^\d+(\.\d+)?$' then
    if v_grade::numeric between v_cfg.scale_min and v_cfg.scale_max then return null; end if;
    return format('Grade %s is outside your grading scale (%s to %s).', v_grade, v_min, v_max);
  end if;

  if v_cfg.uses_letter_grades and exists (
    select 1 from public.school_letter_grades l
    where l.school_id = p_school_id and lower(btrim(l.letter)) = lower(v_grade)
  ) then
    return null;
  end if;

  return format('Grade "%s" is not on your grading scale (%s to %s)%s.', v_grade, v_min, v_max,
    case when v_cfg.uses_letter_grades then ' or in your letter-grade table' else '' end);
end;
$$;

-- ── 3. Guard trigger: Phase 2's open-period rule + the grade check ──
create or replace function public.scholar_grades_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scholar_subjects_grades;
  v_term text;
  v_year text;
  v_pid uuid;
  v_status text;
  v_old_status text;
  v_grade_error text;
  v_is_school boolean := public.is_school_account();
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  v_year := btrim(v_row.school_year);
  v_term := public.normalize_academic_term(v_row.semester);

  select p.id, p.status into v_pid, v_status
  from public.academic_periods p
  where p.school_year = v_year and p.term = v_term;

  if v_is_school then
    if v_pid is null then
      raise exception 'The % % grading period has not been set up by CEDO yet, so grades cannot be saved for it.', v_year, coalesce(v_term, btrim(v_row.semester));
    end if;
    if v_status <> 'open' then
      raise exception 'Grades for % % are % — schools can only change grades in an Open period.', v_year, v_term, v_status;
    end if;
    if tg_op = 'UPDATE' and old.period_id is not null then
      select status into v_old_status from public.academic_periods where id = old.period_id;
      if v_old_status is distinct from 'open' then
        raise exception 'This grade belongs to a period that is % — schools can only change grades in an Open period.', coalesce(v_old_status, 'not set up');
      end if;
    end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.grade is distinct from old.grade) then
      v_grade_error := public._school_grade_error(public.current_school_id(), new.grade);
      if v_grade_error is not null then
        raise exception '%', v_grade_error;
      end if;
    end if;
  elsif tg_op <> 'DELETE' and v_pid is null and v_term is not null and v_year ~ '^\d{4}-\d{4}$' then
    insert into public.academic_periods (school_year, term, status)
    values (v_year, v_term, 'open')
    on conflict (school_year, term) do update set school_year = excluded.school_year
    returning id into v_pid;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.school_year := v_year;
  new.period_id := v_pid;
  if v_term is not null then new.semester := v_term; end if;
  return new;
end;
$$;

-- ── 4. Save RPCs with units ─────────────────────────────────
-- Replace the 7-argument version with an 8-argument one (extra argument has a default, so
-- callers that still send 7 named arguments work unchanged). Dropping first avoids two
-- overloads that would make a 7-argument call ambiguous.
drop function if exists public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text);

create or replace function public.upsert_scholar_subject_grade(
  p_id uuid,
  p_scholar_id_number text,
  p_school_year text,
  p_semester text,
  p_subject_code text,
  p_subject text,
  p_grade text,
  p_units numeric default null
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
        units = coalesce(p_units, units), updated_at = now()
    where id = p_id and scholar_id_number = p_scholar_id_number
      and exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id)
    returning id into v_row_id;
    if v_row_id is null then
      raise exception 'Grade row not found or not editable by your school.';
    end if;
  else
    insert into public.scholar_subjects_grades
      (scholar_id_number, school_year, semester, subject_code, subject, grade, units, recorded_by_school_id)
    values
      (p_scholar_id_number, p_school_year, p_semester, p_subject_code, p_subject, nullif(trim(p_grade), ''), p_units, v_school_id)
    returning id into v_row_id;
  end if;
  return v_row_id;
end;
$$;
grant execute on function public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric) to authenticated;

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
        case when v_row->>'units' is null or v_row->>'units' = '' then null else (v_row->>'units')::numeric end
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

-- Tell the API layer to pick up the replaced functions right away.
notify pgrst, 'reload schema';

-- ── 5. Result check (shown in the SQL editor) ───────────────
select
  (select count(*) from public.scholar_subjects_grades) as grade_rows,
  (select count(*) from public.scholar_subjects_grades where units is not null) as rows_with_units,
  (select count(*) from public.school_grading_configs) as schools_with_a_grading_scale,
  (select count(*) from public.school_accounts) as school_accounts;

