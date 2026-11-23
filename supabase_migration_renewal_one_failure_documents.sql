-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_one_failure_documents.sql
-- SCHOLAR RENEWAL, ONE FAILED SUBJECT (no earlier probation): THE STUDY PLAN AND THE CLEARANCE ARE ALWAYS REQUIRED, AND THE EVALUATOR CHOOSES REGULAR OR PROBATIONARY.   Safe to run twice.   Undo: undo_renewal_one_failure_documents.sql
--   The route stays the same (consultation, the consultation staff endorse a status, the evaluator approves). What is new for a scholar with ONE failed subject (and no earlier probation):
--     * the scholar can be renewed, but whatever status is approved (Regular, Probationary or Reconsidered; not Removed) the case first waits for the STUDY PLAN and the CLEARANCE
--       (and the letter from the dean when there is an INC); the consultation staff approve them, and then the scholar is renewed with the approved status;
--     * the evaluator sees the status the consultation staff endorsed and may choose REGULAR or PROBATIONARY when approving (the change is written to the history).
--   Scholars with two or more failed subjects, and everyone else, are not changed. Cases that are waiting now are not changed either (the new rule applies when the evaluator approves).
-- Replaces 3 functions (the originals are in the undo file; the approval has one more optional value, the status the evaluator chooses). Nothing is deleted.
-- Needs supabase_migration_renewal_documents_after_approval.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._renewal_finish_endorsed(uuid)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_documents_after_approval.sql first.';
  end if;
end $$;

-- 1. The rules (only the words a scholar with one failed subject reads).
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
  v_tag boolean := false;
  v_gwa numeric;
  v_pass numeric;
  v_low_gwa boolean := false;
  v_flow boolean := false;
  v_await boolean := false;
begin
  select * into v_scholar from public.scholars where scholar_id_number = p_scholar_id_number;
  if not found then return jsonb_build_object('error', 'Scholar not found.'); end if;
  select * into v_rec from public.renewal_records where scholar_id_number = p_scholar_id_number and school_year = p_school_year and term = p_term;
  -- the Grades Approver tagged this scholar as temporary probationary (an INC or one missing grade): see renewal_tag_temp_probation()
  v_tag := v_rec.id is not null and v_rec.temp_tag_at is not null;

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
      elsif v_outcome = 'inc' or (v_outcome = 'ungraded' and v_tag) then      -- a missing grade of a tagged scholar is tracked like an INC (with its own deadline)
        v_inc := v_inc + 1;
        v_item := null;
        if v_rec.id is not null then
          select * into v_item from public.renewal_inc_items i where i.record_id = v_rec.id and i.subject_code = g.subject_code;
        end if;
        v_inc_list := v_inc_list || jsonb_build_array(jsonb_build_object('code', g.subject_code, 'subject', g.subject, 'grade', g.grade,
          'state', coalesce(v_item.state, 'open'), 'deadline', v_item.deadline, 'item_id', v_item.id,
          'kind', case when v_outcome = 'ungraded' then 'lacking' else 'inc' end));
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
  -- the academic status of the program and the passing GWA of the SCHOOL (on the school's own scale): a GWA worse than it needs a consultation (also with no failed subject)
  if v_state = 'ready' and not v_summer then
    select c.gwa, c.passing_gwa, coalesce(c.low, false) into v_gwa, v_pass, v_low_gwa from public._scholar_gwa_check(p_scholar_id_number, v_b_year, v_b_term, case when v_use_self then v_self.id else null end) c;
  end if;
  v_c := (v_failed_eff >= 2) or (v_failed_eff = 1 and v_prev);
  v_b := (v_failed_eff = 1 and not v_prev);
  v_consult_done := v_rec.consultation_done_at is not null;
  v_hard_copy := v_rec.hard_copy_received_at is not null;
  -- a case the Division Head already has (or had) keeps the old route; every other case with a failed subject / DRP follows the consultation staff's endorsement
  v_legacy := v_rec.id is not null and exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = v_rec.id);
  -- the consultation route (a failed subject / DRP, not with the Division Head) asks for NO document before the decision; the study plan and the clearance (and the letter from the dean when an INC is open)
  -- are asked only AFTER the evaluator approved Probationary or Reconsidered, while the case is "awaiting_documents"
  v_flow := not v_legacy and (v_c or v_b);
  v_await := v_flow and v_rec.id is not null and v_rec.stage = 'awaiting_documents';

  -- Documents this case needs (independent of the stage, so a scholar can see what is coming).
  if v_state = 'ready' then
    -- a scholar with a failed subject (one or two or more) or an INC sends the three documents: the letter from the dean, the study plan and the clearance
    -- (a tagged scholar with only an INC / one missing grade sends no documents and has no consultation: the evaluator renews them as temporary probationary)
    v_need_study := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
    -- the letter from the dean is NOT needed for failed subjects (one, two or more): the study plan and the clearance only. An INC still needs it.
    v_need_inc := v_inc_open > 0 and not v_tag;
    v_need_clear := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
    if v_flow and not v_await then v_need_study := false; v_need_inc := false; v_need_clear := false; end if;
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

  v_consult_required := (v_state = 'ready') and (v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag) or v_summer or v_low_gwa);

  -- Rule code and plain-language text.
  if v_state = 'ready' then
    if v_c then v_code := case when v_failed_eff >= 2 then 'C2' else 'C1P' end;
      v_text := case when v_failed_eff >= 2
        then 'Two or more failed subjects: the letter from your dean, the study plan and the clearance, then a consultation, then the Division Head decides (Removed if approved).'
        else 'One failed subject and the scholar was on probation before: treated like two or more failed subjects — the letter from your dean, the study plan and the clearance, then a consultation, then the Division Head decides (Removed if approved).' end;
    elsif v_b then v_code := 'B';
      v_text := 'One failed subject and no previous probation: the letter from your dean, the study plan and the clearance, then a consultation, then the evaluator endorses the scholar for Probationary to the Division Head, who approves (Renewed as Probationary if approved).';
    elsif v_tag and v_inc_open > 0 then v_code := 'T';
      v_text := 'Tagged as temporary probationary (an INC or one missing grade): no documents and no consultation. The evaluator renews the scholar as Probationary (temporary); the scholar has the days the Grades Approver gave to comply, then returns to Regular if the grade is passed, or stays Probationary.';
    elsif v_inc_open > 0 then v_code := 'D';
      v_text := 'Has an INC subject: INC letter from the dean, study plan and clearance, temporary probation and a consultation where staff set the deadline to comply. Decided after the INC is resolved.';
    else v_code := case when v_low_gwa then 'G' else 'A' end;
      v_text := case when v_low_gwa then 'All subjects passed, but the GWA (' || to_char(v_gwa, 'FM0.00') || ') is below the passing GWA of the scholar''s program group (' || to_char(v_pass, 'FM0.00') || '): the scholar books a consultation, then the evaluator confirms the renewal.'
                     else 'All subjects passed: no documents needed. The evaluator confirms the renewal.' end;
    end if;
    if v_flow then
      v_text := case when v_await
        then 'Your new scholarship status was approved. To complete your renewal, send ' || case when v_inc_open = 0 then 'the study plan and the clearance' else 'the letter from your dean, the study plan and the clearance' end || ' (the consultation staff approve them).'
        else 'A failed subject (or a DRP): book your consultation. Then the consultation staff endorse your new scholarship status and the evaluator approves it. ' || case when v_b then 'With one failed subject you can still be renewed, but you must send ' else 'If you are approved as Reconsidered or Probationary, you then send ' end || case when v_inc_open = 0 then 'the study plan and the clearance' else 'the letter from your dean, the study plan and the clearance' end || ' (the consultation staff approve them). No document is needed before that.' end;
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
    v_stage := case when v_await then 'awaiting_documents' when v_consult_done then 'ready_for_endorsement' else 'needs_study_plan_consultation' end;
  elsif v_c then v_stage := 'needs_consultation_division_head';
  elsif v_b then
    v_stage := case when v_docs_complete and v_consult_done and v_inc_open = 0 then 'ready_to_endorse' else 'needs_study_plan_consultation' end;
  elsif v_tag and v_inc_open > 0 and not v_summer then
    v_stage := 'ready_for_confirmation';
  elsif v_inc_open > 0 then
    v_stage := case when v_inc_open_without_deadline > 0 then 'needs_inc_letter_consultation'
                    when v_inc_overdue > 0 then 'inc_deadline_passed'
                    else 'inc_waiting_compliance' end;
  elsif v_summer then
    v_stage := case when v_docs_complete and v_consult_done and v_hard_copy then 'ready_for_confirmation' else 'summer_requirements' end;
  elsif v_low_gwa then
    v_stage := case when v_consult_done then 'ready_for_confirmation' else 'needs_gwa_consultation' end;
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
    'temp_tag', v_tag, 'gwa', v_gwa, 'passing_gwa', v_pass, 'low_gwa', v_low_gwa, 'academic_version', (select ags.version from public.academic_gwa_settings ags where ags.id), 'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
    'rule_code', v_code, 'rule_text', v_text, 'stage', v_stage, 'reason', v_reason,
    'required_documents', v_docs, 'consult_route', ((v_c or v_b) and not v_legacy), 'consultation_required', v_consult_required, 'consultation_done', v_consult_done, 'documents_complete', v_docs_complete);
end;
$$;
revoke all on function public._renewal_evaluate(text, text, text) from public, anon, authenticated;

-- 2. The scholar is renewed when the last document is approved (also with the status Regular).
create or replace function public._renewal_finish_endorsed(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_ev jsonb;
  v_label text;
begin
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found or v_rec.stage <> 'awaiting_documents' or v_rec.endorsed_status not in ('Regular', 'Probationary', 'Reconsidered') then return; end if;
  v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
  if v_ev ? 'error' or (v_ev ->> 'stage') <> 'awaiting_documents' or not coalesce((v_ev ->> 'documents_complete')::boolean, false) then return; end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  perform public._renewal_set_status(v_rec.scholar_id_number, v_rec.endorsed_status, false, 'Endorsed by the consultation staff, approved by the evaluator, documents approved (renewal of ' || v_label || ').');
  update public.renewal_records set stage = 'renewed', result = case v_rec.endorsed_status when 'Probationary' then 'renewed_probationary' when 'Reconsidered' then 'reconsidered' else 'renewed' end,
    temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = coalesce(v_rec.endorsement_approved_by, auth.uid()), evaluation = v_ev, updated_at = now() where id = p_record_id;
  perform public._renewal_log(p_record_id, 'awaiting_documents', 'renewed', 'The documents were approved: renewed as ' || v_rec.endorsed_status || '.');
  perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
    'Your documents were approved. You are renewed for ' || v_label || ' with the status ' || v_rec.endorsed_status || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
end;
$$;
revoke all on function public._renewal_finish_endorsed(uuid) from public, anon, authenticated;

-- 3. The evaluator approves the endorsement (and may choose Regular or Probationary for a scholar with one failed subject).
drop function if exists public.renewal_approve_endorsement(uuid, text);
create or replace function public.renewal_approve_endorsement(p_record_id uuid, p_note text default '', p_status text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ev jsonb;
  v_docs text;
  v_one_failure boolean;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage <> 'endorsed_for_approval' or v_rec.endorsed_status is null then
    raise exception 'This case has no endorsement waiting for your approval (it is "%").', public._renewal_stage_title(v_rec.stage);
  end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);
  -- ONE failed subject and no earlier probation (rule B): the scholar can be renewed, but ALWAYS sends the study plan and the clearance first; the evaluator may choose Regular or Probationary
  v_one_failure := coalesce(v_rec.rule_code, '') ~ '^B(\+|$)';
  if p_status is not null and p_status is distinct from v_rec.endorsed_status then
    if not (v_one_failure and v_rec.endorsed_status in ('Regular', 'Probationary') and p_status in ('Regular', 'Probationary')) then
      raise exception 'The status can only be changed between Regular and Probationary, for a scholar with one failed subject.';
    end if;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'endorsed_for_approval', 'The evaluator chose ' || p_status || ' (the consultation staff endorsed ' || v_rec.endorsed_status || ').');
    update public.renewal_records set endorsed_status = p_status where id = p_record_id;
    v_rec.endorsed_status := p_status;
  end if;
  if v_rec.endorsed_status = 'Removed' then
    perform public._renewal_remove_scholar(v_rec.scholar_id_number, 'Removed by the endorsement of the consultation staff, approved by the evaluator (renewal of ' || v_label || ').');
    update public.renewal_records set stage = 'removed', result = 'removed', temp_probation = false, temp_previous_status = null, confirmed_at = now(), confirmed_by = auth.uid(),
      evaluator_comment = v_note, updated_at = now() where id = p_record_id;
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'removed', 'Endorsement approved: Removed. The scholar''s login was switched off.' || coalesce(' ' || v_note, ''));
    perform public._notify_scholar(v_rec.scholar_id_number, 'progress', 'Your scholarship was ended',
      'It was decided that your scholarship ends with this renewal (' || v_label || '). Please contact the CEDO office if you have questions.', p_record_id);
  elsif v_rec.endorsed_status in ('Probationary', 'Reconsidered') or (v_rec.endorsed_status = 'Regular' and v_one_failure) then
    -- the status is approved; the scholar now sends the documents (the study plan and the clearance, and the letter from the dean when an INC is open); the renewal is completed when they are approved
    update public.renewal_records set stage = 'awaiting_documents', evaluator_comment = v_note, endorsement_approved_at = now(), endorsement_approved_by = auth.uid(), updated_at = now() where id = p_record_id;
    v_ev := public._renewal_evaluate(v_rec.scholar_id_number, v_rec.school_year, v_rec.term);
    if v_ev ? 'error' or (v_ev ->> 'stage') <> 'awaiting_documents' then
      raise exception 'Something changed just now, so the endorsement cannot be approved yet (the case is "%"). Please open the case again.', public._renewal_stage_title(coalesce(v_ev ->> 'stage', 'unknown'));
    end if;
    update public.renewal_records set evaluation = v_ev, rule_code = v_ev ->> 'rule_code', rule_text = v_ev ->> 'rule_text', updated_at = now() where id = p_record_id;
    select string_agg(d ->> 'label', ', ') into v_docs from jsonb_array_elements(coalesce(v_ev -> 'required_documents', '[]'::jsonb)) d where not coalesce((d ->> 'approved')::boolean, false);
    perform public._renewal_log(p_record_id, 'endorsed_for_approval', 'awaiting_documents', 'Endorsement approved: ' || v_rec.endorsed_status || '. Waiting for the documents.' || coalesce(' ' || v_note, ''));
    if v_docs is not null then
      perform public._notify_scholar(v_rec.scholar_id_number, 'document_required', 'Your new scholarship status was approved',
        'You are approved as ' || v_rec.endorsed_status || ' for ' || v_label || '. To complete your renewal, please upload: ' || v_docs || '. The consultation staff will approve them.', p_record_id);
    end if;
    perform public._renewal_finish_endorsed(p_record_id);      -- when everything needed is already approved, the scholar is renewed now
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
revoke all on function public.renewal_approve_endorsement(uuid, text, text) from public, anon;
grant execute on function public.renewal_approve_endorsement(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
