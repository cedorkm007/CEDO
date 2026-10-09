-- ─────────────────────────────────────────────────────────────
-- tests/school-grades/bulk_grades_guard.sql
--
-- Phase 3 check — run in the Supabase SQL Editor AFTER supabase_migration_bulk_grades_validation.sql.
-- It acts as the first school account, with the REAL live rules, and checks that:
--   * a grade on the school's own scale is accepted, one outside it is refused (with the range in the message),
--   * a blank grade is accepted (declared, not graded yet),
--   * units are stored, and zero/negative units are refused,
--   * the bulk save reports each row on its own (good ones saved, bad ones refused with a reason),
--   * the bulk save refuses a scholar from another school.
--
-- Needs the school to have set up its grading scale (the School Portal's Grading System tab).
-- Safe: it uses a made-up Open period (2098-2099) and ends by raising an error ON PURPOSE, which rolls
-- everything back. The "error" is the report — every line should start with PASS.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid; v_scholar text; v_other_scholar text;
  v_cfg public.school_grading_configs%rowtype;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
  v_in text; v_out text;
  v_e_in text := 'no error'; v_e_out text := 'no error'; v_e_blank text := 'no error';
  v_e_zero text := 'no error'; v_e_units text := 'no error';
  v_id uuid; v_units numeric;
  v_bulk record; v_results text := ''; v_saved int := 0; v_other_ok boolean := true;
begin
  select a.id, a.school_id into v_acct, v_school from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then raise exception 'FAIL  a school account exists — public.school_accounts is empty'; end if;
  select * into v_cfg from public.school_grading_configs where school_id = v_school;
  if not found then raise exception 'FAIL  this school has not set up its grading scale yet — open the School Portal > Grading System tab and save it, then run this again'; end if;
  select scholar_id_number into v_scholar from public.scholars where school_id = v_school order by scholar_id_number limit 1;
  if v_scholar is null then raise exception 'FAIL  the school has at least one scholar'; end if;
  select scholar_id_number into v_other_scholar from public.scholars where school_id is not null and school_id <> v_school order by scholar_id_number limit 1;

  v_in := v_cfg.scale_min::float8::text;
  v_out := (v_cfg.scale_max + 1)::float8::text;

  insert into public.academic_periods (school_year, term, status) values ('2098-2099', '1st Semester', 'open');

  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  begin v_id := public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__A', '__in range', v_in, 3);
  exception when others then v_e_in := sqlerrm; end;
  select units into v_units from public.scholar_subjects_grades where id = v_id;

  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__B', '__out of range', v_out);
  exception when others then v_e_out := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__C', '__blank grade', '');
  exception when others then v_e_blank := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__D', '__zero units', v_in, 0);
  exception when others then v_e_zero := sqlerrm; end;

  for v_bulk in
    select * from public.bulk_upsert_scholar_subject_grades(jsonb_build_array(
      jsonb_build_object('scholarIdNumber', v_scholar, 'schoolYear', '2098-2099', 'semester', '1st Semester', 'subjectCode', '__E', 'subject', '__bulk good', 'grade', v_in, 'units', 2),
      jsonb_build_object('scholarIdNumber', v_scholar, 'schoolYear', '2098-2099', 'semester', '1st Semester', 'subjectCode', '__F', 'subject', '__bulk bad grade', 'grade', v_out, 'units', 2),
      jsonb_build_object('scholarIdNumber', coalesce(v_other_scholar, v_scholar), 'schoolYear', '2098-2099', 'semester', '1st Semester', 'subjectCode', '__G', 'subject', '__bulk other school', 'grade', v_in, 'units', 2)
    ))
  loop
    v_results := v_results || case when v_bulk.ok then 'saved' else 'refused' end || ',';
    if v_bulk.row_index = 2 and v_other_scholar is not null then v_other_ok := v_bulk.ok; end if;
    if v_bulk.ok then v_saved := v_saved + 1; end if;
  end loop;

  reset role;

  v_ok := v_e_in = 'no error' and v_units = 3;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. a grade on the school''s scale (%s) is accepted and its units are stored (%s, units=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_in, v_e_in, v_units));

  v_ok := v_e_out <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. a grade outside the scale (%s) is refused (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_out, v_e_out));

  v_ok := v_e_blank = 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. a blank grade is accepted — declared, not graded yet (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_blank));

  v_ok := v_e_zero <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. zero units are refused (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_zero));

  v_ok := v_results = 'saved,refused,' || case when v_other_scholar is null then 'saved,' else 'refused,' end;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  5. the bulk save judges each row on its own: good saved, out-of-range refused%s (got: %s)', case when v_ok then 'PASS' else 'FAIL' end, case when v_other_scholar is null then ' [no other school to test the third row with]' else ', another school''s scholar refused' end, rtrim(v_results, ',')));

  raise exception E'\n%\n\n%\n(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'\n'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
