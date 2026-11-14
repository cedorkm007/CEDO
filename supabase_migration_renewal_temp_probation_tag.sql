-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_temp_probation_tag.sql
-- REGULAR SCHOLARS WITH AN INC OR ONE MISSING GRADE: TEMPORARY PROBATIONARY TAG.   Safe to run twice.   Undo: undo_renewal_temp_probation_tag.sql
--   * While approving the entered grades, the Grades Approver can tag a REGULAR scholar (an INC in any number of subjects, or exactly ONE subject without a grade, and no failed subject)
--     as temporary probationary, with remarks and the number of days to comply.
--   * A tagged scholar sends no documents and has no consultation: the evaluator confirms the renewal. The scholar is renewed as Probationary (temporary) and goes to the Probationary list;
--     the days to comply start on the day of the confirmation.
--   * When the school gives the grade (or the days run out): passed = back to Regular; failed or not complied = stays Probationary. This is checked when grades change and every 5 minutes.
--   * The scholar may leave ONE subject without a grade when entering the grades.
-- Needs supabase_migration_renewal_consultation_endorse.sql. Nothing is deleted; four columns and one item kind are added.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._renewal_evaluate(text,text,text)') is null or position('consult_route' in pg_get_functiondef(to_regprocedure('public._renewal_evaluate(text,text,text)'))) = 0 then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_consultation_endorse.sql first.';
  end if;
end $$;

-- 1. Columns: the tag on the renewal, and the kind of an item (an INC, or a missing grade)
alter table public.renewal_records add column if not exists temp_tag_at timestamptz;
alter table public.renewal_records add column if not exists temp_tag_by uuid references public.users(id) on delete set null;
alter table public.renewal_records add column if not exists temp_tag_remarks text;
alter table public.renewal_records add column if not exists temp_tag_days integer;
alter table public.renewal_inc_items add column if not exists kind text not null default 'inc';
alter table public.renewal_inc_items drop constraint if exists renewal_inc_items_kind_check;
alter table public.renewal_inc_items add constraint renewal_inc_items_kind_check check (kind in ('inc', 'lacking'));
-- an entered line may have NO grade (one subject): the grade check no longer insists on text
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.renewal_self_grade_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%btrim(grade)%' loop
    execute format('alter table public.renewal_self_grade_lines drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.renewal_self_grade_lines drop constraint if exists renewal_self_grade_lines_grade_len_check;
alter table public.renewal_self_grade_lines add constraint renewal_self_grade_lines_grade_len_check check (char_length(grade) <= 12);

-- 2. The new functions

-- The Grades Approver tags a regular scholar (an INC, or exactly one subject without a grade) as TEMPORARY PROBATIONARY, with remarks and the days to comply.
-- When the evaluator confirms the renewal the scholar goes to the Probationary list (temporary); the days start then.
create or replace function public.renewal_tag_temp_probation(p_record_id uuid, p_remarks text, p_days integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  s public.scholars%rowtype;
  sub public.renewal_self_grade_submissions%rowtype;
  l record;
  v_inc integer := 0; v_blank integer := 0; v_failed integer := 0;
  v_remarks text := left(btrim(coalesce(p_remarks, '')), 500);
begin
  if not public.can_approve_scholar_grades() then raise exception 'Only a Grades Approver can tag a scholar as temporary probationary.'; end if;
  select * into r from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if not (public._renewal_is_active_stage(r.stage)) then raise exception 'This renewal is already decided, so it can no longer be tagged.'; end if;
  if r.term = 'Summer' then raise exception 'A Summer renewal cannot be tagged.'; end if;
  if char_length(v_remarks) < 5 then raise exception 'Please write the remarks (at least 5 characters), for example which subject has the INC or no grade.'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'Give the number of days to comply (1 to 365).'; end if;
  select * into s from public.scholars where scholar_id_number = r.scholar_id_number;
  if s.status <> 'Regular' then raise exception 'Only a Regular scholar can be tagged as temporary probationary (this scholar is %).', s.status; end if;
  select * into sub from public.renewal_self_grade_submissions e where e.record_id = r.id and e.status in ('pending', 'approved') order by e.version desc limit 1;
  if not found then raise exception 'This scholar has no entered grades to tag.'; end if;
  for l in select g.grade from public.renewal_self_grade_lines g where g.submission_id = sub.id loop
    case public._grade_outcome(s.school_id, l.grade)
      when 'inc' then v_inc := v_inc + 1;
      when 'ungraded' then v_blank := v_blank + 1;
      when 'failed' then v_failed := v_failed + 1;
      when 'drp' then v_failed := v_failed + 1;
      else null;
    end case;
  end loop;
  if v_failed > 0 then raise exception 'This scholar has a failed subject, so the normal consultation route applies (a tag is only for an INC or one missing grade).'; end if;
  if v_blank > 1 then raise exception 'This scholar lacks grades in % subjects. Only one missing grade can be tagged.', v_blank; end if;
  if v_inc = 0 and v_blank = 0 then raise exception 'There is no INC and no missing grade in the entered grades, so there is nothing to tag.'; end if;
  update public.renewal_records set temp_tag_at = now(), temp_tag_by = auth.uid(), temp_tag_remarks = v_remarks, temp_tag_days = p_days, updated_at = now() where id = r.id;
  perform public._renewal_log(r.id, r.stage, r.stage, 'Tagged as temporary probationary by the Grades Approver (' || p_days || ' days to comply): ' || v_remarks, public._actor_name());
  perform public._renewal_recheck(r.id);
end;
$$;
revoke all on function public.renewal_tag_temp_probation(uuid, text, integer) from public, anon;
grant execute on function public.renewal_tag_temp_probation(uuid, text, integer) to authenticated;

create or replace function public.renewal_untag_temp_probation(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  if not (public.can_approve_scholar_grades() or public.is_renewal_evaluator()) then raise exception 'Only a Grades Approver or the evaluator can remove the tag.'; end if;
  select * into r from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if r.temp_tag_at is null then return; end if;
  if r.stage = 'renewed' then raise exception 'The scholar is already renewed on temporary probation, so the tag cannot be removed.'; end if;
  update public.renewal_records set temp_tag_at = null, temp_tag_by = null, temp_tag_remarks = null, temp_tag_days = null, updated_at = now() where id = r.id;
  perform public._renewal_log(r.id, r.stage, r.stage, 'The temporary probation tag was removed.', public._actor_name());
  perform public._renewal_recheck(r.id);
end;
$$;
revoke all on function public.renewal_untag_temp_probation(uuid) from public, anon;
grant execute on function public.renewal_untag_temp_probation(uuid) to authenticated;

-- The evaluator confirmed a tagged renewal: the scholar is renewed, goes to the Probationary list as TEMPORARY, and the days to comply start now.
create or replace function public._renewal_tag_apply(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_prev text;
  v_until date;
  v_subjects text;
  v_label text;
begin
  select * into r from public.renewal_records where id = p_record_id for update;
  select s.status into v_prev from public.scholars s where s.scholar_id_number = r.scholar_id_number;
  v_until := (now() at time zone 'Asia/Manila')::date + r.temp_tag_days;
  v_label := public._renewal_term_label(r.school_year, r.term);
  perform public._renewal_set_status(r.scholar_id_number, 'Probationary', true, 'Temporary probation (tagged by the Grades Approver) for the renewal of ' || v_label || ': ' || coalesce(r.temp_tag_remarks, ''));
  update public.renewal_records set temp_probation = true, temp_previous_status = v_prev, result = 'renewed_probationary', updated_at = now() where id = r.id;
  update public.renewal_inc_items set days_given = r.temp_tag_days, deadline = v_until, updated_at = now() where record_id = r.id and state = 'open';
  select string_agg(i.subject_code || ' ' || i.subject, ', ') into v_subjects from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open';
  perform public._renewal_log(r.id, 'ready_for_confirmation', 'renewed', 'Renewal confirmed as Probationary (temporary): ' || r.temp_tag_days || ' days (until ' || to_char(v_until, 'Mon DD, YYYY') || ') to comply with ' || coalesce(v_subjects, 'the INC / missing grade') || '.' || coalesce(' ' || r.evaluator_comment, ''));
  perform public._notify_scholar(r.scholar_id_number, 'renewal_confirmed', 'You are renewed on temporary probation',
    'You are renewed for ' || v_label || ' as a Probationary scholar for now. You have ' || r.temp_tag_days || ' days (until ' || to_char(v_until, 'Mon DD, YYYY') || ') to comply with ' || coalesce(v_subjects, 'your INC / missing grade')
    || '. If you pass, you go back to Regular. If you fail or do not comply in time, you stay Probationary.', r.id);
end;
$$;
revoke all on function public._renewal_tag_apply(uuid) from public, anon, authenticated;

-- After the renewal: when the school gives the grade (or the days run out) the open INC / missing grade is settled, and the scholar goes back to Regular (passed) or stays Probationary (failed / not complied).
create or replace function public._renewal_tag_followup(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  it record;
  v_school uuid;
  v_out text;
  v_state text;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_failed boolean;
  v_label text;
begin
  select * into r from public.renewal_records where id = p_record_id and stage = 'renewed' and temp_probation and temp_tag_at is not null for update;
  if not found then return; end if;
  select s.school_id into v_school from public.scholars s where s.scholar_id_number = r.scholar_id_number;
  v_label := public._renewal_term_label(r.school_year, r.term);
  for it in select * from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' loop
    select public._grade_outcome(coalesce(g.recorded_by_school_id, v_school), g.grade) into v_out
    from public.scholar_subjects_grades g
    where g.scholar_id_number = r.scholar_id_number and g.school_year = r.basis_school_year and g.semester = r.basis_term and g.subject_code = it.subject_code
    order by g.updated_at desc limit 1;
    v_state := case v_out when 'passed' then 'resolved_passed' when 'failed' then 'resolved_failed' when 'drp' then 'resolved_failed' else null end;
    if v_state is null and it.deadline is not null and it.deadline < v_today then v_state := 'counted_failed'; end if;
    if v_state is not null then
      update public.renewal_inc_items set state = v_state, updated_at = now() where id = it.id;
      perform public._renewal_log(r.id, r.stage, r.stage,
        case v_state when 'resolved_passed' then 'The ' || case it.kind when 'lacking' then 'missing grade' else 'INC' end || ' in ' || it.subject_code || ' was passed.'
                     when 'resolved_failed' then 'The ' || case it.kind when 'lacking' then 'missing grade' else 'INC' end || ' in ' || it.subject_code || ' turned out as a failed grade.'
                     else 'The days to comply ran out: ' || it.subject_code || ' is counted as failed.' end, 'System');
    end if;
  end loop;
  if exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open') then return; end if;
  v_failed := exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state in ('resolved_failed', 'counted_failed'));
  if v_failed then
    perform public._renewal_set_status(r.scholar_id_number, 'Probationary', false, 'The INC / missing grade of ' || v_label || ' was failed or not complied in time: the scholar stays Probationary.');
    perform public._notify_scholar(r.scholar_id_number, 'progress', 'You stay on Probationary status',
      'Your INC / missing grade for ' || v_label || ' was not passed (or the days ran out), so you stay on Probationary status.', r.id);
    perform public._renewal_log(r.id, r.stage, r.stage, 'Temporary probation ended: the scholar stays Probationary.', 'System');
  else
    perform public._renewal_set_status(r.scholar_id_number, coalesce(r.temp_previous_status, 'Regular'), false, 'The INC / missing grade of ' || v_label || ' was passed: back to ' || coalesce(r.temp_previous_status, 'Regular') || '.');
    perform public._notify_scholar(r.scholar_id_number, 'progress', 'You are back to Regular',
      'You complied and passed your INC / missing grade for ' || v_label || '. Your status is Regular again.', r.id);
    perform public._renewal_log(r.id, r.stage, r.stage, 'Temporary probation ended: the grade was passed and the scholar is back to ' || coalesce(r.temp_previous_status, 'Regular') || '.', 'System');
  end if;
  update public.renewal_records set temp_probation = false, temp_previous_status = null, updated_at = now() where id = r.id;
end;
$$;
revoke all on function public._renewal_tag_followup(uuid) from public, anon, authenticated;

create or replace function public.renewal_tag_followup_all()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select x.id from public.renewal_records x where x.stage = 'renewed' and x.temp_probation and x.temp_tag_at is not null loop
    perform public._renewal_tag_followup(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.renewal_tag_followup_all() from public, anon, authenticated;

-- 3. The rules, the re-check and the confirmation know about the tag
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
  v_c := (v_failed_eff >= 2) or (v_failed_eff = 1 and v_prev);
  v_b := (v_failed_eff = 1 and not v_prev);
  v_consult_done := v_rec.consultation_done_at is not null;
  v_hard_copy := v_rec.hard_copy_received_at is not null;
  -- a case the Division Head already has (or had) keeps the old route; every other case with a failed subject / DRP follows the consultation staff's endorsement
  v_legacy := v_rec.id is not null and exists (select 1 from public.scholar_counseling_referrals f where f.renewal_record_id = v_rec.id);

  -- Documents this case needs (independent of the stage, so a scholar can see what is coming).
  if v_state = 'ready' then
    -- a scholar with a failed subject (one or two or more) or an INC sends the three documents: the letter from the dean, the study plan and the clearance
    -- (a tagged scholar with only an INC / one missing grade sends no documents and has no consultation: the evaluator renews them as temporary probationary)
    v_need_study := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
    v_need_inc := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
    v_need_clear := v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag);
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

  v_consult_required := (v_state = 'ready') and (v_failed_eff >= 1 or (v_inc_open > 0 and not v_tag) or v_summer);

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
  elsif v_tag and v_inc_open > 0 and not v_summer then
    v_stage := 'ready_for_confirmation';
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
    'temp_tag', v_tag, 'previous_probation', v_prev, 'failed_effective', v_failed_eff, 'open_inc', v_inc_open,
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
    and v_rec.temp_tag_at is null
    and exists (select 1 from public.renewal_tagged_scholars t where t.scholar_id_number = v_rec.scholar_id_number and t.school_year = v_rec.school_year and t.term = v_rec.term);
  v_term_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  -- INC items: one per INC subject; settled when the school enters the completed grade.
  for v_item in select * from jsonb_array_elements(v_ev -> 'grades' -> 'inc_subjects') loop
    insert into public.renewal_inc_items (record_id, scholar_id_number, subject_code, subject, kind)
    values (v_rec.id, v_rec.scholar_id_number, v_item ->> 'code', v_item ->> 'subject', coalesce(v_item ->> 'kind', 'inc'))
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
  -- (a scholar tagged by the Grades Approver is put on temporary probation when the renewal is CONFIRMED, not now)
  if v_inc_open > 0 and not v_rec.temp_probation and v_rec.temp_tag_at is null and v_scholar.status in ('Regular', 'Reconsidered') and v_new_stage <> 'sdp_on_hold' and v_new_stage <> 'waiting_grades' then
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

create or replace function public.renewal_confirm(p_record_id uuid, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.renewal_records%rowtype;
  v_label text;
begin
  perform public._renewal_require_evaluator();
  select * into v_rec from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if v_rec.stage = 'ready_to_endorse' then raise exception 'A case with a failed subject is endorsed to the Division Head, not confirmed by the evaluator.'; end if;
  if v_rec.stage <> 'ready_for_confirmation' then raise exception 'This renewal is not ready for confirmation yet (%).', public._renewal_stage_title(v_rec.stage); end if;
  -- Make sure the answer is still right at this moment.
  perform public._renewal_recheck(p_record_id);
  select * into v_rec from public.renewal_records where id = p_record_id;
  if v_rec.stage <> 'ready_for_confirmation' then raise exception 'Something changed just now: this renewal is now "%".', public._renewal_stage_title(v_rec.stage); end if;
  v_label := public._renewal_term_label(v_rec.school_year, v_rec.term);

  update public.renewal_records set stage = 'renewed', result = 'renewed',
    confirmed_at = now(), confirmed_by = auth.uid(), evaluator_comment = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
  where id = p_record_id;
  if v_rec.temp_tag_at is not null and exists (select 1 from public.renewal_inc_items i where i.record_id = p_record_id and i.state = 'open') then
    perform public._renewal_tag_apply(p_record_id);
    return;      -- the log and the notice to the scholar are made there
  end if;
  perform public._renewal_log(p_record_id, 'ready_for_confirmation', 'renewed',
    'Renewal confirmed.' || case when btrim(coalesce(p_note, '')) <> '' then ' ' || btrim(p_note) else '' end);
  perform public._notify_scholar(v_rec.scholar_id_number, 'renewal_confirmed', 'Your renewal is confirmed',
    'You are renewed for ' || v_label || '. Your Certificate of Scholarship Renewal will be available here once certificates are switched on.', p_record_id);
end;
$$;
revoke all on function public.renewal_confirm(uuid, text) from public, anon;
grant execute on function public.renewal_confirm(uuid, text) to authenticated;

-- 4. The scholar may leave ONE subject without a grade; the Grades Approver may tag while approving
create or replace function public._eg_save(p_record_id uuid, p_lines jsonb, p_files jsonb, p_acknowledged boolean, p_extra_prefix text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  rec public.renewal_records%rowtype;
  v_why text;
  v_ver integer;
  v_sub uuid;
  l jsonb;
  f jsonb;
  v_code text; v_name text; v_grade text; v_units numeric; v_gerr text; v_school uuid; v_mark boolean := false;
  v_seen text[] := '{}';
  v_prefix text;
  v_n integer;
  v_label text;
  v_blank integer := 0;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into rec from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  v_why := public._eg_cannot_enter(p_record_id);
  if v_why is not null then raise exception '%', v_why; end if;
  if not coalesce(p_acknowledged, false) then raise exception 'Please tick the box to say you understand that wrong or false information means disciplinary action or removal from the scholarship.'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Enter at least one subject.'; end if;
  if jsonb_array_length(p_lines) > 25 then raise exception 'You can enter at most 25 subjects.'; end if;
  select s.school_id into v_school from public.scholars s join public.school_grading_configs c on c.school_id = s.school_id where s.scholar_id_number = v_id;      -- null when the school has no grading setup yet: then the scale is not checked
  for l in select * from jsonb_array_elements(p_lines) loop
    v_code := btrim(coalesce(l ->> 'code', '')); v_name := btrim(coalesce(l ->> 'subject', '')); v_grade := btrim(coalesce(l ->> 'grade', ''));
    if v_code = '' or v_name = '' then raise exception 'Every subject needs a subject code and a subject name.'; end if;
    -- ONE subject may have no grade yet (a lacking grade): the Grades Approver can tag the scholar as temporary probationary
    if v_grade = '' then v_blank := v_blank + 1; if v_blank > 1 then raise exception 'Only ONE subject can be left without a grade. Type the grade of the others.'; end if; end if;
    if char_length(v_code) > 30 or char_length(v_name) > 150 or char_length(v_grade) > 12 then raise exception 'A subject code, name or grade is too long.'; end if;
    -- (one of the school's own marks, such as "D/F", may contain a symbol: it is judged by the school's rules, not by the symbol rule)
    if v_grade = '' then
      null;
    else
    v_mark := v_school is not null and exists (select 1 from public.school_marks m where m.school_id = v_school and lower(btrim(m.mark)) = lower(v_grade));
    if v_school is not null and (v_mark or v_grade ~ '^[A-Za-z0-9. ]+$') then
      -- the school's own rules (its scale, letters and other marks): a grade that is not allowed is refused with the school's own words
      v_gerr := public._school_grade_error(v_school, public._tidy_grade(v_grade));
      if v_gerr is not null then raise exception '%', v_gerr; end if;
    end if;
    if v_grade !~ '^[A-Za-z0-9. ]+$' and not v_mark then raise exception 'The grade "%" has a symbol that is not allowed. Use only letters, numbers and a period (for example 1.5, 2.25 or INC). Write the decimal point as a period, not a comma.', v_grade; end if;
    end if;
    begin v_units := (l ->> 'units')::numeric; exception when others then v_units := null; end;
    if v_units is null or v_units <= 0 or v_units > 20 then raise exception 'The units of % must be a number from 0.5 to 20.', v_code; end if;
    if upper(v_code) = any (v_seen) then raise exception 'The subject code % is listed twice.', v_code; end if;
    v_seen := v_seen || upper(v_code);
  end loop;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then raise exception 'Upload at least one screenshot or image of your grades.'; end if;
  if jsonb_array_length(p_files) > 5 then raise exception 'You can upload at most 5 images.'; end if;
  v_prefix := v_id || '/' || p_record_id::text || '/grade-entries/';
  for f in select * from jsonb_array_elements(p_files) loop
    if left(coalesce(f ->> 'path', ''), char_length(v_prefix)) <> v_prefix and (p_extra_prefix is null or left(coalesce(f ->> 'path', ''), char_length(p_extra_prefix)) <> p_extra_prefix) then raise exception 'An image is not in your own folder. Please upload it again.'; end if;
    if coalesce(f ->> 'mime', '') not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Only JPG, PNG or WEBP images can be uploaded.'; end if;
    if coalesce((f ->> 'size')::bigint, 0) <= 0 or (f ->> 'size')::bigint > 10485760 then raise exception 'An image is too big (10 MB at most).'; end if;
  end loop;

  select coalesce(max(version), 0) + 1 into v_ver from public.renewal_self_grade_submissions where record_id = p_record_id;
  update public.renewal_self_grade_submissions set status = 'superseded' where record_id = p_record_id and status in ('pending', 'returned');
  insert into public.renewal_self_grade_submissions (record_id, scholar_id_number, school_year, term, basis_school_year, basis_term, version, acknowledged_at)
  values (rec.id, rec.scholar_id_number, rec.school_year, rec.term, rec.basis_school_year, rec.basis_term, v_ver, now())
  returning id into v_sub;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.renewal_self_grade_lines (submission_id, subject_code, subject, units, grade)
    values (v_sub, btrim(l ->> 'code'), btrim(l ->> 'subject'), (l ->> 'units')::numeric, coalesce(public._tidy_grade(l ->> 'grade'), ''));
  end loop;
  for f in select * from jsonb_array_elements(p_files) loop
    insert into public.renewal_self_grade_files (submission_id, storage_path, file_name, mime_type, size_bytes)
    values (v_sub, f ->> 'path', left(coalesce(f ->> 'name', 'image'), 200), f ->> 'mime', (f ->> 'size')::bigint);
  end loop;
  v_n := jsonb_array_length(p_lines);
  v_label := public._renewal_term_label(rec.basis_school_year, rec.basis_term);
  perform public._notify_scholar(v_id, 'grades_entry_submitted', 'Your grades were sent for approval',
    'You entered ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' for ' || v_label || '. The Grades Approver will check them against your screenshot. Until then your renewal waits. When your school uploads its grades, they replace the ones you entered.', rec.id);
  if not public._tag_is_auto_approve(rec.scholar_id_number, rec.school_year, rec.term) then
    perform public._eg_notify_approvers('Entered grades to approve', public._renewal_scholar_label(v_id) || ' entered ' || v_n || ' subject' || case when v_n = 1 then '' else 's' end || ' for ' || v_label || '.', rec.id, public._renewal_scholar_label(v_id));
  end if;
  perform public._renewal_log(rec.id, rec.stage, rec.stage, 'The scholar entered grades for ' || v_label || ' (try ' || v_ver || ') and sent them for approval.', 'Scholar');
  -- a scholar tagged for automatic renewal WITH auto-approve: the entered grades are approved by the system right away (see _tag_auto_approve_submission)
  perform public._tag_auto_approve_submission(v_sub);
  perform public._renewal_recheck(rec.id);
  return v_sub;
end;
$$;
revoke all on function public._eg_save(uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;

drop function if exists public.renewal_self_grades_decide(uuid, boolean, text);
create or replace function public.renewal_self_grades_decide(p_submission_id uuid, p_approve boolean, p_note text default '', p_tag boolean default false, p_tag_remarks text default '', p_tag_days integer default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec uuid;
begin
  if not public.can_approve_scholar_grades() then raise exception 'Only a Grades Approver can approve or return entered grades.'; end if;
  if coalesce(p_approve, false) and coalesce(p_tag, false) then
    select s.record_id into v_rec from public.renewal_self_grade_submissions s where s.id = p_submission_id and s.status = 'pending';
    if v_rec is null then raise exception 'This submission was already decided or replaced.'; end if;
    perform public.renewal_tag_temp_probation(v_rec, p_tag_remarks, p_tag_days);
  end if;
  return public._eg_decide_core(p_submission_id, p_approve, p_note, public._actor_name(), auth.uid());
end;
$$;
revoke all on function public.renewal_self_grades_decide(uuid, boolean, text, boolean, text, integer) from public, anon;
grant execute on function public.renewal_self_grades_decide(uuid, boolean, text, boolean, text, integer) to authenticated;

-- 5. Follow-up: when grades change, and every 5 minutes (the scheduled job that already exists)
create or replace function public._renewal_recheck_scholar(p_scholar_id_number text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_closed integer;
begin
  v_closed := public._sdp_close_unneeded_requests(p_scholar_id_number);
  for r in select id from public.renewal_records where scholar_id_number = p_scholar_id_number loop
    perform public._renewal_recheck(r.id);
    perform public._renewal_tag_followup(r.id);      -- a scholar renewed on temporary probation: the school's grade may have just arrived
  end loop;
  if v_closed > 0 then
    perform public._renewal_scholar_list_refresh_one(p_scholar_id_number, q.school_year, q.term) from public.sdp_reconsideration_requests q
      where q.scholar_id_number = p_scholar_id_number and q.status = 'not_needed' and q.decided_by_label = 'System' and q.decided_at > now() - interval '1 minute';
  end if;
end;
$$;
revoke all on function public._renewal_recheck_scholar(text) from public, anon, authenticated;

create or replace function public.renewal_run_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.renewal_tag_followup_all();      -- temporary probation: grades that arrived, days that ran out
  return public.renewal_scheduled_jobs() || public.renewal_notification_jobs();
end;
$$;
revoke all on function public.renewal_run_scheduled_jobs() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
