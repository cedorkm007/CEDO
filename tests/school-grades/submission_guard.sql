-- ─────────────────────────────────────────────────────────────
-- tests/school-grades/submission_guard.sql
--
-- Phase 6 check — run in the Supabase SQL Editor AFTER supabase_migration_submission_audit_documents.sql.
-- It acts as the first school account (and, if one exists, a staff account tagged scholars_grades_monitoring),
-- with the REAL live rules, and checks that:
--   * a school can submit a period once every scholar is complete, and not before,
--   * after submitting, the school cannot add, change or delete grades,
--   * a correction request unlocks ONE grade once CEDO approves it, then it locks again,
--   * every change is written to the audit trail (who / how / old / new),
--   * a school can attach a PDF document for its own scholar, and not for another school's folder.
--
-- Needs the school to have saved its grading scale. Safe: it uses a made-up Open period (2098-2099) and ends by
-- raising an error ON PURPOSE, which rolls everything back. The "error" is the report — every line should start with PASS.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid; v_staff uuid;
  v_scholar text; v_period uuid; v_grade_id uuid; v_req uuid;
  v_cfg public.school_grading_configs%rowtype;
  v_in text;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
  v_e_early text := 'no error'; v_e_submit text := 'no error';
  v_e_add text := 'no error'; v_e_change text := 'no error'; v_e_delete text := 'no error';
  v_e_req text := 'no error'; v_e_fix text := 'no error'; v_e_fix2 text := 'no error';
  v_e_doc text := 'no error'; v_e_doc_bad text := 'no error';
  v_status text; v_grade_after text; v_audit_n int; v_audit_corr int; v_staff_reviewed text := 'SKIP';
  v_other_school uuid;
begin
  select a.id, a.school_id into v_acct, v_school from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then raise exception 'FAIL  a school account exists — public.school_accounts is empty'; end if;
  select * into v_cfg from public.school_grading_configs where school_id = v_school;
  if not found then raise exception 'FAIL  this school has not set up its grading scale yet — save it in the School Portal > Grading System tab, then run this again'; end if;
  select scholar_id_number into v_scholar from public.scholars where school_id = v_school and status <> 'Removed' order by scholar_id_number limit 1;
  if v_scholar is null then raise exception 'FAIL  the school has at least one scholar'; end if;
  select t.staff_id into v_staff from public.staff_account_tags t where t.tag_key = 'scholars_grades_monitoring' limit 1;
  select id into v_other_school from public.schools where id <> v_school limit 1;
  v_in := v_cfg.scale_min::float8::text;

  insert into public.academic_periods (school_year, term, status) values ('2098-2099', '1st Semester', 'open') returning id into v_period;

  -- Fixture (written the way staff would): every scholar of the school has one graded subject, EXCEPT the first one,
  -- who starts with a subject that has no grade — so the "not complete yet" refusal can be tested.
  insert into public.scholar_subjects_grades (scholar_id_number, school_year, semester, subject, grade)
  select s.scholar_id_number, '2098-2099', '1st Semester', '__fixture subject', case when s.scholar_id_number = v_scholar then '' else v_in end
  from public.scholars s where s.school_id = v_school and s.status <> 'Removed';
  select id into v_grade_id from public.scholar_subjects_grades where scholar_id_number = v_scholar and subject = '__fixture subject' and school_year = '2098-2099';

  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  begin perform public.submit_school_period(v_period); exception when others then v_e_early := sqlerrm; end;
  -- complete the scholar, then submit
  update public.scholar_subjects_grades set grade = v_in where id = v_grade_id;
  begin perform public.submit_school_period(v_period); exception when others then v_e_submit := sqlerrm; end;

  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', '__B', '__late subject', v_in);
  exception when others then v_e_add := sqlerrm; end;
  begin update public.scholar_subjects_grades set grade = v_cfg.scale_max::float8::text where id = v_grade_id;
  exception when others then v_e_change := sqlerrm; end;
  begin delete from public.scholar_subjects_grades where id = v_grade_id;
  exception when others then v_e_delete := sqlerrm; end;

  begin v_req := public.request_grade_correction(v_grade_id, 'The official slip shows a different grade', v_cfg.scale_max::float8::text);
  exception when others then v_e_req := sqlerrm; end;

  -- documents (period is Open, even though submitted)
  begin
    insert into public.grade_documents (school_id, scholar_id_number, period_id, storage_path, file_name, mime_type, size_bytes)
    values (v_school, v_scholar, v_period, v_school::text || '/' || v_period::text || '/' || v_scholar || '/slip.pdf', 'slip.pdf', 'application/pdf', 1234);
  exception when others then v_e_doc := sqlerrm; end;
  begin
    insert into public.grade_documents (school_id, scholar_id_number, period_id, storage_path, file_name, mime_type, size_bytes)
    values (v_school, v_scholar, v_period, coalesce(v_other_school, gen_random_uuid())::text || '/' || v_period::text || '/' || v_scholar || '/slip.pdf', 'slip.pdf', 'application/pdf', 1234);
  exception when others then v_e_doc_bad := sqlerrm; end;

  reset role;

  -- Approve it: through the real review function when a tagged staff account exists, otherwise directly (and say so).
  if v_req is not null then
    if v_staff is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_staff::text, true);
      set local role authenticated;
      begin perform public.review_grade_correction(v_req, true, 'approved by test'); v_staff_reviewed := 'via review_grade_correction';
      exception when others then v_staff_reviewed := 'review failed: ' || sqlerrm; end;
      reset role;
    else
      update public.grade_correction_requests set status = 'approved' where id = v_req;
      v_staff_reviewed := 'SKIP (no staff account has the scholars_grades_monitoring tag yet; approved directly)';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_acct::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    begin update public.scholar_subjects_grades set grade = v_cfg.scale_max::float8::text where id = v_grade_id;
    exception when others then v_e_fix := sqlerrm; end;
    begin update public.scholar_subjects_grades set grade = v_in where id = v_grade_id;
    exception when others then v_e_fix2 := sqlerrm; end;
    reset role;
  end if;

  select status into v_status from public.school_period_submissions where school_id = v_school and period_id = v_period;
  select grade into v_grade_after from public.scholar_subjects_grades where id = v_grade_id;
  select count(*) into v_audit_n from public.scholar_grade_audit where scholar_id_number = v_scholar and school_year = '2098-2099' and actor_type = 'school';
  select count(*) into v_audit_corr from public.scholar_grade_audit where grade_id = v_grade_id and source = 'correction';

  v_ok := v_e_early <> 'no error' and v_e_early ~ 'not complete yet';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. submitting is refused while a scholar is not complete (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_early));

  v_ok := v_e_submit = 'no error' and v_status = 'submitted';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. once every scholar is complete the school can submit (%s; status=%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_submit, v_status));

  v_ok := v_e_add <> 'no error' and v_e_change <> 'no error' and v_e_delete <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. after submitting, adding, changing and deleting are all refused (%s)', case when v_ok then 'PASS' else 'FAIL' end, left(v_e_change, 90)));

  v_ok := v_e_req = 'no error' and v_req is not null;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. the school can send a correction request with a reason (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_req));

  v_ok := v_e_fix = 'no error' and v_e_fix2 <> 'no error' and v_grade_after = v_cfg.scale_max::float8::text;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  5. once approved, that one grade can change — once — then it locks again (approval: %s; second change: %s)', case when v_ok then 'PASS' else 'FAIL' end, v_staff_reviewed, left(v_e_fix2, 70)));

  v_ok := v_audit_n >= 1 and v_audit_corr = 1;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  6. the audit trail recorded the school''s changes (%s entries) and the correction (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_audit_n, v_audit_corr));

  v_ok := v_e_doc = 'no error' and v_e_doc_bad <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  7. a PDF can be attached for the school''s own scholar, but not into another school''s folder (%s)', case when v_ok then 'PASS' else 'FAIL' end, left(v_e_doc_bad, 80)));

  raise exception E'\n%\n\n%\n(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'\n'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
