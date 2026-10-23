-- UNDO for supabase_migration_school_non_numeric_marks.sql: puts the two grade functions back as they were, removes the new functions and DELETES the marks
-- schools have added (the table). Grades already entered with such a mark (for example F) stay on the scholar's record but would then show as "needs review"
-- until the school's letter table covers them. Nothing else is touched.
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
  -- INC (incomplete) and DRP (dropped) are reserved marks every school may enter, whatever its scale or letter table.
  if upper(v_grade) in ('INC', 'DRP') then return null; end if;
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
begin
  if v_grade is null then return 'ungraded'; end if;
  if upper(v_grade) = 'INC' then return 'inc'; end if;
  if upper(v_grade) = 'DRP' then return 'drp'; end if;

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

drop function if exists public.set_school_marks(jsonb);
drop function if exists public.get_scholar_school_marks();
drop function if exists public.get_scholar_school_marks_for_staff(text);
drop table if exists public.school_marks;
notify pgrst, 'reload schema';
