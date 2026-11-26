-- restore_survey_sdp_credits.sql
-- ADDS the SDP credits lost to the survey bug: exactly the "WILL RESTORE" lines of check_survey_sdp_credit_readonly.sql.
-- RUN THE CHECK FIRST and look at the list. Safe to run twice (a credit that exists is never added again).
-- Undo: undo_restore_survey_sdp_credits.sql
--   * Each credit is placed in the semester shown by the check, dated the day of the scan.
--   * The credit history shows "Restored – survey credit bug".
--   * Each scholar gets one notification per activity: "Your SDP credit for ___ has been added".
--   * Renewal applications are re-checked by the system when credits are added, as with any new credit.
begin;

do $restore$
declare
  p record; v_run timestamptz := now(); v_occurrence integer; v_new uuid; v_category text; v_credits integer;
begin
  if to_regprocedure('public._survey_restore_plan()') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_survey_credit_fix.sql first.';
  end if;
  perform set_config('app.sdp_source', 'restore_survey_bug', true);

  create temporary table restore_plan on commit drop as
    select * from public._survey_restore_plan() where action = 'WILL RESTORE';

  for p in select * from restore_plan order by scholar_id_number, activity_id, scanned_at loop
    select a.category, a.credits into v_category, v_credits from public.sdp_activities a where a.id = p.activity_id;
    if public._sdp_period_credits(p.scholar_id_number, v_category, p.school_year, p.semester) >= public.sdp_category_credit_goal() then
      -- category already full: saved for a later semester, the same as a normal scan (one line for each attendance)
      continue when exists (select 1 from public.survey_credit_restore_log l where l.run_at = v_run and l.scholar_id_number = p.scholar_id_number and l.session_id = p.session_id and l.action = 'saved');
      insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
      values (p.scholar_id_number, v_category, coalesce(v_credits, 1), p.school_year, p.semester) returning id into v_new;
      insert into public.survey_credit_restore_log (run_at, scholar_id_number, activity_id, activity_name, session_id, action, reserved_credit_id, attended_date, school_year, semester, response_id)
      values (v_run, p.scholar_id_number, p.activity_id, p.activity_name, p.session_id, 'saved', v_new, p.scan_date, p.school_year, p.semester, p.response_id);
    else
      select coalesce(max(c.occurrence_number), 0) + 1 into v_occurrence from public.sdp_attendance c where c.activity_id = p.activity_id and c.scholar_id_number = p.scholar_id_number;
      v_new := null;
      insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day, activity_sid)
      values (p.activity_id, p.scholar_id_number, p.scan_date, null, v_occurrence, p.school_year, p.semester, p.activity_day, p.activity_sid)
      on conflict (activity_id, scholar_id_number, occurrence_number) do nothing returning id into v_new;
      if v_new is not null then
        insert into public.survey_credit_restore_log (run_at, scholar_id_number, activity_id, activity_name, session_id, action, sdp_attendance_id, attended_date, school_year, semester, response_id)
        values (v_run, p.scholar_id_number, p.activity_id, p.activity_name, p.session_id, 'credit', v_new, p.scan_date, p.school_year, p.semester, p.response_id);
      end if;
    end if;
  end loop;

  for p in
    select l.scholar_id_number, l.activity_name, bool_and(l.action = 'saved') as only_saved
    from public.survey_credit_restore_log l where l.run_at = v_run group by l.scholar_id_number, l.activity_id, l.activity_name
  loop
    perform public._notify_scholar(p.scholar_id_number, 'sdp_credit_restored',
      case when p.only_saved then 'Your SDP credit for ' || coalesce(p.activity_name, 'an activity') || ' has been saved for a later semester'
           else 'Your SDP credit for ' || coalesce(p.activity_name, 'an activity') || ' has been added' end,
      'It was missing after you finished the activity survey. There is nothing you need to do.');
  end loop;
  perform set_config('app.sdp_source', '', true);
end
$restore$;

commit;

-- What has been restored (this run and any earlier one):
select scholar_id_number, activity_name, case action when 'credit' then 'credit added' else 'saved for later' end as result, attended_date, school_year, semester, run_at
from public.survey_credit_restore_log where undone_at is null order by run_at desc, activity_name, scholar_id_number;
