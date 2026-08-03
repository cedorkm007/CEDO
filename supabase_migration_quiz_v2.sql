-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quiz_v2.sql
--
-- Three things:
--   1. Per-topic attempt limits (a topic can override its subject's
--      default "attempts per day"), plus an optional YouTube lecture link
--      per topic, plus an optional explanation per question.
--   2. A rewrite of the quiz-taking flow to grade/track attempts PER TOPIC
--      instead of per subject — this is what actually makes "attempts can
--      vary per topic" meaningful (previously every topic under a subject
--      shared one daily counter).
--   3. A richer submit_quiz_attempt result (full per-question review with
--      the scholar's answer, the correct answer, and its explanation) to
--      back the new one-question-at-a-time quiz UI + full-topic review.
--
-- IMPORTANT CONTEXT: start_quiz_attempt / submit_quiz_attempt, and the
-- "scholar can read quest_subjects/quest_topics" policies, already exist
-- in your live database but were never captured in a tracked migration
-- file (there's no earlier .sql file defining them in this repo). This
-- file's function bodies are a complete, from-scratch reimplementation
-- that matches the existing app's behavior/contract exactly, plus the new
-- features below — `create or replace function` fully replaces whatever
-- is live now. After running this, treat this file as the source of truth
-- for these two functions going forward.
--
-- Run this AFTER supabase_migration_sead_staff.sql and
-- supabase_migration_scholar_portal.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Schema additions ──────────────────────────────────────

-- Matches the column your quest_subjects table already has live (not in
-- any tracked migration) — included here with IF NOT EXISTS so this file
-- is a safe, complete reference regardless of what's already run.
alter table public.quest_subjects add column if not exists max_attempts_per_day integer not null default 3;

-- NULL = "use the subject's default". A non-null value here overrides it
-- for this topic only — this is what makes attempts vary per topic.
alter table public.quest_topics add column if not exists max_attempts_per_day integer;
alter table public.quest_topics add column if not exists youtube_url text;

alter table public.quest_questions add column if not exists explanation text not null default '';

-- Composite index for the per-topic daily-attempt-count lookups the RPCs
-- below do on every quiz start/submit.
create index if not exists idx_sqs_scholar_topic_date
  on public.scholar_quest_scores (scholar_id_number, topic_id, date_taken);

-- ── 2. Scholar read access to Subjects/Topics (names + config only —
--    NOT quest_questions/quest_choices, which stay answer-key-protected
--    and only ever reachable through the SECURITY DEFINER RPCs below) ──
drop policy if exists "scholar reads quest subjects" on public.quest_subjects;
create policy "scholar reads quest subjects" on public.quest_subjects
  for select using (auth.uid() in (select id from public.scholars));

drop policy if exists "scholar reads quest topics" on public.quest_topics;
create policy "scholar reads quest topics" on public.quest_topics
  for select using (auth.uid() in (select id from public.scholars));

-- ── 3. start_quiz_attempt ────────────────────────────────────
-- Returns the topic's active questions (choices WITHOUT is_correct) plus
-- how many of this TOPIC's attempts the scholar has used today, and the
-- effective daily limit (topic override, else the subject's default).
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
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in as a scholar.');
  end if;

  select t.max_attempts_per_day, s.max_attempts_per_day
    into v_topic_max, v_subject_max
    from public.quest_topics t
    join public.quest_subjects s on s.id = t.subject_id
    where t.id = p_topic_id;

  if v_subject_max is null then
    return jsonb_build_object('ok', false, 'error', 'Topic not found.');
  end if;

  v_effective_max := coalesce(v_topic_max, v_subject_max);

  select count(*) into v_used_today
    from public.scholar_quest_scores
    where scholar_id_number = v_scholar_id
      and topic_id = p_topic_id
      and date_taken = current_date;

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
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'choiceText', c.choice_text) order by c.sort_order), '[]'::jsonb)
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
    'questions', v_questions,
    'attemptsUsedToday', v_used_today,
    'maxAttemptsPerDay', v_effective_max
  );
end;
$$;

grant execute on function public.start_quiz_attempt(uuid) to authenticated;

-- ── 4. submit_quiz_attempt ───────────────────────────────────
-- Grades the answers server-side (the client never has the answer key),
-- records one scholar_quest_scores row, and returns a full per-question
-- review — question text, every choice with its correctness, which one
-- the scholar picked, and that question's explanation — for the
-- results/review screen.
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
  v_score numeric := 0;
  v_max_score numeric := 0;
  v_results jsonb := '[]'::jsonb;
  v_answer jsonb;
  v_question record;
  v_selected_choice_id uuid;
  v_is_correct boolean;
  v_question_score numeric;
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in as a scholar.');
  end if;

  select t.subject_id, t.name, t.max_attempts_per_day, s.max_attempts_per_day
    into v_subject_id, v_topic_name, v_topic_max, v_subject_max
    from public.quest_topics t
    join public.quest_subjects s on s.id = t.subject_id
    where t.id = p_topic_id;

  if v_subject_id is null then
    return jsonb_build_object('ok', false, 'error', 'Topic not found.');
  end if;

  v_effective_max := coalesce(v_topic_max, v_subject_max);

  select count(*) into v_used_today
    from public.scholar_quest_scores
    where scholar_id_number = v_scholar_id
      and topic_id = p_topic_id
      and date_taken = current_date;

  if v_used_today >= v_effective_max then
    return jsonb_build_object(
      'ok', false,
      'error', format('You have used all %s attempt(s) for this topic today.', v_effective_max)
    );
  end if;

  -- Grade each active question against the submitted answers.
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
    'ok', true,
    'score', v_score,
    'maxScore', v_max_score,
    'attemptsUsedToday', v_used_today + 1,
    'maxAttemptsPerDay', v_effective_max,
    'results', v_results
  );
end;
$$;

grant execute on function public.submit_quiz_attempt(uuid, jsonb) to authenticated;
