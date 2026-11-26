-- undo_survey_credit_fix.sql: puts the survey steps back the way they were before supabase_migration_survey_credit_fix.sql.
-- BE AWARE: this brings the bug back (finishing a survey gives no SDP credit; voluntary surveys stop asking for consent).
-- Credits already given stay. If you ran the restore and want that undone too, run undo_restore_survey_sdp_credits.sql FIRST.
begin;

drop trigger if exists survey_stamp_held on public.attendance_records;
drop function if exists public._survey_stamp_held();
drop function if exists public._survey_restore_plan();

create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
  v_sdp_category text; v_prior_category_credits integer;
  v_school_year text; v_semester text; v_activity_credits integer; v_units integer; v_days date[];
begin
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;

    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null then
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_sdp_activity_id;
      v_prior_category_credits := public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester);
      if v_sdp_category is not null and v_prior_category_credits >= public.sdp_category_credit_goal() then
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        v_units := greatest(coalesce(v_rec.voucher_redemption_count, 0), least(coalesce(v_rec.time_in_count, 0), coalesce(v_rec.time_out_count, 0)), 1);
        v_days := public._sdp_redeemed_days(v_rec.session_id, p_scholar_id_number);
        for v_occurrence in 1..v_units loop
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day)
          values (v_sdp_activity_id, p_scholar_id_number, current_date, null, v_occurrence, v_school_year, v_semester, v_days[v_occurrence])
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid) from public, anon, authenticated;
drop function if exists public._survey_missing_credits(text, uuid, timestamptz);

create or replace function public.submit_survey_response(p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype;
  v_missing_count integer; v_finalized_count integer := 0;
  v_rec record; v_activity_name text;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can submit surveys.'; end if;

  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then
    return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'finalizedCount', 0);
  end if;

  select count(*) into v_missing_count
    from public.research_survey_required_question_ids(p_response_id) req(id)
    where not exists (
      select 1 from public.research_survey_answers a
      where a.response_id = p_response_id and a.question_id = req.id
    );
  if v_missing_count > 0 then
    raise exception 'Please answer every question before submitting.';
  end if;

  update public.research_survey_responses set status = 'completed', submitted_at = now(), updated_at = now() where id = p_response_id;

  for v_rec in
    select * from public.attendance_records where scholar_id_number = v_scholar.scholar_id_number and pending_survey_id = v_response.survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (v_scholar.id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;
    v_finalized_count := v_finalized_count + 1;
  end loop;

  select coalesce(s.name, f.name) into v_activity_name
    from public.research_surveys rs
    left join public.sdp_activities s on s.id = rs.sdp_activity_id
    left join public.formation_activities f on f.id = rs.formation_activity_id
    where rs.id = v_response.survey_id;

  return jsonb_build_object('ok', true, 'alreadyCompleted', false, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;

create or replace function public.start_or_resume_survey_response(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype;
  v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;

  insert into public.research_survey_responses (survey_id, scholar_id_number)
    values (p_survey_id, v_scholar.scholar_id_number)
    on conflict (survey_id, scholar_id_number) do update set updated_at = now()
    returning * into v_response;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max,
    'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'openEndedFormat', q.open_ended_format,
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'choiceText', c.choice_text,
        'skipToQuestionId', c.skip_to_question_id, 'endsSurvey', c.ends_survey
      ) order by c.sort_order), '[]'::jsonb)
      from public.research_survey_choices c where c.question_id = q.id
    )
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from public.research_survey_questions q where q.survey_id = p_survey_id;

  select coalesce(jsonb_agg(jsonb_build_object('questionId', a.question_id, 'choiceId', a.choice_id, 'likertValue', a.likert_value, 'textValue', a.text_value)), '[]'::jsonb)
  into v_answers
  from public.research_survey_answers a where a.response_id = v_response.id;

  return jsonb_build_object('responseId', v_response.id, 'status', v_response.status, 'questions', v_questions, 'answers', v_answers);
end; $$;

alter table public.attendance_records drop column if exists held_at;
alter table public.attendance_records drop column if exists held_school_year;
alter table public.attendance_records drop column if exists held_semester;

do $$
begin
  if to_regprocedure('public._sdp_how_of_source(text)') is not null then
    execute $f$
      create or replace function public._sdp_how_of_source(p_source text) returns text language sql immutable as $b$
        select case p_source when 'scholar_scan' then 'scan' when 'monitor_scan' then 'scan' when 'manual' then 'manual' when 'credit_attended' then 'credit_attended'
                             when 'import' then 'import' when 'progress_picture' then 'picture' else 'other' end;
      $b$
    $f$;
  end if;
end $$;

-- survey_credit_restore_log is kept on purpose: it is the record of what was restored.
notify pgrst, 'reload schema';
commit;
