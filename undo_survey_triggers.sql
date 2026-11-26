-- undo_survey_triggers.sql: surveys are asked only by QR scan and Scanning Tools again (the way they were after Phase 3).
-- WHAT IT KEEPS: every answer, credit and survey. The tick-box settings and the list of surveys asked afterwards stay stored (unused), so Phase 4 can be run again.
-- WHAT STOPS: manual credit, picture approval and reconsideration requests ask nothing; surveys still waiting to be answered after those are no longer shown.
begin;

drop trigger if exists survey_ask_after_credit on public.sdp_attendance;
do $$ begin
  if to_regclass('public.sdp_reconsideration_requests') is not null then
    drop trigger if exists survey_ask_after_reconsideration on public.sdp_reconsideration_requests;
  end if;
end $$;
drop function if exists public._survey_ask_after_credit();
drop function if exists public._survey_ask_after_reconsideration();
drop function if exists public.my_pending_surveys();
drop function if exists public.survey_save(uuid, text, text, boolean, text, jsonb, jsonb);
drop function if exists public.research_survey_question_results(uuid, uuid, text);
drop index if exists public.research_surveys_one_reconsideration;
update public.research_surveys set ask_qr = true, ask_scanner = true, ask_manual = false, ask_picture = false, ask_reconsideration = false;

create or replace function public._survey_gate(p_activity_id uuid, p_scholar_id_number text)
returns uuid language sql stable security definer set search_path = public as $$
  select l.survey_id
  from public.research_survey_activities l join public.research_surveys s on s.id = l.survey_id and s.is_active
  where l.activity_id = p_activity_id and l.detached_at is null
    and not exists (select 1 from public.research_survey_responses r
                    where r.survey_id = l.survey_id and r.scholar_id_number = p_scholar_id_number and r.activity_id = p_activity_id and r.status in ('completed', 'declined'))
  limit 1;
$$;
revoke all on function public._survey_gate(uuid, text) from public, anon, authenticated;

create or replace function public._survey_release(p_survey_id uuid, p_activity_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform set_config('app.sdp_source', 'survey_released', true);
  for v in
    select s.id as scholar_id, r.scholar_id_number, x.activity_id, x.activity_type, x.activity_name, r.held_trigger
    from public.attendance_records r
    join public.scholars s on s.scholar_id_number = r.scholar_id_number
    join lateral (
      select coalesce(a.sdp_activity_id, a.formation_activity_id) as activity_id, case when a.sdp_activity_id is not null then 'sdp' else 'formation' end as activity_type,
             coalesce((select n.name from public.sdp_activities n where n.id = a.sdp_activity_id), (select f.name from public.formation_activities f where f.id = a.formation_activity_id), '') as activity_name
      from public.attendance_sessions a where a.id = r.session_id
    ) x on true
    where r.pending_survey_id = p_survey_id and (p_activity_id is null or x.activity_id = p_activity_id)
  loop
    insert into public.research_survey_responses (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
    values (p_survey_id, v.scholar_id_number, v.activity_type, v.activity_id, v.activity_name, v.held_trigger)
    on conflict do nothing;
    perform public._finalize_survey_gated_attendance(v.scholar_id, v.scholar_id_number, p_survey_id, v.activity_id);
  end loop;
  perform set_config('app.sdp_source', '', true);
end; $$;
revoke all on function public._survey_release(uuid, uuid) from public, anon, authenticated;

create or replace function public._survey_activity_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.research_survey_activities set detached_at = coalesce(detached_at, now()), activity_name = old.name where activity_id = old.id;
  update public.research_survey_responses set activity_name = old.name where activity_id = old.id;
  return old;
end; $$;
revoke all on function public._survey_activity_deleted() from public, anon, authenticated;

create or replace function public.start_or_resume_survey_response(p_survey_id uuid, p_activity_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_survey public.research_surveys%rowtype;
  v_activity uuid := p_activity_id; v_type text; v_name text; v_trigger text;
  v_sections jsonb; v_questions jsonb; v_answers jsonb;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can respond to surveys.'; end if;
  select * into v_survey from public.research_surveys where id = p_survey_id;
  if not found then raise exception 'Survey not found.'; end if;

  -- which activity: the one asked for, else the one most recently left waiting, else one already started, else the only one
  if v_activity is null then
    select coalesce(x.sdp_activity_id, x.formation_activity_id) into v_activity
      from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_scholar.scholar_id_number and r.pending_survey_id = p_survey_id
      order by r.held_at desc nulls last, r.updated_at desc limit 1;
  end if;
  if v_activity is null then
    select r.activity_id into v_activity from public.research_survey_responses r
      where r.survey_id = p_survey_id and r.scholar_id_number = v_scholar.scholar_id_number order by (r.status = 'in_progress') desc, r.updated_at desc limit 1;
  end if;
  if v_activity is null and (select count(*) from public.research_survey_activities l where l.survey_id = p_survey_id and l.detached_at is null) = 1 then
    select l.activity_id into v_activity from public.research_survey_activities l where l.survey_id = p_survey_id and l.detached_at is null;
  end if;
  if v_activity is null then raise exception 'There is nothing waiting for this survey.'; end if;

  select * into v_response from public.research_survey_responses r
    where r.survey_id = p_survey_id and r.scholar_id_number = v_scholar.scholar_id_number and r.activity_id = v_activity;
  if not found then
    select l.activity_type, l.activity_name into v_type, v_name from public.research_survey_activities l where l.survey_id = p_survey_id and l.activity_id = v_activity;
    if v_type is null then raise exception 'This survey is not for that activity.'; end if;
    select r.held_trigger into v_trigger from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
      where r.scholar_id_number = v_scholar.scholar_id_number and r.pending_survey_id = p_survey_id and coalesce(x.sdp_activity_id, x.formation_activity_id) = v_activity limit 1;
    insert into public.research_survey_responses (survey_id, scholar_id_number, activity_type, activity_id, activity_name, ask_trigger)
      values (p_survey_id, v_scholar.scholar_id_number, v_type, v_activity, v_name, v_trigger)
      returning * into v_response;
  else
    update public.research_survey_responses set updated_at = now() where id = v_response.id;
  end if;

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
    'requiresConsent', v_survey.requires_consent, 'consented', v_response.consented, 'consentText', v_survey.consent_text, 'activityName', v_response.activity_name);
end; $$;
revoke all on function public.start_or_resume_survey_response(uuid, uuid) from public, anon;
grant execute on function public.start_or_resume_survey_response(uuid, uuid) to authenticated;

create or replace function public.survey_save(p_survey_id uuid, p_title text, p_description text, p_requires_consent boolean, p_consent_text text, p_activities jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_survey_id; v record; v_item jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception 'Enter a survey title.'; end if;
  if coalesce(jsonb_array_length(p_activities), 0) = 0 then raise exception 'Choose at least one activity.'; end if;
  if p_requires_consent and btrim(coalesce(p_consent_text, '')) = '' then raise exception 'Enter the consent question text.'; end if;
  if v_id is null then
    insert into public.research_surveys (title, description, requires_consent, consent_text, created_by)
    values (btrim(p_title), btrim(coalesce(p_description, '')), p_requires_consent, coalesce(nullif(btrim(p_consent_text), ''), 'This survey is voluntary. Do you agree to participate?'), (select u.id from public.users u where u.id = auth.uid()))
    returning id into v_id;
  else
    perform public._survey_require_staff(v_id);
    update public.research_surveys set title = btrim(p_title), description = btrim(coalesce(p_description, '')), requires_consent = p_requires_consent,
      consent_text = coalesce(nullif(btrim(p_consent_text), ''), consent_text), updated_at = now() where id = v_id;
  end if;
  -- detach what is no longer chosen (deleted activities stay as they are)
  for v in select l.activity_id from public.research_survey_activities l where l.survey_id = v_id and l.detached_at is null
             and not exists (select 1 from jsonb_array_elements(p_activities) e where (e ->> 'id')::uuid = l.activity_id) loop
    perform public._survey_detach(v_id, v.activity_id);
  end loop;
  perform public._survey_mirror_primary(v_id);          -- frees the old column before another survey takes that activity
  for v_item in select e from jsonb_array_elements(p_activities) e loop
    perform public._survey_attach(v_id, v_item ->> 'type', (v_item ->> 'id')::uuid);
  end loop;
  perform public._survey_mirror_primary(v_id);
  return v_id;
end; $$;
revoke all on function public.survey_save(uuid, text, text, boolean, text, jsonb) from public, anon;
grant execute on function public.survey_save(uuid, text, text, boolean, text, jsonb) to authenticated;

create or replace function public.research_survey_question_results(p_question_id uuid, p_activity_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_question public.research_survey_questions%rowtype; v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  select * into v_question from public.research_survey_questions where id = p_question_id;
  if not found then raise exception 'Question not found.'; end if;

  with picked as (
    select a.choice_id, a.likert_value, a.text_value, a.answered_at
    from public.research_survey_answers a join public.research_survey_responses r on r.id = a.response_id
    where a.question_id = p_question_id and (p_activity_id is null or r.activity_id = p_activity_id)
  )
  select case v_question.question_type
    when 'multiple_choice' then (
      select jsonb_agg(jsonb_build_object('choiceId', c.id, 'choiceText', c.choice_text, 'count', coalesce(cnt.n, 0), 'removed', c.removed_at is not null, 'removedReason', c.removed_reason) order by c.removed_at is not null, c.sort_order, c.created_at)
      from public.research_survey_choices c
      left join (select choice_id, count(*) n from picked group by choice_id) cnt on cnt.choice_id = c.id
      where c.question_id = p_question_id and (c.removed_at is null or coalesce(cnt.n, 0) > 0))
    when 'open_ended' then (select jsonb_build_object('texts', coalesce(jsonb_agg(text_value order by answered_at), '[]'::jsonb)) from picked)
    else (
      select jsonb_build_object('n', stats.n, 'mean', stats.mean, 'median', stats.median, 'stddev', stats.stddev, 'distribution', dist.distribution)
      from (select count(*) n, avg(likert_value) mean, percentile_cont(0.5) within group (order by likert_value) median, stddev_samp(likert_value) stddev from picked) stats,
      (select jsonb_agg(jsonb_build_object('value', pt, 'count', coalesce(a.cnt, 0),
                'percentage', case when total.n > 0 then round(coalesce(a.cnt, 0) * 100.0 / total.n, 1) else 0 end) order by pt) distribution
       from generate_series(v_question.likert_scale_min, v_question.likert_scale_max) pt
       left join (select likert_value, count(*) cnt from picked group by likert_value) a on a.likert_value = pt
       cross join (select count(*) n from picked) total) dist)
  end into v_result;

  return coalesce(v_result, case when v_question.question_type = 'multiple_choice' then '[]'::jsonb
    when v_question.question_type = 'open_ended' then jsonb_build_object('texts', '[]'::jsonb)
    else jsonb_build_object('n', 0, 'mean', null, 'median', null, 'stddev', null, 'distribution', '[]'::jsonb) end);
end; $$;
revoke all on function public.research_survey_question_results(uuid, uuid) from public, anon;
grant execute on function public.research_survey_question_results(uuid, uuid) to authenticated;

create or replace function public.research_survey_gating_roster(p_survey_id uuid, p_activity_id uuid default null, p_with_released boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then raise exception 'Not authorized.'; end if;
  with held as (
    select r.scholar_id_number, coalesce(x.sdp_activity_id, x.formation_activity_id) as activity_id, max(r.updated_at) as updated_at
    from public.attendance_records r join public.attendance_sessions x on x.id = r.session_id
    where r.pending_survey_id = p_survey_id
    group by 1, 2
  ),
  everyone as (
    select r.scholar_id_number, r.activity_id, r.activity_name,
           case when r.status in ('completed', 'declined') then r.status when h.scholar_id_number is not null or not p_with_released then 'in_progress' else 'released' end as status,
           r.updated_at
    from public.research_survey_responses r
    left join held h on h.scholar_id_number = r.scholar_id_number and h.activity_id is not distinct from r.activity_id
    where r.survey_id = p_survey_id
    union all
    select h.scholar_id_number, h.activity_id, l.activity_name, 'in_progress', h.updated_at
    from held h left join public.research_survey_activities l on l.survey_id = p_survey_id and l.activity_id = h.activity_id
    where not exists (select 1 from public.research_survey_responses r where r.survey_id = p_survey_id and r.scholar_id_number = h.scholar_id_number and r.activity_id is not distinct from h.activity_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'scholarIdNumber', e.scholar_id_number,
    'scholarName', coalesce(nullif(trim(s.last_name || ', ' || s.first_name), ','), e.scholar_id_number),
    'activityId', e.activity_id, 'activityName', coalesce(e.activity_name, 'Not recorded'),
    'status', e.status, 'updatedAt', e.updated_at
  ) order by e.status, e.scholar_id_number, e.activity_name), '[]'::jsonb)
  into v_result
  from everyone e left join public.scholars s on s.scholar_id_number = e.scholar_id_number
  where p_activity_id is null or e.activity_id = p_activity_id;
  return v_result;
end; $$;
revoke all on function public.research_survey_gating_roster(uuid, uuid, boolean) from public, anon;
grant execute on function public.research_survey_gating_roster(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
