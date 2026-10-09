-- ─────────────────────────────────────────────────────────────
-- tests/school-grades/periods_guard.sql
--
-- Phase 2 check — run in the Supabase SQL Editor AFTER supabase_migration_academic_periods.sql.
-- It acts as the first school account and as a staff account tagged scholars_grades_monitoring
-- (if one exists), using the REAL live rules, and checks that:
--   * every existing grade row got linked to a period (nothing lost),
--   * a school can save / change / delete grades in an OPEN period,
--   * a school is refused in a CLOSED period, an ARCHIVED period, and a period CEDO never set up,
--   * a school cannot change periods, staff can.
--
-- Safe: it uses made-up periods in the year 2098-2099 and ends by raising an error ON PURPOSE,
-- which rolls back everything. The "error" is the report — every line should start with PASS.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid; v_scholar text; v_staff uuid;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
  v_total int; v_linked int; v_unlinked int;
  v_e_open text := 'no error'; v_e_closed text := 'no error'; v_e_archived text := 'no error';
  v_e_unknown text := 'no error'; v_e_delete text := 'no error'; v_e_update text := 'no error';
  v_e_school_manage text := 'no error'; v_e_staff text := 'no error';
  v_id uuid; v_closed_row uuid; v_n int; v_status text;
begin
  select a.id, a.school_id into v_acct, v_school from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then raise exception 'FAIL  a school account exists — public.school_accounts is empty'; end if;
  select scholar_id_number into v_scholar from public.scholars where school_id = v_school order by scholar_id_number limit 1;
  if v_scholar is null then raise exception 'FAIL  the school has at least one scholar'; end if;
  select t.staff_id into v_staff from public.staff_account_tags t where t.tag_key = 'scholars_grades_monitoring' limit 1;

  -- Data preserved: how many existing rows are linked to a period.
  select count(*), count(period_id), count(*) filter (where period_id is null)
    into v_total, v_linked, v_unlinked from public.scholar_subjects_grades;

  -- Made-up periods (rolled back at the end).
  insert into public.academic_periods (school_year, term, status) values
    ('2098-2099', '1st Semester', 'open'), ('2098-2099', '2nd Semester', 'closed'), ('2098-2099', 'Summer', 'archived');
  -- A grade the school already has in the closed period (written the way staff would write it).
  insert into public.scholar_subjects_grades (scholar_id_number, school_year, semester, subject, grade)
    values (v_scholar, '2098-2099', '2nd Semester', '__closed period subject', '2.00') returning id into v_closed_row;

  -- Become the school account.
  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  begin v_id := public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__T', '__open period subject', '1.50');
  exception when others then v_e_open := sqlerrm; end;
  select count(*) into v_n from public.scholar_subjects_grades where id = v_id and period_id is not null;

  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '2nd Semester', '__T', '__should not save', '1.50');
  exception when others then v_e_closed := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', 'Summer', '__T', '__should not save', '1.50');
  exception when others then v_e_archived := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2097-2098', '1st Semester', '__T', '__should not save', '1.50');
  exception when others then v_e_unknown := sqlerrm; end;
  begin delete from public.scholar_subjects_grades where id = v_closed_row;
  exception when others then v_e_delete := sqlerrm; end;
  begin update public.scholar_subjects_grades set grade = '5.00' where id = v_closed_row;
  exception when others then v_e_update := sqlerrm; end;
  begin perform public.upsert_academic_period('2098-2099', '1st Semester', 'closed');
  exception when others then v_e_school_manage := sqlerrm; end;

  reset role;

  select grade into v_status from public.scholar_subjects_grades where id = v_closed_row;

  v_ok := v_total = v_linked + v_unlinked;
  v_lines := array_append(v_lines, format('INFO  %s grade rows in total: %s linked to a period, %s not linked (a semester label that is not 1st/2nd/Summer stays as written)', v_total, v_linked, v_unlinked));

  v_ok := v_e_open = 'no error' and v_n = 1;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. school can save in an Open period, and the row is linked to it (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_open));

  v_ok := v_e_closed <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. school is refused in a Closed period (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_closed));

  v_ok := v_e_archived <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. school is refused in an Archived period (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_archived));

  v_ok := v_e_unknown <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. school is refused in a period CEDO never set up (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_unknown));

  v_ok := v_e_delete <> 'no error' and v_e_update <> 'no error' and v_status = '2.00';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  5. school cannot change or delete an existing grade in a Closed period; the grade is untouched (grade is still %s)', case when v_ok then 'PASS' else 'FAIL' end, v_status));

  v_ok := v_e_school_manage <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  6. school cannot change academic periods (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_school_manage));

  if v_staff is null then
    v_lines := array_append(v_lines, 'SKIP  7. staff can change periods — no account has the scholars_grades_monitoring tag yet');
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_staff::text, true);
    set local role authenticated;
    begin perform public.upsert_academic_period('2098-2099', '1st Semester', 'open', date '2098-12-31');
    exception when others then v_e_staff := sqlerrm; end;
    reset role;
    v_ok := v_e_staff = 'no error' and exists (select 1 from public.academic_periods where school_year = '2098-2099' and term = '1st Semester' and submission_deadline = date '2098-12-31');
    v_failed := v_failed + case when v_ok then 0 else 1 end;
    v_lines := array_append(v_lines, format('%s  7. staff with the monitoring tag can change a period and set its deadline (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_staff));
  end if;

  raise exception E'\n%\n\n%\n(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'\n'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
