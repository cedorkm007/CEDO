-- ─────────────────────────────────────────────────────────────
-- ENTERED GRADES — REVERT AN APPROVAL.   Safe to run twice.   Undo: undo_entered_grades_g.sql
-- Run AFTER supabase_migration_entered_grades_c_functions.sql.
--
-- The Grades Approver can already APPROVE or RETURN the grades a scholar entered. This adds one more action: REVERT the approval of grades that were approved by mistake.
-- The grades go back to "waiting for approval" (the same try, with the same subjects and screenshots), so the Grades Approver can check them again and approve or return them.
-- The renewal that was using them goes back to waiting for the Grades Approver at once.
--
--   * Only a Grades Approver can revert, and a reason is needed (the scholar and the evaluators are told it).
--   * Only an APPROVED try can be reverted, and only while the renewal is still at the grades step (it is refused once the case went on: endorsed, confirmed, returned, removed...).
--   * It is refused when the school has already uploaded its grades for that semester: those are the grades that count and the entered ones no longer matter.
--   * The renewal's history records it ("Approval of the entered grades was reverted").
--   * One new function. No table is changed, nothing is deleted.
-- ─────────────────────────────────────────────────────────────
do $$ begin
  if to_regprocedure('public.renewal_self_grades_decide(uuid,boolean,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_entered_grades_c_functions.sql first.';
  end if;
end $$;

create or replace function public.renewal_self_grades_revert(p_submission_id uuid, p_note text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.renewal_self_grade_submissions%rowtype;
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
  v_label text;
  v_term text;
  v_stage text;
  v_school uuid;
begin
  if not public.can_approve_scholar_grades() then raise exception 'Only a Grades Approver can revert the approval of entered grades.'; end if;
  select * into s from public.renewal_self_grade_submissions where id = p_submission_id for update;
  if not found then raise exception 'That submission was not found.'; end if;
  if s.status <> 'approved' then raise exception 'Only grades that were approved can be reverted.'; end if;
  if v_note = '' then raise exception 'Please write the reason for reverting the approval.'; end if;

  select stage into v_stage from public.renewal_records where id = s.record_id;
  if v_stage is null or not public._renewal_is_active_stage(v_stage) then
    raise exception 'This renewal has already moved past the grades step, so the approval cannot be reverted here. The evaluator has to return the application first.';
  end if;
  select sc.school_id into v_school from public.scholars sc where sc.scholar_id_number = s.scholar_id_number;
  if exists (select 1 from public.school_period_submissions sp join public.academic_periods ap on ap.id = sp.period_id
              where sp.school_id = v_school and ap.school_year = s.basis_school_year and ap.term = s.basis_term and sp.status = 'submitted') then
    raise exception 'The school has already uploaded its grades for this semester: those are the grades that count, so there is nothing to revert.';
  end if;

  v_label := public._actor_name();
  v_term := public._renewal_term_label(s.basis_school_year, s.basis_term);
  update public.renewal_self_grade_submissions
     set status = 'pending', decided_by = null, decided_by_label = null, decided_at = null, decision_note = ''
   where id = s.id;
  perform public._notify_scholar(s.scholar_id_number, 'grades_entry_reverted', 'The approval of your entered grades was taken back',
    'The Grades Approver took back the approval of the grades you entered for ' || v_term || '. They are being checked again, and your renewal waits until then. Reason: ' || v_note, s.record_id);
  perform public._eg_notify_approvers('Approval of entered grades reverted', public._renewal_scholar_label(s.scholar_id_number) || ': the approval of the grades entered for ' || v_term || ' was reverted by ' || v_label || '. They wait for approval again.',
    s.record_id, public._renewal_scholar_label(s.scholar_id_number), true);
  perform public._renewal_log(s.record_id, v_stage, v_stage, 'Approval of the entered grades was reverted (try ' || s.version || '): ' || v_note, v_label);
  perform public._renewal_recheck(s.record_id);
  perform public._renewal_scholar_list_refresh_one(s.scholar_id_number, s.school_year, s.term);
  return 'reverted';
end;
$$;
revoke all on function public.renewal_self_grades_revert(uuid, text) from public, anon;
grant execute on function public.renewal_self_grades_revert(uuid, text) to authenticated;

notify pgrst, 'reload schema';
