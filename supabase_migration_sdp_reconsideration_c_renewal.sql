-- ─────────────────────────────────────────────────────────────
-- SDP RECONSIDERATION, FILE C of 3: the renewal side.   Safe to run twice.   Undo: undo_sdp_reconsideration_c.sql
-- Run AFTER _a_tables.sql and _b_sdp_rules.sql, and AFTER the renewal files (Phase 2 to 8b), the choose-schools files and the Scholar List file.
--
-- THE PROCESS
--   1. While applying for a renewal, a scholar who lacks SDP credits is shown what is lacking, is told what an approved request means, and may ask for an SDP
--      RECONSIDERATION together with the application (the application form sends the choice; the database refuses a request at any other time).
--   2. The request waits for an APPROVER: it.admin1 himself, or any staff account carrying the tag "SDP Reconsideration Approver" (it.admin1 gives the tag in Staff
--      Accounts, like every other tool tag). Approvers are told (bell) when a request arrives. The renewal evaluator and the consultation staff can SEE the requests.
--   3. APPROVED: the scholar is treated as complied with the SDP for the semester the renewal looked at; the credits that were lacking (counted at the moment of approval)
--      are added to the requirement of the NEXT semester (file B counts them everywhere); the application is re-checked at once and the scholar is told.
--      DENIED (a reason is required): the scholar is told why; the application stays on hold for SDP as before. If the scholar's credits are complete by the time the
--      request is decided, it is closed as "not needed" and nothing is owed.
-- Replaces the renewal check (_renewal_evaluate: adds the SDP details and the request to its answer, same stages as before) and one Scholar List function (so approvers
-- can open a scholar's credits); adds functions. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

-- Who decides requests: it.admin1 and the accounts he appoints with the tag.
create or replace function public.can_decide_sdp_reconsideration()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_it_admin() or exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'sdp_reconsideration_approver');
$$;
revoke all on function public.can_decide_sdp_reconsideration() from public, anon;
grant execute on function public.can_decide_sdp_reconsideration() to authenticated;

create or replace function public._sdp_reconsideration_notify_approvers(p_title text, p_message text, p_record_id uuid, p_about text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  for a in select x.staff_id as uid from public.staff_account_tags x where x.tag_key = 'sdp_reconsideration_approver'
           union select u.id from public.users u where lower(u.username) = 'it.admin1' loop
    perform public._notify_staff_member(a.uid, p_title, p_message, p_record_id, p_about);
  end loop;
end;
$$;
revoke all on function public._sdp_reconsideration_notify_approvers(text, text, uuid, text) from public, anon, authenticated;

-- "Institutional Volunteerism: 2 more credits; Formation Program: 1 more credit" from {"community_service": 2, "formation_program": 1}.
create or replace function public._sdp_lacking_text(p_lacking jsonb)
returns text
language sql
immutable
as $$
  select coalesce(nullif(concat_ws('; ',
    case when coalesce((p_lacking ->> 'community_service')::integer, 0) > 0 then 'Institutional Volunteerism: ' || (p_lacking ->> 'community_service') || ' more credit' || case when (p_lacking ->> 'community_service')::integer = 1 then '' else 's' end end,
    case when coalesce((p_lacking ->> 'community_volunteerism')::integer, 0) > 0 then 'Community Volunteerism: ' || (p_lacking ->> 'community_volunteerism') || ' more credit' || case when (p_lacking ->> 'community_volunteerism')::integer = 1 then '' else 's' end end,
    case when coalesce((p_lacking ->> 'formation_program')::integer, 0) > 0 then 'Formation Program: ' || (p_lacking ->> 'formation_program') || ' more credit' || case when (p_lacking ->> 'formation_program')::integer = 1 then '' else 's' end end), ''), 'nothing');
$$;
revoke all on function public._sdp_lacking_text(jsonb) from public, anon, authenticated;

-- The renewal check. Same stages and rules as before; its "sdp" part now also carries what each category needs, what is lacking, the semester after, and the reconsideration request.
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
  v_sdp_json jsonb := jsonb_build_object('applicable', not v_summer, 'complied', null, 'missing', null);
  v_sdp_ok boolean := true;
  v_period_id uuid;
  v_submitted boolean := false;
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
  v_study_have integer := 0;  v_inc_have integer := 0;  v_prosp_have integer := 0;  v_study_approved integer := 0;  v_inc_approved integer := 0;
  v_consult_done boolean := false;
  v_hard_copy boolean := false;
  v_consult_required boolean := false;
  v_stage text;
  v_code text;
  v_text text;
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
    ) into v_submitted;
    if not v_submitted then
      v_state := 'waiting';
      v_reason := 'Your school has not submitted its grades for ' || public._renewal_term_label(v_b_year, v_b_term) || ' yet.';
    end if;
  end if;

  if v_state = 'ready' or v_state = 'waiting' then
    for g in
      select r.id, r.subject_code, r.subject, r.grade, r.recorded_by_school_id
      from public.scholar_subjects_grades r
      where r.scholar_id_number = p_scholar_id_number and r.school_year = v_b_year and r.semester = v_b_term
      order by r.subject_code, r.subject
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

  -- Documents this case needs (independent of the stage, so a scholar can see what is coming).
  if v_state = 'ready' then
    v_need_study := v_b;
    v_need_inc := v_inc_open > 0;
  end if;
  if v_rec.id is not null then
    select count(*) filter (where d.kind = 'study_plan'), count(*) filter (where d.kind = 'inc_letter'), count(*) filter (where d.kind = 'prospectus'),
           count(*) filter (where d.kind = 'study_plan' and d.status = 'accepted'), count(*) filter (where d.kind = 'inc_letter' and d.status = 'accepted')
      into v_study_have, v_inc_have, v_prosp_have, v_study_approved, v_inc_approved
    from public.renewal_documents d where d.record_id = v_rec.id and d.status <> 'returned';
  end if;
  if v_need_study then
    -- "satisfied" = uploaded; "approved" = the evaluator accepted it (the scholar cannot book a consultation, and the case cannot be endorsed, before that).
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'study_plan', 'label', 'Study plan', 'satisfied', v_study_have > 0, 'approved', v_study_approved > 0));
    if v_study_have = 0 or v_study_approved = 0 then v_docs_complete := false; end if;
  end if;
  if v_need_inc then
    v_docs := v_docs || jsonb_build_array(jsonb_build_object('kind', 'inc_letter', 'label', 'INC letter from your dean', 'satisfied', v_inc_have > 0, 'approved', v_inc_approved > 0));
    if v_inc_have = 0 or v_inc_approved = 0 then v_docs_complete := false; end if;
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
        then 'Two or more failed subjects: consultation, then the Division Head decides (Removed if approved).'
        else 'One failed subject and the scholar was on probation before: treated like two or more failed subjects — consultation, then the Division Head decides (Removed if approved).' end;
    elsif v_b then v_code := 'B';
      v_text := 'One failed subject and no previous probation: study plan and consultation, then the evaluator endorses the scholar for Probationary to the Division Head, who approves (Renewed as Probationary if approved).';
    elsif v_inc_open > 0 then v_code := 'D';
      v_text := 'Has an INC subject: INC letter from the dean, temporary probation and a consultation where staff set the days to comply. Decided after the INC is resolved.';
    else v_code := 'A';
      v_text := 'All subjects passed: no documents needed. The evaluator confirms the renewal.';
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
      'counts', jsonb_build_object('total', v_total, 'passed', v_passed, 'failed', v_failed, 'drp', v_drp, 'inc', v_inc, 'review', v_review, 'ungraded', v_ungraded),
      'failed_subjects', v_failed_list, 'inc_subjects', v_inc_list, 'review_subjects', v_review_list),
    'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
    'rule_code', v_code, 'rule_text', v_text, 'stage', v_stage, 'reason', v_reason,
    'required_documents', v_docs, 'consultation_required', v_consult_required, 'consultation_done', v_consult_done);
end;
$$;
revoke all on function public._renewal_evaluate(text, text, text) from public, anon, authenticated;

-- Makes the request for one application (called by the application itself, never directly by the website).
create or replace function public._renewal_sdp_request_create(p_record_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.renewal_records%rowtype;
  ev jsonb;
  s jsonb;
  v_lack jsonb;
  v_id uuid;
  v_basis_label text;
  v_next_label text;
  v_text text;
begin
  select * into rec from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That application was not found.'; end if;
  if exists (select 1 from public.sdp_reconsideration_requests r where r.scholar_id_number = rec.scholar_id_number and r.school_year = rec.school_year and r.term = rec.term) then
    raise exception 'You already asked for an SDP reconsideration for this term.';
  end if;
  ev := public._renewal_evaluate(rec.scholar_id_number, rec.school_year, rec.term);
  s := ev -> 'sdp';
  if not coalesce((s ->> 'applicable')::boolean, false) then raise exception 'There is no SDP requirement for this term, so there is nothing to reconsider.'; end if;
  if coalesce((s ->> 'complied')::boolean, false) then raise exception 'Your SDP credits are complete, so there is nothing to reconsider.'; end if;
  v_lack := s -> 'lacking';
  if coalesce((v_lack ->> 'community_service')::integer, 0) + coalesce((v_lack ->> 'community_volunteerism')::integer, 0) + coalesce((v_lack ->> 'formation_program')::integer, 0) = 0 then
    raise exception 'No lacking SDP credits were found, so there is nothing to reconsider.';
  end if;
  insert into public.sdp_reconsideration_requests (scholar_id_number, school_year, term, record_id, basis_school_year, basis_term, lacking)
  values (rec.scholar_id_number, rec.school_year, rec.term, rec.id, rec.basis_school_year, rec.basis_term, v_lack)
  returning id into v_id;
  v_text := public._sdp_lacking_text(v_lack);
  v_basis_label := public._renewal_term_label(rec.basis_school_year, rec.basis_term);
  v_next_label := public._renewal_term_label(s ->> 'next_school_year', s ->> 'next_semester');
  perform public._notify_scholar(rec.scholar_id_number, 'sdp_reconsideration_requested', 'Your SDP reconsideration request was sent',
    'You asked for an SDP reconsideration with your renewal for ' || public._renewal_term_label(rec.school_year, rec.term) || '. Lacking: ' || v_text
    || '. If it is approved, you will be treated as complied with the SDP for ' || v_basis_label || ', and these lacking credits will be added to your SDP requirement for ' || v_next_label
    || '. We will tell you the decision.', rec.id);
  perform public._sdp_reconsideration_notify_approvers('SDP reconsideration requested', public._renewal_scholar_label(rec.scholar_id_number) || ' asked for an SDP reconsideration (' || v_text || ').', rec.id, public._renewal_scholar_label(rec.scholar_id_number));
  perform public._renewal_log(rec.id, rec.stage, rec.stage, 'SDP reconsideration requested (' || v_text || ').', 'Scholar');
  return v_id;
end;
$$;
revoke all on function public._renewal_sdp_request_create(uuid) from public, anon, authenticated;

-- Applying WITH the choice. The older form of renewal_apply (without the choice) is left exactly as it is and keeps working. A request can only be made here, when the
-- application is first made (not when a returned application is sent again).
create or replace function public.renewal_apply(p_window_id uuid, p_school text, p_program text, p_year_level text, p_note text, p_request_sdp_reconsideration boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  w public.renewal_windows%rowtype;
  v_record uuid;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into w from public.renewal_windows where id = p_window_id;
  if not found then raise exception 'That renewal window was not found.'; end if;
  if coalesce(p_request_sdp_reconsideration, false)
     and exists (select 1 from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term) then
    raise exception 'You can ask for an SDP reconsideration only when you first apply.';
  end if;
  v_record := public.renewal_apply(p_window_id, p_school, p_program, p_year_level, p_note);
  if coalesce(p_request_sdp_reconsideration, false) then
    perform public._renewal_sdp_request_create(v_record);
    perform public._renewal_recheck(v_record);
  end if;
  return v_record;
end;
$$;
revoke all on function public.renewal_apply(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.renewal_apply(uuid, text, text, text, text, boolean) to authenticated;

-- Keeps the Scholar List's saved row of one scholar in step with a decision (does nothing if the Scholar List has not been set up).
create or replace function public._renewal_scholar_list_refresh_one(p_scholar_id_number text, p_school_year text, p_term text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev jsonb;
begin
  if to_regclass('public.renewal_scholar_list_cache') is null or to_regprocedure('public._renewal_list_eligibility(jsonb)') is null then return; end if;
  if not exists (select 1 from public.renewal_scholar_list_cache c where c.school_year = p_school_year and c.term = p_term and c.scholar_id_number = p_scholar_id_number) then return; end if;
  ev := public._renewal_evaluate(p_scholar_id_number, p_school_year, p_term);
  update public.renewal_scholar_list_cache c set computed_at = now(),
    sdp_applicable = coalesce((ev -> 'sdp' ->> 'applicable')::boolean, true), sdp_complied = (ev -> 'sdp' ->> 'complied')::boolean, sdp_missing = ev -> 'sdp' ->> 'missing',
    eligibility = public._renewal_list_eligibility(ev)
  where c.school_year = p_school_year and c.term = p_term and c.scholar_id_number = p_scholar_id_number;
end;
$$;
revoke all on function public._renewal_scholar_list_refresh_one(text, text, text) from public, anon, authenticated;

-- The approver's decision.
create or replace function public.renewal_sdp_reconsideration_decide(p_request_id uuid, p_approve boolean, p_note text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.sdp_reconsideration_requests%rowtype;
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
  v_c record;
  v_req jsonb;
  v_lack jsonb;
  v_total integer;
  v_next record;
  v_cat text;
  v_n integer;
  v_text text;
  v_term_label text;
  v_basis_label text;
  v_next_label text;
  v_label text;
  v_stage text;
begin
  if not public.can_decide_sdp_reconsideration() then raise exception 'Only it.admin1 or an appointed approver can decide SDP reconsideration requests.'; end if;
  select * into r from public.sdp_reconsideration_requests where id = p_request_id for update;
  if not found then raise exception 'That request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided.'; end if;
  if not coalesce(p_approve, false) and v_note = '' then raise exception 'Please write the reason for denying the request.'; end if;
  v_label := public._actor_name();
  v_term_label := public._renewal_term_label(r.school_year, r.term);
  v_basis_label := public._renewal_term_label(r.basis_school_year, r.basis_term);
  -- what is lacking NOW (credits may have come in since the request was made)
  select * into v_c from public._sdp_compliance(r.basis_school_year, r.basis_term, r.scholar_id_number) limit 1;
  v_req := public._sdp_required_map(r.scholar_id_number, r.basis_school_year, r.basis_term);
  v_lack := jsonb_build_object(
    'community_service', greatest(0, (v_req ->> 'community_service')::integer - coalesce(v_c.community_service, 0)),
    'community_volunteerism', greatest(0, (v_req ->> 'community_volunteerism')::integer - coalesce(v_c.community_volunteerism, 0)),
    'formation_program', greatest(0, (v_req ->> 'formation_program')::integer - coalesce(v_c.formation_program, 0)));
  v_total := (v_lack ->> 'community_service')::integer + (v_lack ->> 'community_volunteerism')::integer + (v_lack ->> 'formation_program')::integer;
  select n.school_year, n.semester into v_next from public._sdp_next_semester(r.basis_school_year, r.basis_term) n;
  v_next_label := public._renewal_term_label(v_next.school_year, v_next.semester);
  v_text := public._sdp_lacking_text(v_lack);
  select stage into v_stage from public.renewal_records where id = r.record_id;

  if v_total = 0 then
    update public.sdp_reconsideration_requests set status = 'not_needed', decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(),
      decision_note = 'The SDP credits became complete before the request was decided, so no reconsideration was needed.' where id = r.id;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_closed', 'No SDP reconsideration needed',
      'Your SDP credits for ' || v_basis_label || ' are now complete, so your reconsideration request is closed and nothing is added to your next SDP requirement.', r.record_id);
    v_text := 'not_needed';
  elsif coalesce(p_approve, false) then
    update public.sdp_reconsideration_requests set status = 'approved', lacking = v_lack, decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(), decision_note = v_note where id = r.id;
    foreach v_cat in array array['community_service', 'community_volunteerism', 'formation_program'] loop
      v_n := (v_lack ->> v_cat)::integer;
      if v_n > 0 then
        insert into public.sdp_reconsideration_debts (request_id, scholar_id_number, category, amount, apply_school_year, apply_semester)
        values (r.id, r.scholar_id_number, v_cat, v_n, v_next.school_year, v_next.semester);
      end if;
    end loop;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_approved', 'Your SDP reconsideration was approved',
      'Your SDP reconsideration for ' || v_term_label || ' was approved. You are treated as complied with the SDP for ' || v_basis_label || '. The credits that were lacking (' || v_text
      || ') are added to your SDP requirement for ' || v_next_label || '.' || case when v_note <> '' then ' Note: ' || v_note else '' end, r.record_id);
    v_text := 'approved';
  else
    update public.sdp_reconsideration_requests set status = 'denied', decided_by = auth.uid(), decided_by_label = v_label, decided_at = now(), decision_note = v_note where id = r.id;
    perform public._notify_scholar(r.scholar_id_number, 'sdp_reconsideration_denied', 'Your SDP reconsideration was not approved',
      'Your SDP reconsideration for ' || v_term_label || ' was not approved. Reason: ' || v_note || ' Your renewal stays on hold until the missing SDP credits (' || v_text || ') are recorded.', r.record_id);
    v_text := 'denied';
  end if;
  if r.record_id is not null then
    perform public._renewal_log(r.record_id, v_stage, v_stage,
      case v_text when 'approved' then 'SDP reconsideration approved: treated as complied for ' || v_basis_label || '; the lacking credits are added to ' || v_next_label || '.'
                  when 'denied' then 'SDP reconsideration denied: ' || v_note
                  else 'SDP reconsideration closed: the SDP credits are now complete.' end, v_label);
    perform public._renewal_recheck(r.record_id);
  end if;
  perform public._renewal_scholar_list_refresh_one(r.scholar_id_number, r.school_year, r.term);
  return v_text;
end;
$$;
revoke all on function public.renewal_sdp_reconsideration_decide(uuid, boolean, text) from public, anon;
grant execute on function public.renewal_sdp_reconsideration_decide(uuid, boolean, text) to authenticated;

-- The approvers' list (and the evaluator's, read-only), one page at a time. p_status: pending | approved | denied | all (not_needed counts with "all").
create or replace function public.sdp_reconsideration_list(p_status text default 'pending', p_query text default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  id uuid, scholar_id_number text, name text, school text, program text, year_level text, scholar_status text, school_year text, term text, basis_school_year text, basis_term text,
  status text, lacking jsonb, requested_at timestamptz, decided_at timestamptz, decided_by_label text, decision_note text, record_id uuid, previous jsonb,
  next_school_year text, next_semester text, can_decide boolean, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_decide boolean := public.can_decide_sdp_reconsideration();
begin
  if not (public.can_view_renewals() or v_decide) then raise exception 'Not authorized to view SDP reconsideration requests.'; end if;
  return query
  select r.id, r.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.school, s.course, s.year_level, s.status,
         r.school_year, r.term, r.basis_school_year, r.basis_term, r.status, r.lacking, r.requested_at, r.decided_at, r.decided_by_label, r.decision_note, r.record_id,
         coalesce((select jsonb_agg(jsonb_build_object('school_year', o.school_year, 'term', o.term, 'status', o.status, 'lacking', o.lacking, 'decided_at', o.decided_at) order by o.requested_at desc)
                     from public.sdp_reconsideration_requests o where o.scholar_id_number = r.scholar_id_number and o.id <> r.id), '[]'::jsonb),
         nx.school_year, nx.semester, v_decide and r.status = 'pending', count(*) over ()
  from public.sdp_reconsideration_requests r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  cross join lateral public._sdp_next_semester(r.basis_school_year, r.basis_term) nx
  where (coalesce(p_status, 'pending') = 'all' or r.status = coalesce(p_status, 'pending'))
    and (v_q is null or r.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by case when r.status = 'pending' then 0 else 1 end, case when r.status = 'pending' then r.requested_at end asc, r.decided_at desc nulls last, r.requested_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.sdp_reconsideration_list(text, text, integer, integer) from public, anon;
grant execute on function public.sdp_reconsideration_list(text, text, integer, integer) to authenticated;

create or replace function public.sdp_reconsideration_counts()
returns table(pending bigint, approved bigint, denied bigint, can_decide boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.can_view_renewals() or public.can_decide_sdp_reconsideration()) then raise exception 'Not authorized to view SDP reconsideration requests.'; end if;
  return query select count(*) filter (where r.status = 'pending'), count(*) filter (where r.status = 'approved'), count(*) filter (where r.status = 'denied'), public.can_decide_sdp_reconsideration()
  from public.sdp_reconsideration_requests r;
end;
$$;
revoke all on function public.sdp_reconsideration_counts() from public, anon;
grant execute on function public.sdp_reconsideration_counts() to authenticated;

-- One scholar's SDP credits (for the "View SDP credits" buttons): approvers can open it too.
create or replace function public.renewal_scholar_sdp_credits(p_scholar_id_number text, p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b_year text; v_b_term text;
  v_ev jsonb;
begin
  if not (public.can_view_renewals() or public.can_decide_sdp_reconsideration()) then raise exception 'Not authorized to view renewal applications.'; end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  select b.basis_school_year, b.basis_term into v_b_year, v_b_term from public._renewal_basis(p_school_year, p_term) b;
  v_ev := public._renewal_evaluate(p_scholar_id_number, p_school_year, p_term);
  return jsonb_build_object(
    'basis_school_year', v_b_year, 'basis_term', v_b_term, 'required', public.sdp_category_credit_required(),
    'sdp', v_ev -> 'sdp',
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object('activity', coalesce(act.name, '(activity removed)'), 'category', act.category, 'credits', act.credits, 'attended_date', a.attended_date,
                                          'activity_day', a.activity_day, 'school_year', a.school_year, 'semester', a.semester) order by a.attended_date, act.name)
      from public.sdp_attendance a left join public.sdp_activities act on act.id = a.activity_id
      where a.scholar_id_number = p_scholar_id_number and a.school_year = v_b_year and a.semester = v_b_term), '[]'::jsonb),
    'reserved', coalesce((
      select jsonb_agg(jsonb_build_object('category', r.category, 'amount', r.amount, 'from_school_year', r.source_school_year, 'from_semester', r.source_semester, 'claimed', r.claimed,
                                          'claimed_school_year', r.claimed_school_year, 'claimed_semester', r.claimed_semester) order by r.created_at)
      from public.sdp_reserved_credits r where r.scholar_id_number = p_scholar_id_number), '[]'::jsonb));
end;
$$;
revoke all on function public.renewal_scholar_sdp_credits(text, text, text) from public, anon;
grant execute on function public.renewal_scholar_sdp_credits(text, text, text) to authenticated;

notify pgrst, 'reload schema';
