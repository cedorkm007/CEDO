-- ─────────────────────────────────────────────────────────────
-- tests/renewal/phase1_guard.sql
--
-- Scholar Renewal System, PHASE 1 check — run in the Supabase SQL Editor AFTER supabase_migration_renewal_p1_foundations.sql.
-- It acts as the first school account, with the REAL live rules, and checks that:
--   * a school can save a passing mark on its own scale, and not one outside it,
--   * a school can enter INC and DRP (and a remark) for its own scholar, and other unknown marks are still refused,
--   * the database's pass / fail / INC / DRP rule (_grade_outcome) agrees with the school's saved scale,
--   * changing a scholar's status writes a history row,
--   * the SDP Complied / Not complied check returns a result, and Summer has no requirement.
--
-- Needs the first school account to have saved its grading scale and to have at least one scholar. Safe: it uses a made-up Open
-- period (2098-2099) and ends by raising an error ON PURPOSE, which rolls everything back. The "error" is the report — every line
-- should start with PASS.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid; v_scholar text;
  v_cfg public.school_grading_configs%rowtype;
  v_best text; v_worst text; v_mid numeric;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
  v_e_ok text := 'no error'; v_e_out text := 'no error'; v_e_inc text := 'no error'; v_e_drp text := 'no error'; v_e_junk text := 'no error'; v_e_rem text := 'no error';
  v_mark numeric;
  v_o_best text; v_o_worst text; v_o_inc text; v_o_drp text; v_o_blank text;
  v_remark text; v_inc_stored text;
  v_hist_before int; v_hist_after int; v_hist_status text; v_old_status text;
  v_sdp record; v_sdp_summer record; v_sdp_error text := 'no error';
begin
  select a.id, a.school_id into v_acct, v_school from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then raise exception 'FAIL  a school account exists — public.school_accounts is empty'; end if;
  select * into v_cfg from public.school_grading_configs where school_id = v_school;
  if not found then raise exception 'FAIL  this school has not set up its grading scale yet — save it in the School Portal > Grading System tab, then run this again'; end if;
  select scholar_id_number, status into v_scholar, v_old_status from public.scholars where school_id = v_school and status <> 'Removed' order by scholar_id_number limit 1;
  if v_scholar is null then raise exception 'FAIL  the school has at least one scholar'; end if;

  -- A passing mark halfway through the scale, and the best / worst grade on it.
  v_mid := round((v_cfg.scale_min + (v_cfg.scale_max - v_cfg.scale_min) / 2)::numeric, 2);
  v_best  := case when v_cfg.direction = 'lower_is_better' then v_cfg.scale_min::float8::text else v_cfg.scale_max::float8::text end;
  v_worst := case when v_cfg.direction = 'lower_is_better' then v_cfg.scale_max::float8::text else v_cfg.scale_min::float8::text end;

  insert into public.academic_periods (school_year, term, status) values ('2098-2099', '1st Semester', 'open') on conflict (school_year, term) do update set status = 'open';

  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  begin
    perform public.upsert_school_grading_config(v_cfg.scale_min, v_cfg.scale_max, v_cfg.direction, v_cfg.uses_letter_grades, v_cfg.retention_threshold, v_mid);
  exception when others then v_e_ok := sqlerrm; end;
  begin
    perform public.upsert_school_grading_config(v_cfg.scale_min, v_cfg.scale_max, v_cfg.direction, v_cfg.uses_letter_grades, v_cfg.retention_threshold, v_cfg.scale_max + 1000);
  exception when others then v_e_out := sqlerrm; end;
  select passing_mark into v_mark from public.school_grading_configs where school_id = v_school;

  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', 'T1', '__guard INC', 'INC', 3, false, 'Test remark'); exception when others then v_e_inc := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', 'T2', '__guard DRP', 'drp', 3, false, null); exception when others then v_e_drp := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', 'T3', '__guard junk', 'XYZ', 3, false, null); exception when others then v_e_junk := sqlerrm; end;
  begin perform public.upsert_scholar_subject_grade(null, v_scholar, '2098-2099', '1st Semester', 'T4', '__guard remark', v_best, 3, false, '  NSTP  '); exception when others then v_e_rem := sqlerrm; end;
  select remarks into v_remark from public.scholar_subjects_grades where scholar_id_number = v_scholar and subject = '__guard remark';
  select grade into v_inc_stored from public.scholar_subjects_grades where scholar_id_number = v_scholar and subject = '__guard DRP';

  reset role;
  -- The rule, asked directly (it is an internal function).
  v_o_best  := public._grade_outcome(v_school, v_best);
  v_o_worst := public._grade_outcome(v_school, v_worst);
  v_o_inc   := public._grade_outcome(v_school, 'inc');
  v_o_drp   := public._grade_outcome(v_school, 'DRP');
  v_o_blank := public._grade_outcome(v_school, '');

  -- Status history: a status change is recorded.
  select count(*) into v_hist_before from public.scholar_status_history where scholar_id_number = v_scholar;
  update public.scholars set status = case when v_old_status = 'Probationary' then 'Regular' else 'Probationary' end where scholar_id_number = v_scholar;
  select count(*), max(status) into v_hist_after, v_hist_status from public.scholar_status_history where scholar_id_number = v_scholar;

  -- SDP compliance (internal function, asked directly).
  select * into v_sdp from public._sdp_compliance('2098-2099', '1st Semester', v_scholar);
  select * into v_sdp_summer from public._sdp_compliance('2098-2099', 'Summer', v_scholar);

  v_ok := v_e_ok = 'no error' and v_mark = v_mid;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. the school can save a passing mark on its own scale (%s; saved %s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_ok, v_mark));

  v_ok := v_e_out <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. a passing mark outside its scale is refused (%s)', case when v_ok then 'PASS' else 'FAIL' end, left(v_e_out, 90)));

  v_ok := v_e_inc = 'no error' and v_e_drp = 'no error' and v_inc_stored = 'drp';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. the school can enter INC and DRP (INC: %s; DRP: %s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_inc, v_e_drp));

  v_ok := v_e_junk <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. another unknown mark is still refused (%s)', case when v_ok then 'PASS' else 'FAIL' end, left(v_e_junk, 80)));

  v_ok := v_e_rem = 'no error' and v_remark = 'NSTP';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  5. a remark is saved with a subject, trimmed (%s; stored "%s")', case when v_ok then 'PASS' else 'FAIL' end, v_e_rem, v_remark));

  v_ok := v_o_best = 'passed' and v_o_worst = 'failed' and v_o_inc = 'inc' and v_o_drp = 'drp' and v_o_blank = 'ungraded';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  6. the pass/fail rule agrees with the school''s scale: best %s = %s, worst %s = %s, INC = %s, DRP = %s, blank = %s', case when v_ok then 'PASS' else 'FAIL' end, v_best, v_o_best, v_worst, v_o_worst, v_o_inc, v_o_drp, v_o_blank));

  v_ok := v_hist_after = v_hist_before + 1;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  7. changing a scholar''s status writes a history row (%s -> %s rows; now "%s")', case when v_ok then 'PASS' else 'FAIL' end, v_hist_before, v_hist_after, v_hist_status));

  v_ok := v_sdp.scholar_id_number is not null and v_sdp.applicable and v_sdp.complied is not null;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  8. SDP Complied / Not complied gives a result for a 1st Semester (complied: %s; %s)', case when v_ok then 'PASS' else 'FAIL' end, v_sdp.complied, coalesce(v_sdp.missing, 'nothing missing')));

  v_ok := v_sdp_summer.applicable = false and v_sdp_summer.complied is null;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  9. Summer has no SDP requirement (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_sdp_summer.missing));

  raise exception E'\n%\n\n%\n(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'\n'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
