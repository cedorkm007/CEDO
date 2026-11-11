-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_consultation_endorse.sql
-- The renewal of a scholar with a failed subject / DRP: NO Division Head. New route (steps a-k):
--   a. the scholar applies  b. enters the grades (if the school has not uploaded)  c. asks for the SDP reconsideration  d. the Grades Approver approves the grades  e. the SDP approver decides
--   f. the scholar books the consultation FIRST (or the evaluator refers / books for the scholar)  g. the scholar uploads the letter from the dean, the study plan and the clearance
--   h. the CONSULTATION STAFF approve the three documents (the Renewal Documents Approver no longer does)
--   i. after the consultation was attended AND the three documents are approved, the CONSULTATION STAFF endorse the new scholarship status: Regular, Probationary, Reconsidered or Removed
--   j. the Scholar Renewal Evaluator approves the endorsement (or sends it back)  k. the scholar is renewed with that status.
-- Cases the Division Head already has (a referral exists) keep the old route. A scholar with only an open INC keeps the INC deadline steps.
-- Safe to run twice. Run supabase_migration_documents_for_failures.sql, supabase_migration_documents_after_grades.sql and the tagging files first.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._renewal_evaluate(text,text,text)') is null or to_regprocedure('public.renewal_refer_book(uuid,text,date,text,uuid)') is null
     or position('Letter from your dean' in pg_get_functiondef(to_regprocedure('public._renewal_evaluate(text,text,text)'))) = 0
     or to_regprocedure('public._notify_renewal_evaluators(text,text,uuid,text)') is null then
    raise exception 'STOPPED, nothing changed: run the earlier renewal SQL files first (documents for failures, refer for consultation).';
  end if;
end $$;

-- 1. Two new stages and the endorsement the consultation staff make.
alter table public.renewal_records drop constraint if exists renewal_records_stage_check;
alter table public.renewal_records add constraint renewal_records_stage_check check (stage in (
    'submitted', 'late_pending', 'late_declined', 'sdp_on_hold', 'waiting_grades', 'review_needed', 'ready_for_confirmation',
    'ready_to_endorse', 'endorsed_division_head', 'needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation',
    'inc_waiting_compliance', 'inc_deadline_passed', 'summer_requirements',
    'returned', 'renewed', 'removed', 'reconsidered', 'division_head_approved', 'not_required', 'ready_for_endorsement', 'endorsed_for_approval'));
alter table public.renewal_records add column if not exists endorsed_status text;
alter table public.renewal_records drop constraint if exists renewal_records_endorsed_status_check;
alter table public.renewal_records add constraint renewal_records_endorsed_status_check check (endorsed_status is null or endorsed_status in ('Regular', 'Probationary', 'Reconsidered', 'Removed'));
alter table public.renewal_records add column if not exists endorsed_at timestamptz;
alter table public.renewal_records add column if not exists endorsed_by uuid references public.users(id) on delete set null;
alter table public.renewal_records add column if not exists endorsed_note text;

create or replace function public._renewal_is_active_stage(p_stage text)
returns boolean
language sql
immutable
as $$
  select p_stage in ('submitted', 'sdp_on_hold', 'waiting_grades', 'review_needed', 'ready_for_confirmation', 'ready_to_endorse', 'ready_for_endorsement',
    'needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation',
    'inc_waiting_compliance', 'inc_deadline_passed', 'summer_requirements');
$$;
revoke all on function public._renewal_is_active_stage(text) from public, anon, authenticated;

create or replace function public._renewal_stage_title(p_stage text)
returns text
language sql
immutable
as $$
  select case p_stage
    when 'submitted' then 'Application submitted'
    when 'late_pending' then 'Late — needs evaluator acceptance'
    when 'late_declined' then 'Late application declined'
    when 'sdp_on_hold' then 'On hold — SDP not complied'
    when 'waiting_grades' then 'Waiting for grades'
    when 'review_needed' then 'Needs evaluator review'
    when 'ready_for_confirmation' then 'Ready for evaluator confirmation'
    when 'ready_to_endorse' then 'Ready to endorse to the Division Head'
    when 'ready_for_endorsement' then 'Ready for the consultation staff to endorse'
    when 'endorsed_for_approval' then 'Endorsed — waiting for the evaluator''s approval'
    when 'endorsed_division_head' then 'Endorsed — waiting for the Division Head'
    when 'needs_study_plan_consultation' then 'Needs study plan and consultation'
    when 'needs_consultation_division_head' then 'Needs consultation and Division Head decision'
    when 'needs_inc_letter_consultation' then 'Needs INC letter and consultation'
    when 'inc_waiting_compliance' then 'Temporary probation — waiting for INC compliance'
    when 'inc_deadline_passed' then 'INC deadline passed — decision needed'
    when 'summer_requirements' then 'Summer: prospectus and consultation needed'
    when 'returned' then 'Returned with comments'
    when 'renewed' then 'Renewed'
    when 'removed' then 'Removed'
    when 'reconsidered' then 'Reconsidered'
    when 'division_head_approved' then 'Approved by the Division Head'
    when 'not_required' then 'Not required this term'
    else p_stage end;
$$;
revoke all on function public._renewal_stage_title(text) from public, anon, authenticated;

-- A bell notice for every account with the Scholar Consultation Tool tag.
create or replace function public._notify_consultation_staff(p_title text, p_message text, p_record_id uuid, p_about text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  for t in select distinct x.staff_id as uid from public.staff_account_tags x where x.tag_key = 'scholar_counseling' loop
    perform public._notify_staff_member(t.uid, p_title, p_message, p_record_id, p_about);
  end loop;
end;
$$;
revoke all on function public._notify_consultation_staff(text, text, uuid, text) from public, anon, authenticated;

-- 2. The rules: a failed subject / DRP (not a case the Division Head already has) goes to the consultation + documents stage, then to "ready for endorsement".
create or replace function public._renewal_evaluate(p_scholar_id_number text, p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scholar public.scholars%rowtype;
  v_rec public.renewal_records%rowtype;
  v_b_year text;
  v_b_term text;
  v_summer boolean := (p_term = 'Summer');
  v_sdp record;
  v_rc public.sdp_reconsideration_requests%rowtype;
  v_req jsonb;
  v_next record;
  v_self public.renewal_self_grade_submissions%rowtype;
  v_use_self boolean := false;
  v_sdp_json jsonb := jsonb_build_object('applicable', not v_summer, 'complied', null, 'missing', null);
  v_sdp_ok boolean := true;
  v_period_id uuid;
  v_submitted boolean := false;
  v_school_sub boolean := false;
  v_state text := 'ready';
  v_reason text := '';
  v_total integer := 0;  v_passed integer := 0;  v_failed integer := 0;  v_drp integer := 0;  v_inc integer := 0;
  v_review integer := 0; v_ungraded integer := 0; v_nopm integer := 0;
  v_failed_list jsonb := '[]'::jsonb;  v_inc_list jsonb := '[]'::jsonb;  v_review_list jsonb := '[]'::jsonb;
  g record;
  v_outcome text;
  v_school uuid;
  v_item public.renewal_inc_items%rowtype;
  v_counted_failed integer := 0;
  v_inc_open integer := 0;
  v_inc_open_without_deadline integer := 0;
  v_inc_overdue integer := 0;
  v_prev boolean;
  v_failed_eff integer;
  v_c boolean;
  v_b boolean;
  v_docs jsonb := '[]'::jsonb;
  v_need_study boolean := false;
  v_need_inc boolean := false;
  v_docs_complete boolean := true;
  v_need_clear boolean := false;  v_clear_have integer := 0;  v_clear_approved integer := 0;
  v_study_have integer := 0;  v_inc_have integer := 0;  v_prosp_have integer := 0;  v_study_approved integer := 0;  v_inc_approved integer := 0;
  v_consult_done boolean := false;
  v_hard_copy boolean := false;
  v_consult_required boolean := false;
  v_stage text;
  v_code text;
  v_text text;
  v_legacy boolean := false;
begin
  select * into v_scholar from public.scholars where scholar_id_number = p_scholar_id_number;
  if not found then return jsonb_build_object('error', 'Scholar not found.'); end if;
  select * into v_rec from public.renewal_records where scholar_id_number = p_scholar_id_number and school_year = p_school_year and term = p_term;

  select b.basis_school_year, b.basis_term into v_b_year, v_b_term from public._renewal_basis(p_school_year, p_term) b;
  v_prev := public.scholar_had_regular_probation(p_scholar_id_number);

  -- SDP (1st and 2nd Semester only), checked for the basis semester.
  if not v_summer then
    select * into v_sdp from public._sdp_compliance(v_b_year, v_b_term, p_scholar_id_number) limit 1;
    if found then
      v_sdp_ok := coalesce(v_sdp.complied, false);
      v_sdp_json := jsonb_build_object('applicable', true, 'complied', v_sdp.complied, 'missing', v_sdp.missing,
        'community_service', v_sdp.community_service, 'community_volunteerism', v_sdp.community_volunteerism, 'formation_program', v_sdp.formation_program);
    else
      v_sdp_ok := false;
      v_sdp_json := jsonb_build_object('applicable', true, 'complied', false, 'missing', 'No SDP record found');
    end if;
    -- what each category needs (3, plus what the scholar owes for this semester), what is lacking, and the semester after (where a reconsideration's lacking credits are added)
    v_req := public._sdp_required_map(p_scholar_id_number, v_b_year, v_b_term);
    select n.school_year, n.semester into v_next from public._sdp_next_semester(v_b_year, v_b_term) n;
    v_sdp_json := v_sdp_json || jsonb_build_object('required', v_req,
      'lacking', jsonb_build_object(
        'community_service', greatest(0, (v_req ->> 'community_service')::integer - coalesce((v_sdp_json ->> 'community_service')::integer, 0)),
        'community_volunteerism', greatest(0, (v_req ->> 'community_volunteerism')::integer - coalesce((v_sdp_json ->> 'community_volunteerism')::integer, 0)),
        'formation_program', greatest(0, (v_req ->> 'formation_program')::integer - coalesce((v_sdp_json ->> 'formation_program')::integer, 0))),
      'next_school_year', v_next.school_year, 'next_semester', v_next.semester);
  end if;
  -- the scholar's SDP reconsideration request for this term, if there is one (an approved one already made the check above say "complied")
  select * into v_rc from public.sdp_reconsideration_requests r where r.scholar_id_number = p_scholar_id_number and r.school_year = p_school_year and r.term = p_term;
  if found then
    v_sdp_json := v_sdp_json || jsonb_build_object('reconsideration', jsonb_build_object('id', v_rc.id, 'status', v_rc.status, 'requested_at', v_rc.requested_at,
      'decided_at', v_rc.decided_at, 'note', v_rc.decision_note, 'lacking', v_rc.lacking));
    if v_rc.status = 'approved' then v_sdp_json := v_sdp_json || jsonb_build_object('by_reconsideration', true); end if;
  end if;

  -- Grades for the basis semester: has the school submitted it?
  select p.id into v_period_id from public.academic_periods p where p.school_year = v_b_year and p.term = v_b_term;
  if v_scholar.school_id is null then
    v_state := 'review'; v_reason := 'The scholar is not linked to a school.';
  else
    select exists (
      select 1 from public.school_period_submissions s
      where s.school_id = v_scholar.school_id and s.period_id = v_period_id and s.status = 'submitted'
    ) into v_school_sub;
    -- the school's grades count for THIS scholar only when the school submitted the semester AND recorded at least one graded subject for the scholar
    -- (a school can submit a semester without a single grade for this scholar: then the scholar must enter their own, like when the school has not submitted)
    v_submitted := v_school_sub and exists (
      select 1 from public.scholar_subjects_grades r
      where r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term and nullif(btrim(coalesce(r.grade, '')), '') is not null);
    -- the grades the scholar entered in the portal for this semester (the newest try that is waiting or approved)
    select * into v_self from public.renewal_self_grade_submissions e where e.scholar_id_number = p_scholar_id_number and e.basis_school_year = v_b_year and e.basis_term = v_b_term
      and e.status in ('pending', 'approved') order by e.version desc limit 1;
    if not v_submitted then
      if v_self.status = 'approved' then
        v_use_self := true;     -- the school has not uploaded yet: the entered grades the Grades Approver approved count as the scholar's grades
      elsif v_self.status = 'pending' then
        v_state := 'waiting';
        v_reason := 'The grades you entered for ' || public._renewal_term_label(v_b_year, v_b_term) || ' are waiting for the Grades Approver.';
      else
        v_state := 'waiting';
        v_reason := case when v_school_sub then 'Your school has submitted its grades but has none recorded for you for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.'
                         else 'Your school has not submitted its grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.' end;
      end if;
    end if;
  end if;

  if v_state = 'ready' or v_state = 'waiting' then
    for g in
      select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id
      from public.scholar_subjects_grades r
      where not v_use_self and r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term
      union all
      select l.id, l.subject_code, l.subject, l.grade, null::uuid
      from public.renewal_self_grade_lines l
      where v_use_self and l.submission_id = v_self.id
      order by 2, 3
    loop
      v_school := coalesce(g.recorded_by_school_id, v_scholar.school_id);
      v_outcome := public._grade_outcome(v_school, g.grade);
      v_total := v_total + 1;
      if v_outcome = 'passed' then v_passed := v_passed + 1;
      elsif v_outcome = 'failed' or v_outcome = 'drp' then
        v_failed := v_failed + 1; if v_outcome = 'drp' then v_drp := v_drp + 1; end if;
        v_failed_list := v_failed_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade, 'outcome', v_outcome));
      elsif v_outcome = 'inc' then
        v_inc := v_inc + 1;
        v_item := null;
        if v_rec.id is not null then
          select * into v_item from public.renewal_inc_items i where i.record_id = v_rec.id and i.subject_code = g.subject_code;
        end if;
        v_inc_list := v_inc_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade,
          'state', coalesce(v_item.state, 'open'), 'deadline', v_item.deadline, 'item_id', v_item.id));
        if coalesce(v_item.state, 'open') = 'counted_failed' then v_counted_failed := v_counted_failed + 1;
        elsif coalesce(v_item.state, 'open') = 'open' then
          v_inc_open := v_inc_open + 1;
          if v_item.deadline is null then v_inc_open_without_deadline := v_inc_open_without_deadline + 1;
          elsif v_item.deadline < (now() at time zone 'Asia/Manila')::date then v_inc_overdue := v_inc_overdue + 1; end if;
        end if;
      elsif v_outcome = 'ungraded' then v_ungraded := v_ungraded + 1;
      else
        v_review := v_review + 1; if v_outcome = 'no_passing_mark' then v_nopm := v_nopm + 1; end if;
        v_review_list := v_review_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade, 'outcome', v_outcome));
      end if;
    end loop;

    if v_state = 'ready' then
      if v_total = 0 then
        v_state := 'no_grades'; v_reason := 'No grades are recorded for ' || public._renewal_term_label(v_b_year, v_b_term) || '.';
      elsif v_ungraded > 0 then
        v_state := 'waiting'; v_reason := 'Some grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' are still blank.';
      elsif v_nopm > 0 then
        v_state := 'review'; v_reason := 'The school has not set its passing mark, so the grades cannot be judged yet.';
      elsif v_review > 0 then
        v_state := 'review'; v_reason := 'Some marks cannot be read as passed or failed and need the evaluator''s review.';
      end if;
    end if;
  end if;

  v_failed_eff := v_failed + v_counted_failed;
  v_c := (v_failed_eff >= 2) or (v_failed_eff = 1 and v_prev);
  v_b := (v_failed_eff = 1 and not v_prev);
  v_consult_done := v_rec.consultation_done_at is not null;
  v_hard_copy := v_rec.hard_copy_received_at is not null;
  -- a case the Division Head already has (or had) keeps the old route; every other case with a failed subject / DRP follows the consultation staff's endorsement
  v_legacy := v_rec.id is not null and exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = v_rec.id);

  -- Documents this case needs (independent of the stage, so a scholar can see what is coming).
  if v_state = 'ready' then
    -- a scholar with a failed subject (one or two or more) or an INC sends the three documents: the letter from the dean, the study plan and the clearance
    v_need_study := v_failed_eff >= 1 or v_inc_open > 0;
    v_need_inc := v_failed_eff >= 1 or v_inc_open > 0;
    v_need_clear := v_failed_eff >= 1 or v_inc_open > 0;
  end if;
  if v_rec.id is not null then
    select count(*) filter (where d.kind = 'study_plan'), count(*) filter (where d.kind = 'inc_letter'), count(*) filter (where d.kind = 'prospectus'),
           count(*) filter (where d.kind = 'study_plan' and d.status = 'accepted'), count(*) filter (where d.kind = 'inc_letter' and d.status = 'accepted'),
           count(*) filter (where d.kind = 'clearance'), count(*) filter (where d.kind = 'clearance' and d.status = 'accepted')
      into v_study_have, v_inc_have, v_prosp_have, v_study_approved, v_inc_approved, v_clear_have, v_clear_approved
    from public.renewal_documents d where d.record_id = v_rec.id and d.status <> 'returned';
  end if;
  if v_need_study then
    -- "satisfied" = uploaded; "approved" = the evaluator accepted it (the scholar cannot book a consultation, and the case cannot be endorsed, before that).
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'study_plan', 'label', 'Study plan', 'satisfied', v_study_have > 0, 'approved', v_study_approved > 0));
    if v_study_have = 0 or v_study_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_inc then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'inc_letter', 'label', 'Letter from your dean', 'satisfied', v_inc_have > 0, 'approved', v_inc_approved > 0));
    if v_inc_have = 0 or v_inc_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_clear then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'clearance', 'label', 'Clearance (from your school Guidance office or School coordinator)', 'satisfied', v_clear_have > 0, 'approved', v_clear_approved > 0));
    if v_clear_have = 0 or v_clear_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_summer then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'prospectus', 'label', 'Prospectus (bring the hard copy to your consultation)', 'satisfied', v_prosp_have > 0));
    if v_prosp_have = 0 then v_docs_complete := false; end if;
  end if;

  v_consult_required := (v_state = 'ready') and (v_failed_eff >= 1 or v_inc_open > 0 or v_summer);

  -- Rule code and plain-language text.
  if v_state = 'ready' then
    if v_c then v_code := case when v_failed_eff >= 2 then 'C2' else 'C1P' end;
      v_text := case when v_failed_eff >= 2
        then 'Two or more failed subjects: the letter from your dean, the study plan and the clearance, then a consultation, then the Division Head decides (Removed if approved).'
        else 'One failed subject and the scholar was on probation before: treated like two or more failed subjects — the letter from your dean, the study plan and the clearance, then a consultation, then the Division Head decides (Removed if approved).' end;
    elsif v_b then v_code := 'B';
      v_text := 'One failed subject and no previous probation: the letter from your dean, the study plan and the clearance, then a consultation, then the evaluator endorses the scholar for Probationary to the Division Head, who approves (Renewed as Probationary if approved).';
    elsif v_inc_open > 0 then v_code := 'D';
      v_text := 'Has an INC subject: INC letter from the dean, study plan and clearance, temporary probation and a consultation where staff set the deadline to comply. Decided after the INC is resolved.';
    else v_code := 'A';
      v_text := 'All subjects passed: no documents needed. The evaluator confirms the renewal.';
    end if;
    if not v_legacy and (v_c or v_b) then
      v_text := 'A failed subject (or a DRP): book your consultation, send the letter from your dean, the study plan and the clearance (the consultation staff approve them), then the consultation staff endorse your new scholarship status and the evaluator approves it.';
    end if;
    if v_inc_open > 0 and v_failed_eff >= 1 then
      v_code := v_code || '+D';
      v_text := v_text || ' The INC stays on temporary probation until it is resolved, then the case is re-checked.';
    end if;
    if v_summer then
      v_code := v_code || '+S';
      v_text := v_text || ' Summer: no SDP requirement; the prospectus and a face-to-face consultation (hard copy received) are always required before the evaluator confirms.';
    end if;
  end if;

  -- The stage.
  if not v_sdp_ok then
    v_stage := 'sdp_on_hold'; v_reason := coalesce(v_sdp_json ->> 'missing', 'SDP not complied');
    v_code := 'SDP_HOLD';
    v_text := case when v_rc.status = 'pending' then 'SDP is not complied: an SDP reconsideration was requested and is waiting for a decision. It is re-checked automatically.'
                   when v_rc.status = 'denied' then 'SDP is not complied: the SDP reconsideration request was denied, so the application is on hold until the missing credits are recorded. It is re-checked automatically.'
                   else 'SDP is not complied: the application is on hold until the missing credits are recorded. It is re-checked automatically.' end;
  elsif v_state = 'waiting' then
    v_stage := 'waiting_grades'; v_code := 'WAITING'; v_text := 'Waiting for grades: re-checked automatically when the school submits.';
  elsif v_state in ('no_grades', 'review') then
    v_stage := 'review_needed'; v_code := 'REVIEW'; v_text := 'Needs the evaluator''s manual review: ' || v_reason;
  elsif (v_c or v_b) and not v_legacy then
    v_stage := case when v_docs_complete and v_consult_done then 'ready_for_endorsement' else 'needs_study_plan_consultation' end;
  elsif v_c then v_stage := 'needs_consultation_division_head';
  elsif v_b then
    v_stage := case when v_docs_complete and v_consult_done and v_inc_open = 0 then 'ready_to_endorse' else 'needs_study_plan_consultation' end;
  elsif v_inc_open > 0 then
    v_stage := case when v_inc_open_without_deadline > 0 then 'needs_inc_letter_consultation'
                    when v_inc_overdue > 0 then 'inc_deadline_passed'
                    else 'inc_waiting_compliance' end;
  elsif v_summer then
    v_stage := case when v_docs_complete and v_consult_done and v_hard_copy then 'ready_for_confirmation' else 'summer_requirements' end;
  else
    v_stage := 'ready_for_confirmation';
  end if;

  return jsonb_build_object(
    'basis_school_year', v_b_year, 'basis_term', v_b_term, 'sdp', v_sdp_json,
    'grades', jsonb_build_object(
      'state', v_state, 'school_submitted', v_submitted, 'reason', v_reason,
      'self_reported', v_use_self, 'self_status', v_self.status, 'self_submission_id', v_self.id,
      'counts', jsonb_build_object('total', v_total, 'passed', v_passed, 'failed', v_failed, 'drp', v_drp, 'inc', v_inc, 'review', v_review, 'ungraded', v_ungraded),
      'failed_subjects', v_failed_list, 'inc_subjects', v_inc_list, 'review_subjects', v_review_list),
    'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
    'rule_code', v_code, 'rule_text', v_text, 'stage', v_stage, 'reason', v_reason,
    'required_documents', v_docs, 'consult_route', ((v_c or v_b) and not v_legacy), 'consultation_required', v_consult_required, 'consultation_done', v_consult_done);
end;
$$;
revoke all on function public._renewal_evaluate(text, text, text) from public, anon, authenticated;

create or replace function public._renewal_recheck(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ev jsonb;
  v_old_stage text;
  v_new_stage text;
  v_term_label text;
  v_item jsonb;
  v_state text;
  v_outcome text;
  v_old_docs text[];
  v_new_docs text[];
  v_doc text;
  v_labels text;
  v_inc_open integer;
  v_scholar public.scholars%rowtype;
  v_auto boolean := false;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or not public._renewal_is_active_stage(v_rec.stage) then return; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_rec.scholar_id_number;

  v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  if v_ev ? 'error' then return; end if;
  v_old_stage := v_rec.stage;
  v_new_stage := v_ev ->> 'stage';
  -- a scholar the IT admin's team tagged for automatic renewal (this term, not Summer) who reaches "ready for confirmation" is renewed by the system: see below
  v_auto := v_new_stage = 'ready_for_confirmation' and v_rec.term <> 'Summer'
    and exists (select 1 from public.renewal_tagged_scholars t where t.scholar_id_number = v_rec.scholar_id_number and t.school_year = v_rec.school_year and t.term = v_rec.term);
  v_term_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  -- INC items: one per INC subject; settled when the school enters the completed grade.
  for v_item in select * from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') loop
    insert into public.renewal_inc_items (record_id, scholar_id_number, subject_code, subject)
    values (v_rec.id, v_rec.scholar_id_number, v_item ->> 'code', v_item ->> 'subject')
    on conflict (record_id, subject_code) do nothing;
  end loop;
  for v_item in
    select jsonb_build_object('id', i.id, 'code', i.subject_code) from public.renewal_inc_items i
    where i.record_id = v_rec.id and i.state = 'open'
      and not exists (select 1 from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') s where s ->> 'code' = i.subject_code)
  loop
    select public._grade_outcome(coalesce(g.recorded_by_school_id, v_scholar.school_id), g.grade) into v_outcome
    from public.scholar_subjects_grades g
    where g.scholar_id_number = v_rec.scholar_id_number and g.school_year = v_ev ->> 'basis_school_year'
      and g.semester = v_ev ->> 'basis_term' and g.subject_code = v_item ->> 'code'
    order by g.updated_at desc limit 1;
    v_state := case v_outcome when 'passed' then 'resolved_passed' when 'failed' then 'resolved_failed' when 'drp' then 'resolved_failed' else null end;
    if v_state is not null then
      update public.renewal_inc_items set state = v_state, updated_at = now() where id = (v_item ->> 'id')::uuid;
      perform public._renewal_log(v_rec.id, v_rec.stage, v_rec.stage,
        'INC in ' || (v_item ->> 'code') || ' resolved with a ' || case when v_state = 'resolved_passed' then 'passing' else 'failing' end || ' grade.', 'System');
    end if;
  end loop;

  -- Temporary probation while an INC is open; lifted when none is left open.
  select count(*) into v_inc_open from public.renewal_inc_items i where i.record_id = v_rec.id and i.state = 'open';
  if v_inc_open > 0 and not v_rec.temp_probation and v_scholar.status in ('Regular', 'Reconsidered') and v_new_stage <> 'sdp_on_hold' and v_new_stage <> 'waiting_grades' then
    perform public._renewal_set_status(v_rec.scholar_id_number, 'Probationary', true, 'Temporary probation while an INC is open (renewal ' || v_term_label || ').');
    update public.renewal_records set temp_probation = true, temp_previous_status = v_scholar.status where id = v_rec.id;
    v_rec.temp_probation := true; v_rec.temp_previous_status := v_scholar.status;
  elsif v_inc_open = 0 and v_rec.temp_probation then
    if exists (select 1 from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number and s.status = 'Probationary') then
      perform public._renewal_set_status(v_rec.scholar_id_number, coalesce(v_rec.temp_previous_status, 'Regular'), false, 'Temporary INC probation lifted (renewal ' || v_term_label || ').');
    end if;
    update public.renewal_records set temp_probation = false where id = v_rec.id;
    v_rec.temp_probation := false;
  end if;

  update public.renewal_records set
    stage = v_new_stage, evaluation = v_ev, rule_code = v_ev ->> 'rule_code', rule_text = v_ev ->> 'rule_text',
    basis_school_year = v_ev ->> 'basis_school_year', basis_term = v_ev ->> 'basis_term',
    consultation_required = coalesce((v_ev ->> 'consultation_required')::boolean, false), updated_at = now()
  where id = v_rec.id;

  if v_new_stage is distinct from v_old_stage then
    perform public._renewal_log(v_rec.id, v_old_stage, v_new_stage,
      case v_new_stage
        when 'sdp_on_hold' then 'On hold: ' || coalesce(v_ev ->> 'reason', '')
        when 'waiting_grades' then v_ev ->> 'reason'
        when 'review_needed' then v_ev ->> 'reason'
        else coalesce(v_ev ->> 'rule_text', '') end, 'System');
    if v_new_stage = 'sdp_on_hold' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Your renewal is on hold',
        'Your SDP credits for ' || public._renewal_term_label(v_ev ->> 'basis_school_year', v_ev ->> 'basis_term') || ' are not complete yet: ' || coalesce(v_ev ->> 'reason', '') || '. We will check again automatically when new credits are recorded.', v_rec.id);
    elsif v_new_stage = 'waiting_grades' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'on_hold', 'Waiting for your grades',
        coalesce(v_ev ->> 'reason', '') || ' We will check again automatically when they are submitted.', v_rec.id);
    elsif v_new_stage in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements') then
      perform public._notify_scholar(v_rec.scholar_id_number, 'consultation_needed', 'A consultation is needed for your renewal',
        'Please see what is needed in your Renewal tile. ' || coalesce(v_ev ->> 'rule_text', ''), v_rec.id);
    elsif v_new_stage = 'ready_for_endorsement' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your consultation and documents are complete',
        'The consultation staff will now endorse your new scholarship status, and the evaluator will approve it. We will tell you the result.', v_rec.id);
      perform public._notify_consultation_staff('Ready to endorse', coalesce((select btrim(s.first_name || ' ' || s.last_name) from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number), 'A scholar') || ' attended the consultation and the three documents are approved. Open the Consultation Tool, Renewal Cases tab, to endorse the new scholarship status.', v_rec.id, v_rec.scholar_id_number);
    elsif v_new_stage = 'ready_to_endorse' then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will review your case and send it to the Division Head for approval.', v_rec.id);
    elsif v_new_stage = 'ready_for_confirmation' and v_old_stage <> 'submitted' and not v_auto then
      perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your renewal is ready for the evaluator',
        'Everything needed is in. The evaluator will confirm your renewal for ' || v_term_label || '.', v_rec.id);
    elsif v_new_stage = 'inc_deadline_passed' then
      null;
    end if;
  end if;

  -- A new document became necessary after the scholar had already applied.
  if v_rec.evaluation <> '{}'::jsonb then
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_old_docs from jsonb_array_elements(v_rec.evaluation -> 'required_documents') d;
    select coalesce(array_agg(d ->> 'kind'), '{}') into v_new_docs from jsonb_array_elements(v_ev -> 'required_documents') d;
    v_labels := null;
    foreach v_doc in array v_new_docs loop
      if not (v_doc = any (v_old_docs)) then
        v_labels := concat_ws(', ', v_labels, (select d ->> 'label' from jsonb_array_elements(v_ev -> 'required_documents') d where d ->> 'kind' = v_doc limit 1));
      end if;
    end loop;
    if v_labels is not null then
      perform public._notify_scholar(v_rec.scholar_id_number, 'document_required', 'A new document is needed', 'Please upload: ' || v_labels || '.', v_rec.id);
    end if;
  end if;

  if v_auto then
    perform public._renewal_auto_confirm(v_rec.id);
  end if;
end;
$$;
revoke all on function public._renewal_recheck(uuid) from public, anon, authenticated;

-- A case already endorsed (or ready to be) is not referred for a consultation any more.
create or replace function public._renewal_can_refer(r public.renewal_records)
returns boolean
language sql
stable
as $$
  select r.stage not in ('renewed', 'removed', 'late_declined', 'returned', 'ready_for_endorsement', 'endorsed_for_approval')
     and (coalesce((r.evaluation ->> 'failed_effective')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'drp')::integer, 0) > 0
          or coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0
          or coalesce((r.evaluation ->> 'open_inc')::integer, 0) > 0);
$$;

-- 3. The scholar books first; the documents do not hold the booking.
create or replace function public._renewal_consult_state(p_record_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  select * into r from public.renewal_records where id = p_record_id;
  if not found or r.consultation_done_at is not null
     or r.stage not in ('needs_study_plan_consultation', 'needs_consultation_division_head', 'needs_inc_letter_consultation', 'summer_requirements') then
    return 'not_needed';
  end if;
  -- the consultation is booked FIRST: the documents are approved by the consultation staff afterwards (they are needed before the endorsement, not before the booking)
  return 'ok';
end;
$$;
revoke all on function public._renewal_consult_state(uuid) from public, anon, authenticated;

-- 4. The consultation staff approve or return the three documents; they are told when a scholar sends one.
create or replace function public.renewal_review_document(p_document_id uuid, p_approve boolean, p_comment text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.renewal_documents%rowtype;
  r public.renewal_records%rowtype;
  v_label text;
begin
  select * into d from public.renewal_documents where id = p_document_id for update;
  if not found then raise exception 'That document was not found.'; end if;
  -- the letter from the dean, the study plan and the clearance: the consultation staff only; the prospectus (it gates nothing) stays with the evaluator
  if d.kind in ('study_plan', 'inc_letter', 'clearance') then
    if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can approve or return this document.'; end if;
  elsif not public.is_renewal_evaluator() then
    raise exception 'Only the Scholar Renewal Evaluator can do this.';
  end if;
  select * into r from public.renewal_records where id = d.record_id for update;
  if not (public._renewal_is_active_stage(r.stage) or r.stage = 'returned') then raise exception 'This application is closed, so its documents can no longer be reviewed.'; end if;
  if not p_approve and char_length(btrim(coalesce(p_comment, ''))) < 5 then raise exception 'Please tell the scholar what to fix (at least 5 characters).'; end if;
  v_label := case d.kind when 'study_plan' then 'study plan' when 'inc_letter' then 'letter from the dean' when 'clearance' then 'clearance' else 'prospectus' end;
  update public.renewal_documents set status = case when p_approve then 'accepted' else 'returned' end,
    reviewer_comment = nullif(btrim(coalesce(p_comment, '')), ''), reviewed_by = auth.uid(), reviewed_at = now() where id = d.id;
  perform public._renewal_log(r.id, r.stage, r.stage, case when p_approve then 'Approved the ' else 'Returned the ' end || v_label || ' (' || d.file_name || ')'
    || case when btrim(coalesce(p_comment, '')) <> '' then ': ' || btrim(p_comment) else '.' end);
  if p_approve then
    perform public._notify_scholar(d.scholar_id_number, case when d.kind = 'study_plan' then 'study_plan_approved' when d.kind = 'inc_letter' then 'inc_letter_approved' else 'document_approved' end,
      'Your ' || v_label || ' was approved',
      'Thank you.', r.id);
  else
    perform public._notify_scholar(d.scholar_id_number, case when d.kind = 'study_plan' then 'study_plan_returned' else 'document_returned' end,
      'Your ' || v_label || ' was returned', 'The consultation staff wrote: ' || btrim(p_comment) || ' Please upload a new one. Your consultation is not affected.', r.id);
  end if;
  perform public._renewal_recheck(r.id);
end;
$$;
revoke all on function public.renewal_review_document(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_review_document(uuid, boolean, text) to authenticated;

create or replace function public._renewal_docs_notify_approvers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_name text;
  v_label text;
begin
  if new.kind not in ('study_plan', 'inc_letter', 'clearance') or new.status <> 'submitted' then return new; end if;
  select btrim(s.first_name || ' ' || s.last_name) into v_name from public.scholars s where s.scholar_id_number = new.scholar_id_number;
  v_label := case new.kind when 'study_plan' then 'study plan' when 'inc_letter' then 'INC letter' else 'clearance' end;
  for a in select distinct t.staff_id as uid from public.staff_account_tags t where t.tag_key = 'scholar_counseling' loop
    if not exists (select 1 from public.notifications n where n.user_id = a.uid and n.reference_id = new.record_id::text and n.title = 'Renewal documents to approve' and not n.read) then
      perform public._notify_staff_member(a.uid, 'Renewal documents to approve', coalesce(v_name, 'A scholar') || ' sent a ' || v_label || ' to approve. Open the Consultation Tool, Renewal Cases tab.', new.record_id, coalesce(v_name, ''));
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public._renewal_docs_notify_approvers() from public, anon, authenticated;

drop policy if exists "scholar or staff reads renewal documents" on storage.objects;
create policy "scholar or staff reads renewal documents" on storage.objects for select
  using (bucket_id = 'renewal-documents' and ((storage.foldername(name))[1] = public.current_scholar_id_number() or public.can_view_renewals() or public.can_approve_scholar_grades() or public.can_approve_renewal_documents() or public.is_scholar_counseling_staff()));

-- 5. The consultation staff's list of renewal cases (documents to approve, cases to endorse, endorsed cases waiting for the evaluator).
create or replace function public.renewal_consult_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can see these cases.'; end if;
  return coalesce((
    select jsonb_agg(c.j order by c.ord, c.at)
    from (
      select jsonb_build_object(
        'record_id', r.id, 'scholar_id_number', s.scholar_id_number,
        'name', btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')),
        'school', s.school, 'program', s.course, 'year_level', s.year_level, 'scholar_status', s.status,
        'term_label', public._renewal_term_label(r.school_year, r.term), 'stage', r.stage,
        'rule_code', r.rule_code, 'rule_text', r.rule_text,
        'failed_subjects', coalesce(r.evaluation -> 'grades' -> 'failed_subjects', '[]'::jsonb),
        'inc_subjects', coalesce(r.evaluation -> 'grades' -> 'inc_subjects', '[]'::jsonb),
        'consultation_done_at', r.consultation_done_at,
        'next_consultation', (select jsonb_build_object('starts_at', x.starts_at, 'staff', public._staff_display_name(x.staff_id))
                              from public.counseling_slots x where x.record_id = r.id and x.state = 'booked' and x.starts_at > now() order by x.starts_at limit 1),
        'required_documents', coalesce(r.evaluation -> 'required_documents', '[]'::jsonb),
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'status', d.status, 'comment', d.reviewer_comment,
                                  'uploaded_at', d.uploaded_at, 'storage_path', d.storage_path) order by d.uploaded_at desc)
                               from public.renewal_documents d where d.record_id = r.id and d.kind in ('study_plan', 'inc_letter', 'clearance')), '[]'::jsonb),
        'can_endorse', r.stage = 'ready_for_endorsement',
        'endorsed_status', r.endorsed_status, 'endorsed_at', r.endorsed_at, 'endorsed_note', r.endorsed_note, 'endorsed_by', public._staff_display_name(r.endorsed_by),
        'legacy', exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = r.id)
      ) as j,
      case r.stage when 'ready_for_endorsement' then 0 when 'needs_study_plan_consultation' then 1 when 'endorsed_for_approval' then 3 else 2 end as ord,
      r.updated_at as at
      from public.renewal_records r
      join public.scholars s on s.scholar_id_number = r.scholar_id_number
      where r.stage in ('needs_study_plan_consultation', 'ready_for_endorsement', 'endorsed_for_approval', 'needs_inc_letter_consultation', 'inc_waiting_compliance', 'inc_deadline_passed')
    ) c), '[]'::jsonb);
end;
$$;
revoke all on function public.renewal_consult_cases() from public, anon;
grant execute on function public.renewal_consult_cases() to authenticated;

-- 6. The consultation staff endorse the new scholarship status (only after the consultation was attended AND the three documents are approved).
create or replace function public.renewal_endorse_status(p_record_id uuid, p_status text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ev jsonb;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
  v_label text;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Only the consultation staff can endorse a scholarship status.'; end if;
  if p_status is null or p_status not in ('Regular', 'Probationary', 'Reconsidered', 'Removed') then raise exception 'Choose Regular, Probationary, Reconsidered or Removed.'; end if;
  if p_status <> 'Regular' and char_length(coalesce(v_note, '')) < 5 then raise exception 'Please write the reason for this status (at least 5 characters).'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage = 'endorsed_for_approval' then raise exception 'This case is already endorsed and waiting for the evaluator.'; end if;
  if v_rec.stage <> 'ready_for_endorsement' then
    raise exception 'This case cannot be endorsed yet (it is "%"). The consultation has to be attended and the three documents approved first.', public._renewal_stage_title(v_rec.stage);
  end if;
  -- make sure it is still true right now
  v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  if v_ev ? 'error' or (v_ev ->> 'stage') <> 'ready_for_endorsement' or v_rec.consultation_done_at is null then
    raise exception 'Something changed just now: the consultation has to be attended and the three documents approved before you can endorse.';
  end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  update public.renewal_records set stage = 'endorsed_for_approval', endorsed_status = p_status, endorsed_at = now(), endorsed_by = auth.uid(), endorsed_note = v_note, updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, 'ready_for_endorsement', 'endorsed_for_approval',
    'The consultation staff endorsed the status ' || p_status || '.' || coalesce(' ' || v_note, ''), 'Consultation staff');
  select btrim(s.first_name || ' ' || s.last_name) into v_name from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  perform public._notify_renewal_evaluators('Endorsement to approve', coalesce(v_name, 'A scholar') || ' was endorsed for ' || p_status || ' (' || v_label || '). Open Scholar Renewal and approve the endorsement.', p_record_id, v_rec.scholar_id_number);
  perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your new scholarship status was endorsed',
    'The consultation staff endorsed your status for ' || v_label || '. The Scholar Renewal evaluator will approve it, then you are renewed. We will tell you the result.', p_record_id);
end;
$$;
revoke all on function public.renewal_endorse_status(uuid, text, text) from public, anon;
grant execute on function public.renewal_endorse_status(uuid, text, text) to authenticated;

-- 7. The Scholar Renewal evaluator approves the endorsement: the status is set and the scholar is renewed (or, for Removed, the scholarship ends).
create or replace function public.renewal_approve_endorsement(p_record_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'endorsed_for_approval' or v_rec.endorsed_status is null then
    raise exception 'This case has no endorsement waiting for your approval (it is "%").', public._renewal_stage_title(v_rec.stage);
  end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  if v_rec.endorsed_status = 'Removed' then
    perform public._renewal_remove_scholar(v_rec.scholar_id_number, 'Removed by the endorsement of the consultation staff, approved by the evaluator (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'removed', result = 'removed', temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = auth.uid(),
      evaluator_comment = v_note, updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'removed', 'Endorsement approved: Removed. The scholar''s login was switched off.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your scholarship was ended',
      'It was decided that your scholarship ends with this renewal (' || v_label || '). Please contact the CEDO office if you have questions.', p_record_id);
  else
    perform public._renewal_set_status(v_rec.scholar_id_number, v_rec.endorsed_status, false, 'Endorsed by the consultation staff and approved by the evaluator (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'renewed',
      result = case v_rec.endorsed_status when 'Probationary' then 'renewed_probationary' when 'Reconsidered' then 'reconsidered' else 'renewed' end,
      temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = auth.uid(), evaluator_comment = v_note, updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'renewed', 'Endorsement approved: renewed as ' || v_rec.endorsed_status || '.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
      'You are renewed for ' || v_label || ' with the status ' || v_rec.endorsed_status || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
  end if;
end;
$$;
revoke all on function public.renewal_approve_endorsement(uuid, text) from public, anon;
grant execute on function public.renewal_approve_endorsement(uuid, text) to authenticated;

-- 8. The evaluator can send an endorsement back to the consultation staff.
create or replace function public.renewal_return_endorsement(p_record_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_name text;
begin
  perform public._renewal_require_evaluator();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Please write why the endorsement is sent back (at least 5 characters).'; end if;
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'endorsed_for_approval' then raise exception 'This case has no endorsement waiting for your approval (it is "%").', public._renewal_stage_title(v_rec.stage); end if;
  update public.renewal_records set stage = 'ready_for_endorsement', endorsed_status = null, endorsed_at = null, endorsed_by = null, endorsed_note = null, updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'ready_for_endorsement', 'The evaluator sent the endorsement back to the consultation staff: ' || btrim(p_reason));
  select btrim(s.first_name || ' ' || s.last_name) into v_name from public.scholars s where s.scholar_id_number = v_rec.scholar_id_number;
  perform public._notify_consultation_staff('Endorsement sent back', 'The evaluator sent back the endorsement of ' || coalesce(v_name, 'a scholar') || ': ' || btrim(p_reason) || ' Open the Consultation Tool, Renewal Cases tab.', p_record_id, v_rec.scholar_id_number);
end;
$$;
revoke all on function public.renewal_return_endorsement(uuid, text) from public, anon;
grant execute on function public.renewal_return_endorsement(uuid, text) to authenticated;

-- 9. The evaluator no longer endorses to the Division Head a case the Division Head does not have yet: those are endorsed by the consultation staff.
--    (A case already with the Division Head, or sent back by the Division Head, still works as before.)

-- 10. Cases already waiting under the old stage names move to the new route on their next check.
select public._renewal_recheck(r.id)
from public.renewal_records r
where r.stage in ('ready_to_endorse', 'needs_study_plan_consultation', 'needs_consultation_division_head')
  and not exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = r.id);

notify pgrst, 'reload schema';

commit;

-- Result check (shown in the SQL editor)
select r.stage, count(*) as records from public.renewal_records r group by r.stage order by r.stage;
