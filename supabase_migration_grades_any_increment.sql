-- ─────────────────────────────────────────────────────────────
-- supabase_migration_grades_any_increment.sql
-- A school that has a conversion table could only enter the grades listed in the table (for example 1.00, 1.25, 1.50 ...), so 1.1 or 1.2 were refused: "Grade 1.1 is not in your conversion table".
-- Now any plain number on the school's scale is accepted, in any increment (1.1, 1.2, 1.15 ...). What does NOT change: a percentage still turns into the table's grade; letters and other marks must still be
-- in the school's lists; the lowest and highest grade of the scale still apply; and a grade that is not in the table is judged Passed / Failed by the school's passing mark on the scale, as before.
-- Nothing in any table is changed. Safe to run twice.
-- ─────────────────────────────────────────────────────────────
begin;

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
  -- a plain number is accepted whatever its steps (1.1, 1.2, 1.15 ...): the conversion table lists the grades a percentage turns into, it does not limit the numbers that may be typed (the scale limits still apply)
  if v_grade !~ '^\d+(\.\d+)?$' and not exists (select 1 from public.school_grade_bands x where x.version_id = v_ver and public._grading_same_grade(v_grade, x.equivalent_grade)) then
    select string_agg(distinct x.equivalent_grade, ', ') into v_list from public.school_grade_bands x where x.version_id = v_ver;
    error := format('Grade "%s" is not in your conversion table. Use one of: %s.', v_grade, v_list);
  end if;
  return next; return;
end;
$$;
revoke all on function public._grading_entry(uuid, text, text, text, numeric) from public, anon;
grant execute on function public._grading_entry(uuid, text, text, text, numeric) to authenticated;

commit;
