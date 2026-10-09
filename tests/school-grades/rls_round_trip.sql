-- ─────────────────────────────────────────────────────────────
-- tests/school-grades/rls_round_trip.sql
--
-- Run in the Supabase SQL Editor (as the default `postgres` user). It acts as the
-- first school account in public.school_accounts, using the REAL live policies, and
-- checks that a school can read back exactly what it saves — and only its own scholars.
--
-- Safe: it ends by raising an error ON PURPOSE, which rolls back everything it did
-- (its only write is a throwaway test subject). The "error" is the report — read it:
-- every line should start with PASS. If you see "ALL CHECKS PASSED", you are done.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid;
  v_scholar text; v_other_scholar text;
  v_year text; v_sem text;
  v_id uuid;
  v_n int; v_n2 int; v_grade text;
  v_err_rpc text := 'no error'; v_err_insert text := 'no error';
  v_other_visible int; v_foreign_grades int;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
begin
  select a.id, a.school_id into v_acct, v_school from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then
    raise exception 'FAIL  a school account exists — public.school_accounts is empty';
  end if;
  select scholar_id_number into v_scholar from public.scholars where school_id = v_school order by scholar_id_number limit 1;
  select scholar_id_number into v_other_scholar from public.scholars where school_id is not null and school_id <> v_school order by scholar_id_number limit 1;
  select current_school_year, current_semester into v_year, v_sem from public.grading_period_settings where id = true;
  if v_scholar is null then
    raise exception 'FAIL  the school has at least one scholar — none linked to school %', v_school;
  end if;

  -- Become the school account (same effect as being signed in as it).
  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  -- 1. Save a grade the way the portal does, then read it back with a plain SELECT (what the screen does).
  v_id := public.upsert_scholar_subject_grade(null, v_scholar, v_year, v_sem, '__TEST', '__RLS round-trip test subject', '1.75');
  select count(*), max(grade) into v_n, v_grade
    from public.scholar_subjects_grades g
    where g.id = v_id and g.scholar_id_number = v_scholar and g.school_year = v_year and g.semester = v_sem;

  -- 2. Another school's scholar: the RPC must refuse.
  if v_other_scholar is not null then
    begin
      perform public.upsert_scholar_subject_grade(null, v_other_scholar, v_year, v_sem, '__TEST', '__should not save', '1.00');
    exception when others then v_err_rpc := sqlerrm;
    end;
    -- 3. ...and a direct INSERT for that scholar must be refused by row-level security.
    begin
      insert into public.scholar_subjects_grades (scholar_id_number, school_year, semester, subject, grade)
      values (v_other_scholar, v_year, v_sem, '__should not save', '1.00');
    exception when others then v_err_insert := sqlerrm;
    end;
  end if;

  -- 4. The school must not be able to see any other school's scholars or their grades.
  select count(*) into v_other_visible from public.scholars where school_id is distinct from v_school;
  select count(*) into v_foreign_grades from public.scholar_subjects_grades g
    where g.scholar_id_number not in (select s.scholar_id_number from public.scholars s where s.school_id = v_school);

  -- 5. The school can delete its own test row (what the trash button + Save does).
  with d as (delete from public.scholar_subjects_grades where id = v_id returning 1) select count(*) into v_n2 from d;

  reset role;

  v_ok := v_n = 1 and v_grade = '1.75';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. saved grade is readable by the same school (rows found=%s, grade=%s, period=%s %s)', case when v_ok then 'PASS' else 'FAIL' end, v_n, v_grade, v_sem, v_year));

  v_ok := v_other_scholar is null or v_err_rpc <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. saving for another school''s scholar is refused by the RPC (%s)', case when v_ok then 'PASS' else 'FAIL' end, case when v_other_scholar is null then 'no other school has scholars to test with' else v_err_rpc end));

  v_ok := v_other_scholar is null or v_err_insert <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. direct insert for another school''s scholar is refused by row-level security (%s)', case when v_ok then 'PASS' else 'FAIL' end, case when v_other_scholar is null then 'skipped' else v_err_insert end));

  v_ok := v_other_visible = 0;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. school sees none of another school''s scholars (visible=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_other_visible));

  v_ok := v_foreign_grades = 0;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  5. school sees no grade rows of scholars outside its own school (visible=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_foreign_grades));

  v_ok := v_n2 = 1;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  6. school can delete its own test row — removed subjects really go away (deleted=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_n2));

  raise exception E'
%

%
(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'
'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
