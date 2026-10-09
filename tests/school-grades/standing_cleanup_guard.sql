-- ─────────────────────────────────────────────────────────────
-- tests/school-grades/standing_cleanup_guard.sql
--
-- Phase 7 check — run in the Supabase SQL Editor AFTER supabase_migration_standing_cleanup_logins.sql.
-- It acts as the first school account, as an anonymous visitor (the sign-in page), and — if they exist — as a staff account
-- tagged scholars_grades_monitoring and as the IT administrator, with the REAL live rules, and checks that:
--   * a school can save a retention requirement on its own scale, and not one outside it,
--   * a school sees only its own scholars, and cannot merge schools, assign schools, standardize names or set usernames,
--   * a scholar's written school name and school link stay in step (the official spelling is written),
--   * sign-in resolves a username or an email — never a school name,
--   * "Forgot password" reveals nothing about which accounts exist and keeps one open request per account,
--   * CEDO can merge two schools: scholars move, the old name becomes an alias, the duplicate is removed,
--   * the staff scholar list pages with an exact total count, and filters by school.
--
-- Needs the first school account to have saved its grading scale. Safe: it makes two made-up "__Test" schools and ends by
-- raising an error ON PURPOSE, which rolls everything back. The "error" is the report — every line should start with PASS.
-- ─────────────────────────────────────────────────────────────
do $test$
declare
  v_acct uuid; v_school uuid; v_email text; v_username text; v_staff uuid; v_it uuid;
  v_cfg public.school_grading_configs%rowtype;
  v_scholar text; v_official text;
  v_keep uuid; v_dupe uuid;
  v_lines text[] := '{}';
  v_failed int := 0;
  v_ok boolean;
  v_e_ok text := 'no error'; v_e_out text := 'no error';
  v_e_merge text := 'no error'; v_e_assign text := 'no error'; v_e_std text := 'no error'; v_e_user text := 'no error';
  v_foreign int; v_own int;
  v_sync_school text; v_sync_id uuid;
  v_by_email text; v_by_name text; v_by_user text;
  v_total_before int; v_open_before int; v_total_after int; v_req_known int;
  v_total bigint; v_expected bigint; v_page int; v_filtered int; v_merge_err text := 'SKIP';
  v_moved_to uuid; v_moved_text text; v_alias int; v_dupe_left int;
  v_it_err text := 'SKIP'; v_it_found text;
  v_threshold numeric;
begin
  select a.id, a.school_id, a.email, a.username into v_acct, v_school, v_email, v_username from public.school_accounts a order by a.created_at limit 1;
  if v_acct is null then raise exception 'FAIL  a school account exists — public.school_accounts is empty'; end if;
  select * into v_cfg from public.school_grading_configs where school_id = v_school;
  if not found then raise exception 'FAIL  this school has not set up its grading scale yet — save it in the School Portal > Grading System tab, then run this again'; end if;
  select scholar_id_number into v_scholar from public.scholars where school_id = v_school and status <> 'Removed' order by scholar_id_number limit 1;
  if v_scholar is null then raise exception 'FAIL  the school has at least one scholar'; end if;
  select name into v_official from public.schools where id = v_school;
  select t.staff_id into v_staff from public.staff_account_tags t where t.tag_key = 'scholars_grades_monitoring' limit 1;
  select u.id into v_it from public.users u where u.username = 'it.admin1';
  v_threshold := round((v_cfg.scale_min + (v_cfg.scale_max - v_cfg.scale_min) / 2)::numeric, 2);

  -- Fixture (written the way staff would): two made-up schools, and the scholar's written school typed sloppily.
  insert into public.schools (name) values ('__Test Keep School') returning id into v_keep;
  insert into public.schools (name) values ('__Test Duplicate School') returning id into v_dupe;
  update public.scholars set school = upper(v_official) || '   ' where scholar_id_number = v_scholar;
  select school, school_id into v_sync_school, v_sync_id from public.scholars where scholar_id_number = v_scholar;

  -- ── the school's own account ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_acct, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acct::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  begin
    perform public.upsert_school_grading_config(v_cfg.scale_min, v_cfg.scale_max, v_cfg.direction, v_cfg.uses_letter_grades, v_threshold);
  exception when others then v_e_ok := sqlerrm; end;
  begin
    perform public.upsert_school_grading_config(v_cfg.scale_min, v_cfg.scale_max, v_cfg.direction, v_cfg.uses_letter_grades, v_cfg.scale_max + 1000);
  exception when others then v_e_out := sqlerrm; end;
  select retention_threshold into v_threshold from public.school_grading_configs where school_id = v_school;

  select count(*) into v_foreign from public.scholars where school_id is distinct from v_school;
  select count(*) into v_own from public.scholars where school_id = v_school;

  begin perform public.merge_schools(v_keep, array[v_dupe]); exception when others then v_e_merge := sqlerrm; end;
  begin perform public.assign_scholars_school(array[v_scholar], v_keep); exception when others then v_e_assign := sqlerrm; end;
  begin perform public.standardize_scholar_school_names(); exception when others then v_e_std := sqlerrm; end;
  begin perform public.set_school_username(v_acct, 'zz.hijack'); exception when others then v_e_user := sqlerrm; end;

  -- ── a visitor on the sign-in page (not signed in) ──
  reset role;
  select count(*) into v_total_before from public.school_password_reset_requests;
  select count(*) into v_open_before from public.school_password_reset_requests where account_id = v_acct and handled_at is null;
  set local role anon;
  select public.resolve_school_login_email(v_email) into v_by_email;
  select public.resolve_school_login_email(v_official) into v_by_name;
  if v_username is not null then select public.resolve_school_login_email(upper(v_username)) into v_by_user; else v_by_user := v_email; end if;
  perform public.request_school_password_reset('no.such.school.account');
  perform public.request_school_password_reset(v_email);
  perform public.request_school_password_reset(v_email);
  reset role;
  select count(*) into v_total_after from public.school_password_reset_requests;
  select count(*) into v_req_known from public.school_password_reset_requests where account_id = v_acct and handled_at is null;

  -- ── CEDO staff ──
  if v_staff is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_staff::text, true);
    select count(*) into v_expected from public.scholars where status <> 'Removed';
    update public.scholars set school_id = v_dupe where scholar_id_number = v_scholar;
    set local role authenticated;
    select max(total_count), count(*) into v_total, v_page from public.scholars_grades_monitoring_scholars_page(null, null, null, null, 5, 0);
    select count(*) into v_filtered from public.scholars_grades_monitoring_scholars_page(null, v_school, null, null, 500, 0) where school_id is distinct from v_school;

    begin perform public.merge_schools(v_keep, array[v_dupe]); v_merge_err := 'no error'; exception when others then v_merge_err := sqlerrm; end;
    reset role;
    select school_id, school into v_moved_to, v_moved_text from public.scholars where scholar_id_number = v_scholar;
    select count(*) into v_alias from public.school_aliases where school_id = v_keep and alias = '__Test Duplicate School';
    select count(*) into v_dupe_left from public.schools where id = v_dupe;
  end if;

  -- ── the IT administrator ──
  if v_it is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_it, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_it::text, true);
    set local role authenticated;
    begin perform public.set_school_username(v_acct, 'zz.phase7.test'); v_it_err := 'no error'; exception when others then v_it_err := sqlerrm; end;
    reset role;
    set local role anon;
    select public.resolve_school_login_email('ZZ.Phase7.Test') into v_it_found;
    reset role;
  end if;

  v_ok := v_e_ok = 'no error' and v_threshold = round((v_cfg.scale_min + (v_cfg.scale_max - v_cfg.scale_min) / 2)::numeric, 2);
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  1. the school can save a retention requirement on its own scale (%s; saved %s)', case when v_ok then 'PASS' else 'FAIL' end, v_e_ok, v_threshold));

  v_ok := v_e_out <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  2. a requirement outside its scale is refused (%s)', case when v_ok then 'PASS' else 'FAIL' end, left(v_e_out, 90)));

  v_ok := v_foreign = 0 and v_own >= 1;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  3. the school sees only its own scholars (own: %s, other schools'' or unlinked: %s)', case when v_ok then 'PASS' else 'FAIL' end, v_own, v_foreign));

  v_ok := v_e_merge <> 'no error' and v_e_assign <> 'no error' and v_e_std <> 'no error' and v_e_user <> 'no error';
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  4. a school cannot merge schools, assign schools, standardize names or set usernames', case when v_ok then 'PASS' else 'FAIL' end));

  v_ok := v_sync_school = v_official and v_sync_id = v_school;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  5. a sloppily typed school name is saved as the official name, and the link is kept ("%s")', case when v_ok then 'PASS' else 'FAIL' end, v_sync_school));

  v_ok := v_by_email = v_email and v_by_name is null and v_by_user = v_email;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  6. sign-in finds an account by email or username, and the school NAME finds nothing', case when v_ok then 'PASS' else 'FAIL' end));

  v_ok := v_req_known = 1 and v_total_after - v_total_before = case when v_open_before = 0 then 1 else 0 end;
  v_failed := v_failed + case when v_ok then 0 else 1 end;
  v_lines := array_append(v_lines, format('%s  7. "Forgot password" records one open request per account and nothing for an unknown login', case when v_ok then 'PASS' else 'FAIL' end));

  if v_staff is null then
    v_lines := array_append(v_lines, 'SKIP  8-9. no staff account is tagged scholars_grades_monitoring, so the staff list and merge were not tested');
  else
    v_ok := v_total = v_expected and v_page = least(5, v_expected) and v_filtered = 0;
    v_failed := v_failed + case when v_ok then 0 else 1 end;
    v_lines := array_append(v_lines, format('%s  8. the staff list pages with an exact total (%s of %s), and the school filter returns only that school', case when v_ok then 'PASS' else 'FAIL' end, v_total, v_expected));

    v_ok := v_merge_err = 'no error' and v_moved_to = v_keep and v_moved_text = '__Test Keep School' and v_alias = 1 and v_dupe_left = 0;
    v_failed := v_failed + case when v_ok then 0 else 1 end;
    v_lines := array_append(v_lines, format('%s  9. CEDO can merge schools: scholar moved (%s), old name kept as an alias (%s), duplicate removed (%s) [%s]', case when v_ok then 'PASS' else 'FAIL' end, coalesce(v_moved_text, '?'), v_alias, 1 - v_dupe_left, v_merge_err));
  end if;

  if v_it is null then
    v_lines := array_append(v_lines, 'SKIP  10. no IT administrator account (username it.admin1), so setting a username was not tested');
  else
    v_ok := v_it_err = 'no error' and v_it_found = v_email;
    v_failed := v_failed + case when v_ok then 0 else 1 end;
    v_lines := array_append(v_lines, format('%s  10. the IT administrator can set a username, and the school can then sign in with it (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_it_err));
  end if;

  raise exception E'\n%\n\n%\n(This message is the report. The test rolled itself back on purpose; nothing was saved.)',
    array_to_string(v_lines, E'\n'),
    case when v_failed = 0 then 'ALL CHECKS PASSED' else format('%s CHECK(S) FAILED', v_failed) end;
end
$test$;
