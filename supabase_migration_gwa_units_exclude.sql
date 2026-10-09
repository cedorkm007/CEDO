-- ─────────────────────────────────────────────────────────────
-- supabase_migration_gwa_units_exclude.sql
--
-- Phase 4 of the Scholar Grades improvements (GWA weighted by units).
-- Run AFTER supabase_migration_bulk_grades_validation.sql. Nothing is deleted or changed in
-- existing rows; safe to re-run.
--
--   1. scholar_subjects_grades.exclude_from_gwa — "do not count this subject in the GWA"
--      (NSTP, PE, ...). Defaults to false, so every existing subject keeps counting exactly
--      as before.
--   2. upsert_scholar_subject_grade() takes an optional p_exclude_from_gwa (left out / null =
--      keep what is stored; a new subject starts as false), and
--      bulk_upsert_scholar_subject_grades() passes an optional "excludeFromGwa" through. The
--      CSV template has no such column, so an upload never changes the flag of a subject that
--      already exists. Callers that still send the previous arguments keep working.
--
-- The GWA itself is computed in the app (src/lib/gwa.ts — one calculation shared by the school,
-- staff and scholar views):  sum(grade x units) / sum(units)  over subjects whose grade
-- resolves to a number and that are not excluded. A subject with no units yet counts as 1 unit.
-- ─────────────────────────────────────────────────────────────

alter table public.scholar_subjects_grades add column if not exists exclude_from_gwa boolean not null default false;

-- Replace the 8-argument version with a 9-argument one (extra argument has a default). Dropping
-- first avoids two overloads that would make a shorter call ambiguous.
drop function if exists public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric);

create or replace function public.upsert_scholar_subject_grade(
  p_id uuid,
  p_scholar_id_number text,
  p_school_year text,
  p_semester text,
  p_subject_code text,
  p_subject text,
  p_grade text,
  p_units numeric default null,
  p_exclude_from_gwa boolean default null
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
        updated_at = now()
    where id = p_id and scholar_id_number = p_scholar_id_number
      and exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id)
    returning id into v_row_id;
    if v_row_id is null then
      raise exception 'Grade row not found or not editable by your school.';
    end if;
  else
    insert into public.scholar_subjects_grades
      (scholar_id_number, school_year, semester, subject_code, subject, grade, units, exclude_from_gwa, recorded_by_school_id)
    values
      (p_scholar_id_number, p_school_year, p_semester, p_subject_code, p_subject, nullif(trim(p_grade), ''), p_units, coalesce(p_exclude_from_gwa, false), v_school_id)
    returning id into v_row_id;
  end if;
  return v_row_id;
end;
$$;
grant execute on function public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text, numeric, boolean) to authenticated;

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
        case when v_row->>'units' is null or v_row->>'units' = '' then null else (v_row->>'units')::numeric end,
        case when v_row->>'excludeFromGwa' is null or v_row->>'excludeFromGwa' = '' then null else (v_row->>'excludeFromGwa')::boolean end
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

-- Result check (shown in the SQL editor)
select
  (select count(*) from public.scholar_subjects_grades) as grade_rows,
  (select count(*) from public.scholar_subjects_grades where units is null and not exclude_from_gwa) as subjects_still_needing_units,
  (select count(*) from public.scholar_subjects_grades where exclude_from_gwa) as subjects_excluded_from_gwa;
