-- ─────────────────────────────────────────────────────────────
-- tests/school-grades/gwa_units_guard.sql
--
-- Phase 4 check — run in the Supabase SQL Editor AFTER supabase_migration_gwa_units_exclude.sql.
-- It acts as the first school account, with the REAL live rules, and checks that:
--   * every existing subject still counts toward the GWA (nothing is excluded by default),
--   * a subject can be saved with units and marked "Exclude from GWA", and the school reads both back,
--   * saving again without the flag keeps it (and the units),
--   * a CSV-style bulk save (which never sends the flag) cannot change the flag of an existing subject.
--
-- The GWA arithmetic itself is tested by `node tests/school-grades/run.mjs` (it lives in src/lib/gwa.ts).
-- Needs the school to have saved its grading scale. Safe: uses a made-up Open period (2098-2099) and ends by
-- raising an error ON PURPOSE, which rolls everything back. The "error" is the report — every line should start with PASS.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid; v_scholar text;
  v_cfg public.school_grading_configs%rowtype;
  v_in text;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
  v_excluded_existing int;
  v_id uuid; v_units numeric; v_flag boolean;
  v_units2 numeric; v_flag2 boolean;
  v_flag3 boolean; v_bulk_ok boolean;
  v_err text := 'no error';
begin
  select a.id, a.school_id into v_acct, v_school from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then raise exception 'FAIL  a school account exists — public.school_accounts is empty'; end if;
  select * into v_cfg from public.school_grading_configs where school_id = v_school;
  if not found then raise exception 'FAIL  this school has not set up its grading scale yet — open the School Portal > Grading System tab and save it, then run this again'; end if;
  select scholar_id_number into v_scholar from public.scholars where school_id = v_school order by scholar_id_number limit 1;
  if v_scholar is null then raise exception 'FAIL  the school has at least one scholar'; end if;
  v_in := v_cfg.scale_min::float8::text;

  select count(*) into v_excluded_existing from public.scholar_subjects_grades where exclude_from_gwa;

  insert into public.academic_periods (school_year, term, status) values ('2098-2099', '1st Semester', 'open');

  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  begin
    v_id := public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__NSTP', '__NSTP test', v_in, 3, true);
  exception when others then v_err := sqlerrm; end;
  select units, exclude_from_gwa into v_units, v_flag from public.scholar_subjects_grades where id = v_id;

  -- save again without sending the flag
  perform public.upsert_scholar_subject_grade(v_id, v_scholar, '2098-2099', '1st Semester', '__NSTP', '__NSTP test', v_in);
  select units, exclude_from_gwa into v_units2, v_flag2 from public.scholar_subjects_grades where id = v_id;

  -- a CSV-style bulk save (no flag in the row) over the same subject
  select bool_and(ok) into v_bulk_ok from public.bulk_upsert_scholar_subject_grades(jsonb_build_array(
    jsonb_build_object('id', v_id, 'scholarIdNumber', v_scholar, 'schoolYear', '2098-2099', 'semester', '1st Semester', 'subjectCode', '__NSTP', 'subject', '__NSTP test', 'grade', v_in, 'units', 3)
  ));
  select exclude_from_gwa into v_flag3 from public.scholar_subjects_grades where id = v_id;

  reset role;

  v_ok := v_excluded_existing = 0;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. every existing subject still counts toward the GWA (excluded right now: %s — expected 0 before anyone uses the checkbox)', case when v_ok then 'PASS' else 'INFO' end, v_excluded_existing));
  if not v_ok then v_failed := v_failed - 1; end if; -- informational once the checkbox is in use

  v_ok := v_err = 'no error' and v_units = 3 and v_flag = true;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. a subject saves with units=%s and "Exclude from GWA"=%s, and the school reads both back (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_units, v_flag, v_err));

  v_ok := v_units2 = 3 and v_flag2 = true;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. saving again without the flag keeps the flag and the units (units=%s, excluded=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_units2, v_flag2));

  v_ok := v_bulk_ok and v_flag3 = true;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. a CSV-style bulk save cannot change the flag of an existing subject (excluded=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_flag3));

  raise exception E'\n%\n\n%\n(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'\n'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
