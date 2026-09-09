-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quest_survey_mode.sql
--
-- Lets a Question Bank subject be flagged with where its answers should
-- land, chosen when the subject is created or edited:
--   - 'quest_monitoring' (default): today's behavior, unchanged — one
--     correct choice per question, graded, feeding Quests Monitoring
--     (Scores & Progress / Rankings / Completion Status) and the
--     certificate/passing-rate flow exactly as before.
--   - 'survey_results': questions have NO correct answer (like the
--     existing Research Project Monitoring surveys), one choice per
--     question may be flagged "Other" for a free-text write-in answer,
--     and answers land in Research Project Monitoring → Survey Results
--     instead of being graded. Still a repeatable Quest — same
--     attempts-per-day gate as always — just never scored, and never
--     touches scholar_quest_scores (so it can't pollute rankings,
--     completion status, or certificates).
--
-- Run this AFTER supabase_migration_quiz_v2.sql and
-- supabase_migration_research_project_monitoring.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Subject-level mode ────────────────────────────────────
alter table public.quest_subjects add column if not exists answer_destination text not null default 'quest_monitoring';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quest_subjects_answer_destination_check') then
    alter table public.quest_subjects add constraint quest_subjects_answer_destination_check
      check (answer_destination in ('quest_monitoring', 'survey_results'));
  end if;
end $$;

-- ── 2. "Other (write-in)" choice flag — survey-mode questions only ──
alter table public.quest_choices add column if not exists is_other boolean not null default false;
-- At most one "Other" choice per question.
create unique index if not exists quest_choices_one_other_per_question on public.quest_choices (question_id) where is_other;

-- ── 3. Storage for ungraded survey-mode answers ─────────────
-- Deliberately separate from scholar_quest_scores, which stays purely for
-- GRADED attempts — Quests Monitoring's Scores/Rankings/Completion Status
-- all read that table, and a survey-mode attempt has no score to put there.
create table if not exists public.quest_survey_attempts (
  id                uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number),
  subject_id        uuid not null references public.quest_subjects(id) on delete cascade,
  topic_id          uuid not null references public.quest_topics(id) on delete cascade,
  date_taken        date not null default current_date,
  created_at        timestamptz not null default now()
);
create index if not exists idx_quest_survey_attempts_scholar_topic_date
  on public.quest_survey_attempts (scholar_id_number, topic_id, date_taken);

create table if not exists public.quest_survey_answers (
  id                uuid primary key default gen_random_uuid(),
  attempt_id        uuid not null references public.quest_survey_attempts(id) on delete cascade,
  question_id       uuid not null references public.quest_questions(id) on delete cascade,
  choice_id         uuid references public.quest_choices(id) on delete set null,
  other_text        text,
  scholar_id_number text not null references public.scholars(scholar_id_number),
  created_at        timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists idx_quest_survey_answers_question on public.quest_survey_answers (question_id);

alter table public.quest_survey_attempts enable row level security;
alter table public.quest_survey_answers enable row level security;

-- Staff never author these — only the SECURITY DEFINER RPCs below write
-- them. Research-monitoring staff read them for Survey Results.
drop policy if exists "research staff read" on public.quest_survey_attempts;
create policy "research staff read" on public.quest_survey_attempts for select using (public.is_research_monitoring_staff());
drop policy if exists "research staff read" on public.quest_survey_answers;
create policy "research staff read" on public.quest_survey_answers for select using (public.is_research_monitoring_staff());

-- ── 4. Link a survey-mode Quest subject into Research Project
--       Monitoring's existing Survey Results, alongside SDP/Formation ──
alter table public.research_surveys add column if not exists quest_subject_id uuid references public.quest_subjects(id) on delete cascade;
alter table public.research_surveys drop constraint if exists research_surveys_exactly_one_activity;
alter table public.research_surveys add constraint research_surveys_exactly_one_activity
  check (num_nonnulls(sdp_activity_id, formation_activity_id, quest_subject_id) = 1);
create unique index if not exists research_surveys_quest_subject_unique on public.research_surveys (quest_subject_id) where quest_subject_id is not null;

-- Keeps a research_surveys "pointer" row in sync with a subject's own
-- name + answer_destination, so switching a subject to Survey Results
-- automatically makes it appear in Survey Tools/Survey Results — staff
-- never manually create/edit this row; Question Bank remains the only
-- place a survey-mode subject's questions are authored.
create or replace function public.sync_quest_subject_survey()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.answer_destination = 'survey_results' then
    insert into public.research_surveys (title, quest_subject_id, is_active)
    values (new.name, new.id, true)
    on conflict (quest_subject_id) where quest_subject_id is not null
    do update set title = excluded.title, is_active = true, updated_at = now();
  else
    update public.research_surveys set is_active = false, updated_at = now() where quest_subject_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_quest_subject_survey on public.quest_subjects;
create trigger trg_sync_quest_subject_survey
  after insert or update of name, answer_destination on public.quest_subjects
  for each row execute function public.sync_quest_subject_survey();

-- ── 5. Survey Results aggregation for quest-sourced survey questions ──
-- Mirrors research_survey_question_results(), reading quest_choices /
-- quest_survey_answers instead, plus "otherTexts" — the free-text answers
-- for the one is_other choice, which the plain per-choice counts don't carry.
create or replace function public.quest_survey_question_results(p_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_research_monitoring_staff() then
    raise exception 'Not authorized.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'choiceId', c.id, 'choiceText', c.choice_text, 'isOther', c.is_other, 'count', coalesce(cnt.n, 0),
    'otherTexts', case when c.is_other then coalesce(other.texts, '[]'::jsonb) else null end
  ) order by c.sort_order)
  into v_result
  from public.quest_choices c
  left join (
    select choice_id, count(*) n from public.quest_survey_answers where question_id = p_question_id group by choice_id
  ) cnt on cnt.choice_id = c.id
  left join (
    select choice_id, jsonb_agg(other_text order by created_at) texts
    from public.quest_survey_answers
    where question_id = p_question_id and other_text is not null and other_text <> ''
    group by choice_id
  ) other on other.choice_id = c.id
  where c.question_id = p_question_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;
grant execute on function public.quest_survey_question_results(uuid) to authenticated;

-- ── 6. start_quiz_attempt / submit_quiz_attempt: branch on the
--       subject's answer_destination ─────────────────────────
create or replace function public.start_quiz_attempt(p_topic_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_scholar_id text;
  v_subject_max int;
  v_topic_max int;
  v_effective_max int;
  v_used_today int;
  v_questions jsonb;
  v_answer_destination text;
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in as a scholar.');
  end if;

  select t.max_attempts_per_day, s.max_attempts_per_day, s.answer_destination
    into v_topic_max, v_subject_max, v_answer_destination
    from public.quest_topics t
    join public.quest_subjects s on s.id = t.subject_id
    where t.id = p_topic_id;

  if v_subject_max is null then
    return jsonb_build_object('ok', false, 'error', 'Topic not found.');
  end if;

  v_effective_max := coalesce(v_topic_max, v_subject_max);

  if v_answer_destination = 'survey_results' then
    select count(*) into v_used_today
      from public.quest_survey_attempts
      where scholar_id_number = v_scholar_id and topic_id = p_topic_id and date_taken = current_date;
  else
    select count(*) into v_used_today
      from public.scholar_quest_scores
      where scholar_id_number = v_scholar_id and topic_id = p_topic_id and date_taken = current_date;
  end if;

  if v_used_today >= v_effective_max then
    return jsonb_build_object(
      'ok', false,
      'error', format('You have used all %s attempt(s) for this topic today.', v_effective_max)
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'questionText', q.question_text,
      'points', q.points,
      'choices', (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text, 'isOther', c.is_other) order by c.sort_order), '[]'::jsonb)
        from public.quest_choices c where c.question_id = q.id
      )
    ) order by q.created_at), '[]'::jsonb)
    into v_questions
    from public.quest_questions q
    where q.topic_id = p_topic_id and q.is_active = true;

  if jsonb_array_length(v_questions) = 0 then
    return jsonb_build_object('ok', false, 'error', 'This topic has no active questions yet.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'answerDestination', v_answer_destination,
    'questions', v_questions,
    'attemptsUsedToday', v_used_today,
    'maxAttemptsPerDay', v_effective_max
  );
end;
$$;

grant execute on function public.start_quiz_attempt(uuid) to authenticated;

create or replace function public.submit_quiz_attempt(p_topic_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_scholar_id text;
  v_subject_id uuid;
  v_topic_name text;
  v_subject_max int;
  v_topic_max int;
  v_effective_max int;
  v_used_today int;
  v_answer_destination text;
  v_score numeric := 0;
  v_max_score numeric := 0;
  v_results jsonb := '[]'::jsonb;
  v_answer jsonb;
  v_question record;
  v_selected_choice_id uuid;
  v_other_text text;
  v_is_correct boolean;
  v_question_score numeric;
  v_attempt_id uuid;
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in as a scholar.');
  end if;

  select t.subject_id, t.name, t.max_attempts_per_day, s.max_attempts_per_day, s.answer_destination
    into v_subject_id, v_topic_name, v_topic_max, v_subject_max, v_answer_destination
    from public.quest_topics t
    join public.quest_subjects s on s.id = t.subject_id
    where t.id = p_topic_id;

  if v_subject_id is null then
    return jsonb_build_object('ok', false, 'error', 'Topic not found.');
  end if;

  v_effective_max := coalesce(v_topic_max, v_subject_max);

  if v_answer_destination = 'survey_results' then
    select count(*) into v_used_today
      from public.quest_survey_attempts
      where scholar_id_number = v_scholar_id and topic_id = p_topic_id and date_taken = current_date;
  else
    select count(*) into v_used_today
      from public.scholar_quest_scores
      where scholar_id_number = v_scholar_id and topic_id = p_topic_id and date_taken = current_date;
  end if;

  if v_used_today >= v_effective_max then
    return jsonb_build_object(
      'ok', false,
      'error', format('You have used all %s attempt(s) for this topic today.', v_effective_max)
    );
  end if;

  if v_answer_destination = 'survey_results' then
    insert into public.quest_survey_attempts (scholar_id_number, subject_id, topic_id)
    values (v_scholar_id, v_subject_id, p_topic_id)
    returning id into v_attempt_id;

    for v_question in
      select q.id from public.quest_questions q where q.topic_id = p_topic_id and q.is_active = true
    loop
      v_selected_choice_id := null;
      v_other_text := null;
      for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
      loop
        if (v_answer->>'questionId')::uuid = v_question.id then
          v_selected_choice_id := nullif(v_answer->>'choiceId', '')::uuid;
          v_other_text := nullif(trim(both from coalesce(v_answer->>'otherText', '')), '');
        end if;
      end loop;

      insert into public.quest_survey_answers (attempt_id, question_id, choice_id, other_text, scholar_id_number)
      values (v_attempt_id, v_question.id, v_selected_choice_id, v_other_text, v_scholar_id);
    end loop;

    return jsonb_build_object(
      'ok', true, 'surveyMode', true,
      'attemptsUsedToday', v_used_today + 1, 'maxAttemptsPerDay', v_effective_max
    );
  end if;

  -- Grade each active question against the submitted answers (unchanged
  -- from supabase_migration_quiz_v2.sql).
  for v_question in
    select q.id, q.question_text, q.points, q.explanation
    from public.quest_questions q
    where q.topic_id = p_topic_id and q.is_active = true
    order by q.created_at
  loop
    v_max_score := v_max_score + v_question.points;

    v_selected_choice_id := null;
    for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
    loop
      if (v_answer->>'questionId')::uuid = v_question.id then
        v_selected_choice_id := nullif(v_answer->>'choiceId', '')::uuid;
      end if;
    end loop;

    select exists(
      select 1 from public.quest_choices c
      where c.id = v_selected_choice_id and c.question_id = v_question.id and c.is_correct = true
    ) into v_is_correct;

    v_question_score := case when v_is_correct then v_question.points else 0 end;
    v_score := v_score + v_question_score;

    v_results := v_results || jsonb_build_object(
      'questionId', v_question.id,
      'questionText', v_question.question_text,
      'explanation', coalesce(v_question.explanation, ''),
      'isCorrect', v_is_correct,
      'selectedChoiceId', v_selected_choice_id,
      'choices', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'choiceText', c.choice_text, 'isCorrect', c.is_correct
        ) order by c.sort_order), '[]'::jsonb)
        from public.quest_choices c where c.question_id = v_question.id
      )
    );
  end loop;

  insert into public.scholar_quest_scores (scholar_id_number, quest_name, score, max_score, date_taken, subject_id, topic_id)
  values (v_scholar_id, v_topic_name, v_score, v_max_score, current_date, v_subject_id, p_topic_id);

  return jsonb_build_object(
    'ok', true, 'surveyMode', false,
    'score', v_score,
    'maxScore', v_max_score,
    'attemptsUsedToday', v_used_today + 1,
    'maxAttemptsPerDay', v_effective_max,
    'results', v_results
  );
end;
$$;

grant execute on function public.submit_quiz_attempt(uuid, jsonb) to authenticated;
