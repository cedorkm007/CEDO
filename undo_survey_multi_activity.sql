-- undo_survey_multi_activity.sql: back to one activity per survey (the way it was after Phase 2).
-- IT STOPS, CHANGING NOTHING, if any scholar has answered the same survey for two different activities: those cannot be merged.
-- WHAT IT KEEPS: every answer, and the list of attachments (so Phase 3 can be run again). A survey attached to several activities keeps only the first.
-- WHAT COMES BACK: deleting an activity deletes its survey and answers again.
begin;

do $$ begin
  if exists (select 1 from public.research_survey_responses group by survey_id, scholar_id_number having count(*) > 1) then
    raise exception 'STOPPED, nothing changed: some scholars answered the same survey for more than one activity. The undo cannot merge those answers.';
  end if;
end $$;

drop trigger if exists survey_columns_changed on public.research_surveys;
drop trigger if exists survey_activity_deleted on public.sdp_activities;
drop trigger if exists survey_activity_deleted on public.formation_activities;
drop function if exists public._survey_columns_changed();
drop function if exists public._survey_activity_deleted();
drop function if exists public.survey_save(uuid, text, text, boolean, text, jsonb);
drop function if exists public.survey_activity_options();
drop function if exists public.survey_for_activity(uuid);
drop function if exists public._survey_attach(uuid, text, uuid);
drop function if exists public._survey_detach(uuid, uuid);
drop function if exists public._survey_mirror_primary(uuid);

-- one response per scholar per survey again
drop index if exists public.research_survey_responses_per_activity;
create unique index if not exists research_survey_responses_survey_id_scholar_id_number_key on public.research_survey_responses (survey_id, scholar_id_number);

-- the survey goes with its activity again
do $$
declare v record;
begin
  for v in
    select c.conname, a.attname, c.confrelid::regclass::text as target
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.research_surveys'::regclass and c.contype = 'f' and a.attname in ('sdp_activity_id', 'formation_activity_id') and c.confdeltype = 'n'
  loop
    execute format('alter table public.research_surveys drop constraint %I', v.conname);
    execute format('alter table public.research_surveys add constraint %I foreign key (%I) references %s(id) on delete cascade', v.conname, v.attname, v.target);
  end loop;
end $$;
-- surveys left with no activity are kept (the old "exactly one" rule is only restored when every survey has one)
do $$ begin
  if not exists (select 1 from public.research_surveys where num_nonnulls(sdp_activity_id, formation_activity_id, quest_subject_id) <> 1) then
    alter table public.research_surveys drop constraint if exists research_surveys_exactly_one_activity;
    alter table public.research_surveys add constraint research_surveys_exactly_one_activity check (num_nonnulls(sdp_activity_id, formation_activity_id, quest_subject_id) = 1);
  end if;
end $$;

-- the attendance function asks the old columns again
do $patch$
declare v_fn regprocedure; v_def text;
begin
  v_fn := coalesce(to_regprocedure('public._apply_attendance(uuid,text,text,date,text)'), to_regprocedure('public._apply_attendance(uuid,text,text,date)'), to_regprocedure('public._apply_attendance(uuid,text,text)'));
  v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
  if position('v_survey_gate_id := public._survey_gate(v_activity_id, p_scholar_id_number);' in v_def) = 0 then return; end if;
  execute replace(v_def, 'v_survey_gate_id := public._survey_gate(v_activity_id, p_scholar_id_number);', $old$select id into v_survey_gate_id from public.research_surveys
      where is_active and (sdp_activity_id = v_activity_id or formation_activity_id = v_activity_id);
    if v_survey_gate_id is not null and exists (
      select 1 from public.research_survey_responses r
      where r.survey_id = v_survey_gate_id and r.scholar_id_number = p_scholar_id_number and r.status in ('completed', 'declined')
    ) then
      v_survey_gate_id := null; -- already resolved this survey (completed or declined) — nothing to gate
    end if;$old$);
end
$patch$;
drop function if exists public._survey_gate(uuid, text);

-- the Phase 1 / Phase 2 versions of the other steps
drop function if exists public.start_or_resume_survey_response(uuid, uuid);
create or replace function public.start_or_resume_survey_response(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_sections jsonb; v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;
  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;
  insert into public.research_survey_responses (survey_id, scholar_id_number)
    values (p_survey_id, v_scholar.scholar_id_number)
    on conflict (survey_id, scholar_id_number) do update set updated_at = now()
    returning * into v_response;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description) order by s.sort_order), '[]'::jsonb) into v_sections
  from public.research_survey_sections s
  where s.survey_id = p_survey_id and s.removed_at is null
    and exists (select 1 from public.research_survey_questions q where q.section_id = s.id and q.removed_at is null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'questionType', q.question_type, 'questionText', q.question_text, 'sortOrder', q.sort_order,
    'sectionId', q.section_id, 'isOptional', q.is_optional,
    'likertScaleMin', q.likert_scale_min, 'likertScaleMax', q.likert_scale_max,
    'likertMinLabel', q.likert_min_label, 'likertMaxLabel', q.likert_max_label,
    'openEndedFormat', q.open_ended_format,
    'choices', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text, 'skipToQuestionId', t.target_id, 'endsSurvey', t.ends) order by c.sort_order, c.created_at), '[]'::jsonb)
      from public.research_survey_choices c cross join lateral public._survey_choice_target(c.id) t
      where c.question_id = q.id and c.removed_at is null
    )
  ) order by q.sort_order), '[]'::jsonb)
  into v_questions
  from public.research_survey_questions q where q.survey_id = p_survey_id and q.removed_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('questionId', a.question_id, 'choiceId', a.choice_id, 'likertValue', a.likert_value, 'textValue', a.text_value)), '[]'::jsonb)
  into v_answers
  from public.research_survey_answers a
  join public.research_survey_questions q on q.id = a.question_id and q.removed_at is null
  left join public.research_survey_choices c on c.id = a.choice_id
  where a.response_id = v_response.id and c.removed_at is null;
  return jsonb_build_object('responseId', v_response.id, 'status', v_response.status, 'sections', v_sections, 'questions', v_questions, 'answers', v_answers,
    'requiresConsent', v_survey.requires_consent, 'consented', v_response.consented, 'consentText', v_survey.consent_text);
end; $$;
revoke all on function public.start_or_resume_survey_response(uuid) from public, anon;
grant execute on function public.start_or_resume_survey_response(uuid) to authenticated;

drop function if exists public._survey_release_on_deactivate() cascade;
drop function if exists public._survey_release(uuid, uuid);
drop function if exists public._finalize_survey_gated_attendance(uuid, text, uuid, uuid);
create or replace function public._finalize_survey_gated_attendance(p_scholar_id uuid, p_scholar_id_number text, p_survey_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rec record; v_item record; v_count integer := 0; v_sdp_activity_id uuid; v_occurrence integer;
  v_sdp_category text; v_activity_credits integer;
  v_current_year text; v_current_semester text; v_school_year text; v_semester text;
begin
  select gps.current_school_year, gps.current_semester into v_current_year, v_current_semester
    from public.grading_period_settings gps where gps.id = true;
  for v_rec in
    select * from public.attendance_records where scholar_id_number = p_scholar_id_number and pending_survey_id = p_survey_id for update
  loop
    update public.attendance_records set status = 'present', pending_survey_id = null, updated_at = now() where session_id = v_rec.session_id and scholar_id_number = v_rec.scholar_id_number;
    insert into public.scholar_attendance_finalized_notifications (scholar_id, session_id, scholar_id_number)
      values (p_scholar_id, v_rec.session_id, v_rec.scholar_id_number)
      on conflict (session_id, scholar_id_number) do nothing;
    select sdp_activity_id into v_sdp_activity_id from public.attendance_sessions where id = v_rec.session_id;
    if v_sdp_activity_id is not null and exists (select 1 from public._survey_missing_credits(p_scholar_id_number, v_rec.session_id)) then
      v_school_year := coalesce(nullif(v_rec.held_school_year, ''), v_current_year);
      v_semester := coalesce(nullif(v_rec.held_semester, ''), v_current_semester);
      select category, credits into v_sdp_category, v_activity_credits from public.sdp_activities where id = v_sdp_activity_id;
      if v_sdp_category is not null and public._sdp_period_credits(p_scholar_id_number, v_sdp_category, v_school_year, v_semester) >= public.sdp_category_credit_goal() then
        insert into public.sdp_reserved_credits (scholar_id_number, category, amount, source_school_year, source_semester)
        values (p_scholar_id_number, v_sdp_category, coalesce(v_activity_credits, 1), v_school_year, v_semester);
      else
        for v_item in select * from public._survey_missing_credits(p_scholar_id_number, v_rec.session_id) loop
          select coalesce(max(c.occurrence_number), 0) + 1 into v_occurrence from public.sdp_attendance c where c.activity_id = v_sdp_activity_id and c.scholar_id_number = p_scholar_id_number;
          insert into public.sdp_attendance (activity_id, scholar_id_number, attended_date, created_by, occurrence_number, school_year, semester, activity_day, activity_sid)
          values (v_sdp_activity_id, p_scholar_id_number, v_item.scan_date, null, v_occurrence, v_school_year, v_semester, v_item.day, v_item.sid)
          on conflict (activity_id, scholar_id_number, occurrence_number) do nothing;
        end loop;
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $function$;
revoke all on function public._finalize_survey_gated_attendance(uuid, text, uuid) from public, anon, authenticated;

create or replace function public._survey_release_on_deactivate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if old.is_active and not new.is_active then
    perform set_config('app.sdp_source', 'survey_released', true);
    for v in select distinct s.id, a.scholar_id_number from public.attendance_records a join public.scholars s on s.scholar_id_number = a.scholar_id_number where a.pending_survey_id = new.id loop
      perform public._finalize_survey_gated_attendance(v.id, v.scholar_id_number, new.id);
    end loop;
    perform set_config('app.sdp_source', '', true);
  end if;
  return null;
end; $$;
revoke all on function public._survey_release_on_deactivate() from public, anon, authenticated;
create trigger survey_release_on_deactivate after update of is_active on public.research_surveys for each row execute function public._survey_release_on_deactivate();

create or replace function public.submit_survey_response(p_response_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_missing_count integer; v_finalized_count integer; v_activity_name text;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can submit surveys.'; end if;
  select * into v_response from public.research_survey_responses where id = p_response_id for update;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then return jsonb_build_object('ok', true, 'alreadyCompleted', true, 'finalizedCount', 0); end if;
  if v_response.status = 'declined' then raise exception 'You already declined to participate in this survey.'; end if;
  select * into v_survey from public.research_surveys where id = v_response.survey_id;
  if v_survey.requires_consent and coalesce(v_response.consented, false) is not true then raise exception 'Please respond to the consent question first.'; end if;
  select count(*) into v_missing_count
    from public.research_survey_required_question_ids(p_response_id) req(id)
    where not exists (
      select 1 from public.research_survey_answers a left join public.research_survey_choices c on c.id = a.choice_id
      where a.response_id = p_response_id and a.question_id = req.id and c.removed_at is null
    );
  if v_missing_count > 0 then raise exception 'Please answer every question before submitting.'; end if;
  update public.research_survey_responses set status = 'completed', submitted_at = now(), updated_at = now() where id = p_response_id;
  v_finalized_count := public._finalize_survey_gated_attendance(v_scholar.id, v_scholar.scholar_id_number, v_response.survey_id);
  select coalesce(s.name, f.name) into v_activity_name
    from public.research_surveys rs
    left join public.sdp_activities s on s.id = rs.sdp_activity_id
    left join public.formation_activities f on f.id = rs.formation_activity_id
    where rs.id = v_response.survey_id;
  return jsonb_build_object('ok', true, 'alreadyCompleted', false, 'finalizedCount', v_finalized_count, 'activityName', coalesce(v_activity_name, 'the activity'));
end; $$;

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

drop function if exists public.research_survey_question_results(uuid, uuid);
create or replace function public.research_survey_question_results(p_question_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_question public.research_survey_questions%rowtype; v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  select * into v_question from public.research_survey_questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;
  if v_question.question_type = 'multiple_choice' then
    select jsonb_agg(jsonb_build_object('choiceId', c.id, 'choiceText', c.choice_text, 'count', coalesce(cnt.n, 0), 'removed', c.removed_at is not null, 'removedReason', c.removed_reason) order by c.removed_at is not null, c.sort_order, c.created_at)
    into v_result
    from public.research_survey_choices c
    left join (select choice_id, count(*) n from public.research_survey_answers where question_id = p_question_id group by choice_id) cnt on cnt.choice_id = c.id
    where c.question_id = p_question_id and (c.removed_at is null or coalesce(cnt.n, 0) > 0);
  elsif v_question.question_type = 'open_ended' then
    select jsonb_build_object('texts', coalesce(jsonb_agg(text_value order by answered_at), '[]'::jsonb)) into v_result
    from public.research_survey_answers where question_id = p_question_id;
  else
    select jsonb_build_object('n', stats.n, 'mean', stats.mean, 'median', stats.median, 'stddev', stats.stddev, 'distribution', dist.distribution) into v_result
    from (
      select count(*) n, avg(likert_value) mean, percentile_cont(0.5) within group (order by likert_value) median, stddev_samp(likert_value) stddev
      from public.research_survey_answers where question_id = p_question_id
    ) stats,
    (
      select jsonb_agg(jsonb_build_object('value', pt, 'count', coalesce(a.cnt, 0),
        'percentage', case when stats2.n > 0 then round(coalesce(a.cnt, 0) * 100.0 / stats2.n, 1) else 0 end) order by pt) distribution
      from generate_series(v_question.likert_scale_min, v_question.likert_scale_max) pt
      left join (select likert_value, count(*) cnt from public.research_survey_answers where question_id = p_question_id group by likert_value) a on a.likert_value = pt
      cross join (select count(*) n from public.research_survey_answers where question_id = p_question_id) stats2
    ) dist;
  end if;
  return coalesce(v_result, case when v_question.question_type = 'multiple_choice' then '[]'::jsonb
    when v_question.question_type = 'open_ended' then jsonb_build_object('texts', '[]'::jsonb)
    else jsonb_build_object('n', 0, 'mean', null, 'median', null, 'stddev', null, 'distribution', '[]'::jsonb) end);
end; $$;
grant execute on function public.research_survey_question_results(uuid) to authenticated;

drop function if exists public.research_survey_gating_roster(uuid, uuid);
create or replace function public.research_survey_gating_roster(p_survey_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'scholarIdNumber', x.scholar_id_number,
    'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), x.scholar_id_number),
    'status', x.status, 'updatedAt', x.updated_at
  ) order by x.status, x.scholar_id_number), '[]'::jsonb)
  into v_result
  from (
    select scholar_id_number, status, updated_at from public.research_survey_responses where survey_id = p_survey_id
    union all
    select scholar_id_number, 'in_progress' as status, max(updated_at) as updated_at from public.attendance_records
    where pending_survey_id = p_survey_id and scholar_id_number not in (select scholar_id_number from public.research_survey_responses where survey_id = p_survey_id)
    group by scholar_id_number
  ) x
  left join public.scholars s on s.scholar_id_number = x.scholar_id_number;
  return v_result;
end; $$;
grant execute on function public.research_survey_gating_roster(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
