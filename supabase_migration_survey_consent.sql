-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_consent.sql
--
-- Adds an optional "do you agree to participate?" consent gate to
-- surveys (for voluntary client-satisfaction-style feedback, as opposed
-- to the mandatory surveys already built). When a survey has
-- requires_consent = true, the scholar is asked to agree/decline before
-- seeing any real questions:
--   - Agree  -> proceeds through the survey exactly as before; attendance
--               stays gated until every question is answered.
--   - Decline -> the survey is skipped entirely and their attendance is
--               finalized immediately, same as completing it.
--
-- This is a survey-level flag (a checkbox in Survey Tools), not a
-- question stored in research_survey_questions — the consent step needs
-- special behavior (skip everything else, finalize immediately on
-- decline) that a plain multiple_choice/likert question can't express,
-- so encoding it as a fixed modal step keyed off this flag is simpler
-- and less error-prone than inventing a third question type for it.
-- ─────────────────────────────────────────────────────────────

alter table public.research_surveys add column if not exists requires_consent boolean not null default false;
-- Staff-editable wording for the consent prompt — not hardcoded in the
-- frontend, so different surveys can phrase their ask differently
-- ("This is optional feedback about today's session...", etc.).
alter table public.research_surveys add column if not exists consent_text text not null default 'This survey is voluntary. Do you agree to participate?';

alter table public.research_survey_responses drop constraint if exists research_survey_responses_status_check;
alter table public.research_survey_responses add constraint research_survey_responses_status_check
  check (status in ('in_progress', 'completed', 'declined'));
alter table public.research_survey_responses add column if not exists consented boolean;

-- redeem_attendance_code() treats a 'declined' response exactly like a
-- 'completed' one — either way, there's nothing left to gate for this
-- scholar on this survey.
create or replace function public.redeem_attendance_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code public.attendance_codes%rowtype; v_session public.attendance_sessions%rowtype;
  v_scholar public.scholars%rowtype; v_name text; v_updated uuid;
  v_activity_id uuid; v_survey_gate_id uuid;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can redeem attendance codes.'; end if;
  select * into v_code from public.attendance_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid QR code.'; end if;
  if v_code.redeemed_by_scholar_id is not null then raise exception 'This QR code has already been claimed.'; end if;
  select * into v_session from public.attendance_sessions where id = v_code.session_id;
  if v_session.formation_activity_id is not null and not exists (
    select 1 from public.formation_activities a where a.id = v_session.formation_activity_id
    and (a.all_year_levels or v_scholar.year_level = any(a.target_year_levels))
  ) then raise exception 'You are not eligible to attend this activity.'; end if;
  if exists (select 1 from public.attendance_records r where r.session_id = v_session.id and r.scholar_id_number = v_scholar.scholar_id_number and ((v_code.kind = 'time_in' and r.time_in_at is not null) or (v_code.kind = 'time_out' and r.time_out_at is not null) or v_code.kind = 'voucher')) then
    raise exception 'You already completed this attendance requirement.';
  end if;
  -- Atomic claim — unchanged. Must happen before any survey check below.
  update public.attendance_codes set redeemed_by_scholar_id = v_scholar.scholar_id_number, redeemed_at = now() where id = v_code.id and redeemed_by_scholar_id is null returning id into v_updated;
  if v_updated is null then raise exception 'This QR code has already been claimed.'; end if;

  v_survey_gate_id := null;
  if v_code.kind in ('time_out', 'voucher') then
    v_activity_id := coalesce(v_session.sdp_activity_id, v_session.formation_activity_id);
    select id into v_survey_gate_id from public.research_surveys
      where is_active and (sdp_activity_id = v_activity_id or formation_activity_id = v_activity_id);
    if v_survey_gate_id is not null and exists (
      select 1 from public.research_survey_responses r
      where r.survey_id = v_survey_gate_id and r.scholar_id_number = v_scholar.scholar_id_number and r.status in ('completed', 'declined')
    ) then
      v_survey_gate_id := null; -- already resolved this survey (completed or declined) — nothing to gate
    end if;
  end if;

  if v_code.kind = 'time_in' then
    insert into public.attendance_records(session_id,scholar_id_number,time_in_at,status) values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete') on conflict(session_id,scholar_id_number) do update set time_in_at=coalesce(attendance_records.time_in_at,excluded.time_in_at),status=case when attendance_records.time_out_at is null then 'incomplete' else 'present' end,updated_at=now();
  elsif v_code.kind = 'time_out' then
    insert into public.attendance_records(session_id,scholar_id_number,time_out_at,status)
      values(v_session.id,v_scholar.scholar_id_number,now(),'incomplete')
      on conflict(session_id,scholar_id_number) do update
        set time_out_at=coalesce(attendance_records.time_out_at,excluded.time_out_at),
            status=case
              when attendance_records.time_in_at is null then 'incomplete'
              when v_survey_gate_id is not null then 'pending_survey'
              else 'present'
            end,
            pending_survey_id=case when attendance_records.time_in_at is not null then v_survey_gate_id else null end,
            updated_at=now();
  else
    insert into public.attendance_records(session_id,scholar_id_number,hours_earned,status,pending_survey_id)
      values(v_session.id,v_scholar.scholar_id_number,coalesce(v_session.duration_hours,1),
        case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
        v_survey_gate_id)
      on conflict(session_id,scholar_id_number) do update
        set hours_earned=attendance_records.hours_earned+coalesce(v_session.duration_hours,1),
            status=case when v_survey_gate_id is not null then 'pending_survey' else 'present' end,
            pending_survey_id=v_survey_gate_id,
            updated_at=now();
  end if;
  select coalesce(s.name,f.name) into v_name from public.attendance_sessions x left join public.sdp_activities s on s.id=x.sdp_activity_id left join public.formation_activities f on f.id=x.formation_activity_id where x.id=v_session.id;
  return jsonb_build_object('kind',v_code.kind,'activityName',coalesce(v_name,'the activity'),'surveyPending', v_survey_gate_id is not null,'surveyId', v_survey_gate_id);
end; $$;

-- Shared finalization step (survey completed OR declined both release any
-- attendance/voucher this scholar had held open on it) — factored out so
-- submit_survey_response and the new submit_survey_consent don't
-- duplicate the same lock-and-flip loop.
create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rec record; v_count integer := 0;
begin
  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid) from public, anon, authenticated;

-- start_or_resume_survey_response now also reports whether this survey
-- requires consent and, if so, whether/how this scholar already decided,
-- so the modal knows whether to show the consent step before question 1.
create or replace function public.start_or_resume_survey_response(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;

  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;

  insert into public.research_survey_responses (survey_id, scholar_id_number)
    values (p_survey_id, v_scholar.scholar_id_number)
    on conflict (survey_id, scholar_id_number) do update set updated_at = now()
    returning * into v_response;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max,
    'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text) order by c.sort_order), '[]'::jsonb)
      from public.research_survey_choices c where c.question_id = q.id
    )
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from public.research_survey_questions q where q.survey_id = p_survey_id;

  select coalesce(jsonb_agg(jsonb_build_object('questionId', a.question_id, 'choiceId', a.choice_id, 'likertValue', a.likert_value)), '[]'::jsonb)
  into v_answers
  from public.research_survey_answers a where a.response_id = v_response.id;

  return jsonb_build_object(
    'responseId', v_response.id, 'status', v_response.status, 'questions', v_questions, 'answers', v_answers,
    'requiresConsent', v_survey.requires_consent, 'consented', v_response.consented, 'consentText', v_survey.consent_text
  );
end; $$;

/** Records the scholar's agree/decline decision for a consent-gated survey. Declining finalizes immediately (same effect as completing); agreeing just clears the way to answer questions — no finalization yet. */
create or replace function public.submit_survey_consent(p_response_id uuid, p_agree boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_finalized_count integer := 0; v_activity_name text;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;

  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status in ('completed', 'declined') then
    return jsonb_build_object('ok', true, 'declined', v_response.status = 'declined', 'finalizedCount', 0);
  end if;

  select * into v_survey from public.research_surveys where id = v_response.survey_id;
  if not v_survey.requires_consent then raise exception 'This survey does not require consent.'; end if;

  if p_agree then
    update public.research_survey_responses set consented = true, updated_at = now() where id = p_response_id;
    return jsonb_build_object('ok', true, 'declined', false, 'finalizedCount', 0);
  end if;

  update public.research_survey_responses set consented = false, status = 'declined', submitted_at = now(), updated_at = now() where id = p_response_id;
  v_finalized_count := public._finalize_survey_gated_attendance(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id);

  select coalesce(s.name, f.name) into v_activity_name
    from public.research_surveys rs
    left join public.sdp_activities s on s.id = rs.sdp_activity_id
    left join public.formation_activities f on f.id = rs.formation_activity_id
    where rs.id = v_response.survey_id;

  return jsonb_build_object('ok', true, 'declined', true, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;
grant execute on function public.submit_survey_consent(uuid, boolean) to authenticated;

/** Finalizes a survey response: requires every question answered (and, for a consent-gated survey, that the scholar already agreed to participate), marks it completed, then releases any attendance/voucher this scholar was holding open on it. */
create or replace function public.submit_survey_response(p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_question_count integer; v_answer_count integer; v_finalized_count integer;
  v_activity_name text;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can submit surveys.'; end if;

  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then
    return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'finalizedCount', 0);
  end if;
  if v_response.status = 'declined' then raise exception 'You already declined to participate in this survey.'; end if;

  select * into v_survey from public.research_surveys where id = v_response.survey_id;
  if v_survey.requires_consent and coalesce(v_response.consented, false) is not true then
    raise exception 'Please respond to the consent question first.';
  end if;

  select count(*) into v_question_count from public.research_survey_questions where survey_id = v_response.survey_id;
  select count(distinct question_id) into v_answer_count from public.research_survey_answers where response_id = p_response_id;
  if v_answer_count < v_question_count then
    raise exception 'Please answer every question before submitting.';
  end if;

  update public.research_survey_responses set status = 'completed', submitted_at = now(), updated_at = now() where id = p_response_id;

  v_finalized_count := public._finalize_survey_gated_attendance(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id);

  select coalesce(s.name, f.name) into v_activity_name
    from public.research_surveys rs
    left join public.sdp_activities s on s.id = rs.sdp_activity_id
    left join public.formation_activities f on f.id = rs.formation_activity_id
    where rs.id = v_response.survey_id;

  return jsonb_build_object('ok', true, 'alreadyCompleted', false, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;
grant execute on function public.submit_survey_response(uuid) to authenticated;
