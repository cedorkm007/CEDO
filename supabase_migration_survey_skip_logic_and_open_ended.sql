-- ─────────────────────────────────────────────────────────────
-- supabase_migration_survey_skip_logic_and_open_ended.sql
--
-- Two additions to Survey Tools (research_survey_* tables — NOT the
-- separate quest-sourced survey system backed by quest_questions/
-- quest_choices, which this migration does not touch):
--
-- 1. Skip logic: a multiple-choice choice can now route the respondent
--    straight to a later question (skip_to_question_id) or straight to
--    the end of the survey (ends_survey), instead of always continuing
--    to the next question in sort_order. Forward-only by construction
--    (enforced by a trigger below) so the required-question walk always
--    terminates.
--
-- 2. Open-ended questions: a third question_type, 'open_ended', answered
--    with free text (open_ended_format is 'short' for a single-line
--    answer or 'long' for a paragraph/textarea) instead of a choice or a
--    scale value.
--
-- submit_survey_response() previously required every question in the
-- survey to have an answer before letting a scholar finish. That's no
-- longer correct once answering a question can skip others — replaced
-- with a server-side walk (research_survey_required_question_ids) that
-- recomputes, from the response's OWN saved answers, exactly which
-- questions were actually on the path taken. Never trusts the client for
-- this, since finishing a survey also unlocks held-open attendance/vouchers.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── Skip logic columns ──────────────────────────────────────

alter table public.research_survey_choices add column if not exists skip_to_question_id uuid references public.research_survey_questions(id) on delete set null;
alter table public.research_survey_choices add column if not exists ends_survey boolean not null default false;

alter table public.research_survey_choices drop constraint if exists research_survey_choices_skip_exclusive;
alter table public.research_survey_choices add constraint research_survey_choices_skip_exclusive
  check (not (ends_survey and skip_to_question_id is not null));

-- Forward-only guard: a skip target must belong to the SAME survey and
-- have a strictly later sort_order than the choice's own question — this
-- is what guarantees research_survey_required_question_ids' walk below
-- always terminates, since it can never revisit a question.
create or replace function public.validate_survey_choice_skip_target()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_own_survey uuid;
  v_own_sort integer;
  v_target_survey uuid;
  v_target_sort integer;
begin
  if new.skip_to_question_id is null then
    return new;
  end if;

  select survey_id, sort_order into v_own_survey, v_own_sort
    from public.research_survey_questions where id = new.question_id;
  select survey_id, sort_order into v_target_survey, v_target_sort
    from public.research_survey_questions where id = new.skip_to_question_id;

  if v_target_survey is null then
    raise exception 'Skip target question does not exist.';
  end if;
  if v_target_survey <> v_own_survey then
    raise exception 'A choice can only skip to a question in the same survey.';
  end if;
  if v_target_sort <= v_own_sort then
    raise exception 'A choice can only skip forward to a later question.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_survey_choice_skip_target on public.research_survey_choices;
create trigger validate_survey_choice_skip_target
  before insert or update on public.research_survey_choices
  for each row execute function public.validate_survey_choice_skip_target();

-- ── Open-ended question type ────────────────────────────────

alter table public.research_survey_questions drop constraint if exists research_survey_questions_question_type_check;
alter table public.research_survey_questions add constraint research_survey_questions_question_type_check
  check (question_type in ('multiple_choice', 'likert', 'open_ended'));

alter table public.research_survey_questions add column if not exists open_ended_format text check (open_ended_format in ('short', 'long'));

alter table public.research_survey_questions drop constraint if exists research_survey_questions_likert_fields;
alter table public.research_survey_questions drop constraint if exists research_survey_questions_type_fields;
alter table public.research_survey_questions add constraint research_survey_questions_type_fields check (
  (question_type = 'likert' and likert_scale_min is not null and likert_scale_max is not null
     and likert_scale_max > likert_scale_min and likert_min_label is not null and likert_max_label is not null
     and open_ended_format is null)
  or
  (question_type = 'multiple_choice' and likert_scale_min is null and likert_scale_max is null
     and likert_min_label is null and likert_max_label is null and open_ended_format is null)
  or
  (question_type = 'open_ended' and open_ended_format is not null
     and likert_scale_min is null and likert_scale_max is null and likert_min_label is null and likert_max_label is null)
);

alter table public.research_survey_answers add column if not exists text_value text;
alter table public.research_survey_answers drop constraint if exists research_survey_answers_exactly_one_value;
alter table public.research_survey_answers add constraint research_survey_answers_exactly_one_value
  check (num_nonnulls(choice_id, likert_value, text_value) = 1);

-- ── Required-question walk ───────────────────────────────────

create or replace function public.research_survey_required_question_ids(p_response_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_survey_id uuid;
  v_current_id uuid;
  v_chosen_choice uuid;
  v_ends boolean;
  v_skip_to uuid;
  v_current_sort integer;
  v_guard integer := 0;
  v_max_iterations integer;
begin
  select survey_id into v_survey_id from public.research_survey_responses where id = p_response_id;
  if v_survey_id is null then
    return;
  end if;

  select count(*) into v_max_iterations from public.research_survey_questions where survey_id = v_survey_id;

  select id into v_current_id from public.research_survey_questions
    where survey_id = v_survey_id order by sort_order limit 1;

  while v_current_id is not null and v_guard <= v_max_iterations loop
    v_guard := v_guard + 1;
    return next v_current_id;

    select a.choice_id into v_chosen_choice
      from public.research_survey_answers a
      where a.response_id = p_response_id and a.question_id = v_current_id;

    v_ends := false;
    v_skip_to := null;
    if v_chosen_choice is not null then
      select ends_survey, skip_to_question_id into v_ends, v_skip_to
        from public.research_survey_choices where id = v_chosen_choice;
    end if;

    if v_ends then
      v_current_id := null;
    elsif v_skip_to is not null then
      v_current_id := v_skip_to;
    else
      select sort_order into v_current_sort from public.research_survey_questions where id = v_current_id;
      select id into v_current_id from public.research_survey_questions
        where survey_id = v_survey_id and sort_order > v_current_sort
        order by sort_order limit 1;
    end if;
  end loop;
end;
$$;
grant execute on function public.research_survey_required_question_ids(uuid) to authenticated;

-- ── submit_survey_response(): require the walked path, not every question ──

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
grant execute on function public.submit_survey_response(uuid) to authenticated;

-- ── submit_survey_answer(): accept open-ended text ──────────

create or replace function public.submit_survey_answer(p_response_id uuid, p_question_id uuid, p_choice_id uuid default null, p_likert_value integer default null, p_text_value text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scholar public.scholars%rowtype; v_response public.research_survey_responses%rowtype; v_question public.research_survey_questions%rowtype;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then raise exception 'Only signed-in scholars can answer surveys.'; end if;

  select * into v_response from public.research_survey_responses where id = p_response_id;
  if not found or v_response.scholar_id_number <> v_scholar.scholar_id_number then raise exception 'Response not found.'; end if;
  if v_response.status = 'completed' then raise exception 'This survey has already been submitted.'; end if;

  select * into v_question from public.research_survey_questions where id = p_question_id and survey_id = v_response.survey_id;
  if not found then raise exception 'Question not found for this survey.'; end if;

  if v_question.question_type = 'multiple_choice' then
    if p_choice_id is null or p_likert_value is not null or p_text_value is not null then raise exception 'Provide exactly a choice for this question.'; end if;
    if not exists (select 1 from public.research_survey_choices where id = p_choice_id and question_id = p_question_id) then
      raise exception 'Invalid choice for this question.';
    end if;
  elsif v_question.question_type = 'likert' then
    if p_likert_value is null or p_choice_id is not null or p_text_value is not null then raise exception 'Provide exactly a scale value for this question.'; end if;
    if p_likert_value < v_question.likert_scale_min or p_likert_value > v_question.likert_scale_max then
      raise exception 'Scale value out of range.';
    end if;
  else
    if p_text_value is null or trim(p_text_value) = '' or p_choice_id is not null or p_likert_value is not null then
      raise exception 'Provide exactly a text answer for this question.';
    end if;
  end if;

  insert into public.research_survey_answers (response_id, question_id, choice_id, likert_value, text_value)
    values (p_response_id, p_question_id, p_choice_id, p_likert_value, p_text_value)
    on conflict (response_id, question_id) do update set choice_id = excluded.choice_id, likert_value = excluded.likert_value, text_value = excluded.text_value, answered_at = now();

  update public.research_survey_responses set updated_at = now() where id = p_response_id;

  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.submit_survey_answer(uuid, uuid, uuid, integer, text) to authenticated;

-- ── start_or_resume_survey_response(): return skip metadata + text answers ──

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
grant execute on function public.start_or_resume_survey_response(uuid) to authenticated;

-- ── research_survey_question_results(): open-ended branch ───

create or replace function public.research_survey_question_results(p_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question public.research_survey_questions%rowtype;
  v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then
    raise exception 'Not authorized.';
  end if;

  select * into v_question from public.research_survey_questions where id = p_question_id;
  if not found then
    raise exception 'Question not found.';
  end if;

  if v_question.question_type = 'multiple_choice' then
    select jsonb_agg(jsonb_build_object('choiceId', c.id, 'choiceText', c.choice_text, 'count', coalesce(cnt.n, 0)) order by c.sort_order)
    into v_result
    from public.research_survey_choices c
    left join (
      select choice_id, count(*) n from public.research_survey_answers where question_id = p_question_id group by choice_id
    ) cnt on cnt.choice_id = c.id
    where c.question_id = p_question_id;
  elsif v_question.question_type = 'open_ended' then
    select jsonb_build_object('texts', coalesce(jsonb_agg(text_value order by answered_at), '[]'::jsonb))
    into v_result
    from public.research_survey_answers
    where question_id = p_question_id;
  else
    select jsonb_build_object(
      'n', stats.n, 'mean', stats.mean, 'median', stats.median, 'stddev', stats.stddev,
      'distribution', dist.distribution
    ) into v_result
    from (
      select count(*) n, avg(likert_value) mean,
             percentile_cont(0.5) within group (order by likert_value) median,
             stddev_samp(likert_value) stddev
      from public.research_survey_answers where question_id = p_question_id
    ) stats,
    (
      select jsonb_agg(jsonb_build_object(
        'value', pt, 'count', coalesce(a.cnt, 0),
        'percentage', case when stats2.n > 0 then round(coalesce(a.cnt, 0) * 100.0 / stats2.n, 1) else 0 end
      ) order by pt) distribution
      from generate_series(v_question.likert_scale_min, v_question.likert_scale_max) pt
      left join (
        select likert_value, count(*) cnt from public.research_survey_answers where question_id = p_question_id group by likert_value
      ) a on a.likert_value = pt
      cross join (select count(*) n from public.research_survey_answers where question_id = p_question_id) stats2
    ) dist;
  end if;

  return coalesce(v_result, case
    when v_question.question_type = 'multiple_choice' then '[]'::jsonb
    when v_question.question_type = 'open_ended' then jsonb_build_object('texts', '[]'::jsonb)
    else jsonb_build_object('n', 0, 'mean', null, 'median', null, 'stddev', null, 'distribution', '[]'::jsonb)
  end);
end;
$$;
grant execute on function public.research_survey_question_results(uuid) to authenticated;
