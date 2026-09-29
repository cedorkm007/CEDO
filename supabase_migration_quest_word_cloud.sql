-- ─────────────────────────────────────────────────────────────
-- supabase_migration_quest_word_cloud.sql
--
-- Adds a third Quest subject mode, "Word Cloud" — a scholar is shown a
-- short prompt (the topic's own name) and types one word or short
-- phrase; matching words aggregate into a Mentimeter-style live word
-- cloud that grows as scholars submit. No quest_questions/quest_choices
-- are needed for a word_cloud topic — the prompt IS the topic's name,
-- reusing that row as-is (including its existing optional
-- video_url/slide_url/pdf_url supplementary-material fields).
--
-- Mirrors supabase_migration_quest_survey_mode.sql's own design exactly:
-- a third answer_destination value, with its own answers table kept
-- deliberately separate from scholar_quest_scores so it never touches
-- grading/rankings/completion status. Unlike survey mode, staff read the
-- raw entries directly (RLS-gated, is_sead_staff()) and aggregate
-- word -> count client-side rather than through a dedicated RPC — at
-- classroom-sized response counts this is simpler than adding one.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Widen the subject-level mode check ────────────────────
alter table public.quest_subjects drop constraint if exists quest_subjects_answer_destination_check;
alter table public.quest_subjects add constraint quest_subjects_answer_destination_check
  check (answer_destination in ('quest_monitoring', 'survey_results', 'word_cloud'));

-- ── 2. Storage for word cloud entries ─────────────────────────
create table if not exists public.quest_word_cloud_entries (
  id                uuid primary key default gen_random_uuid(),
  scholar_id_number text not null references public.scholars(scholar_id_number) on delete cascade,
  subject_id        uuid not null references public.quest_subjects(id) on delete cascade,
  topic_id          uuid not null references public.quest_topics(id) on delete cascade,
  word              text not null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_quest_word_cloud_entries_topic on public.quest_word_cloud_entries (topic_id);
-- Plain column index (not an expression index on created_at::date — that
-- cast is only STABLE, not IMMUTABLE, since its result depends on the
-- session's TimeZone setting, which Postgres rejects for index
-- expressions). The daily-attempt-count queries below still filter by
-- created_at::date in their WHERE clause — that works fine as a plain
-- (non-indexed-expression) predicate; this index just speeds up the
-- (scholar, topic) lookup that predicate narrows from.
create index if not exists idx_quest_word_cloud_entries_scholar_topic
  on public.quest_word_cloud_entries (scholar_id_number, topic_id);

alter table public.quest_word_cloud_entries enable row level security;

-- Staff full access — gated by the same 'quest_management' tag that
-- already controls the Question Bank page itself (App.tsx's
-- isPageAuthorizedFor, and evidently the live quest_subjects/quest_topics
-- RLS too), via has_staff_tag() — NOT is_sead_staff(), which turned out to
-- have been live-repointed (undocumented in any checked-in migration, same
-- "live definition drifted from tracked SQL" pattern seen elsewhere in
-- this codebase) to check a specific 'scholar_management' tag instead of
-- its own name-implied broader meaning. Confirmed directly against the
-- live database: a test staff account with only 'quest_management' could
-- already create subjects/topics (implying the real tables key off that
-- tag or an equivalent, not is_sead_staff()), while is_sead_staff() itself
-- returned false for that same account.
--
-- Scholars never read/write this table directly — only through the two
-- security-definer RPCs below, which resolve the caller's own identity
-- from auth.uid() rather than trusting a client-supplied scholar id.
drop policy if exists "staff full access" on public.quest_word_cloud_entries;
create policy "staff full access" on public.quest_word_cloud_entries for all
  using (public.has_staff_tag('quest_management')) with check (public.has_staff_tag('quest_management'));

-- A brand-new table is never in the supabase_realtime publication by
-- default — no postgres_changes event fires for it at all, regardless of
-- RLS or frontend code, until it's added here. Same fix as
-- supabase_migration_realtime_tags_and_uploads.sql needed for
-- staff_account_tags/submission_uploads; confirmed live (attendance_records/
-- attendance_codes were already enabled, which is why other realtime
-- features "just worked" without this step). Safe to re-run — ADD TABLE
-- is a no-op if already present, guarded here to avoid a hard error either way.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'quest_word_cloud_entries'
  ) then
    alter publication supabase_realtime add table public.quest_word_cloud_entries;
  end if;
end $$;

-- ── 3. start_word_cloud_activity / submit_word_cloud_entry ───
-- Same daily-attempt-limit shape as start_quiz_attempt/submit_quiz_attempt
-- (coalesce(topic.max_attempts_per_day, subject.max_attempts_per_day)),
-- just counting quest_word_cloud_entries instead of scholar_quest_scores
-- or quest_survey_attempts.
create or replace function public.start_word_cloud_activity(p_topic_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_scholar_id text;
  v_topic_name text;
  v_subject_max int;
  v_topic_max int;
  v_effective_max int;
  v_used_today int;
  v_answer_destination text;
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in as a scholar.');
  end if;

  select t.name, t.max_attempts_per_day, s.max_attempts_per_day, s.answer_destination
    into v_topic_name, v_topic_max, v_subject_max, v_answer_destination
    from public.quest_topics t
    join public.quest_subjects s on s.id = t.subject_id
    where t.id = p_topic_id;

  if v_topic_name is null then
    return jsonb_build_object('ok', false, 'error', 'Topic not found.');
  end if;
  if v_answer_destination <> 'word_cloud' then
    return jsonb_build_object('ok', false, 'error', 'This topic is not a word cloud activity.');
  end if;

  v_effective_max := coalesce(v_topic_max, v_subject_max);
  select count(*) into v_used_today
    from public.quest_word_cloud_entries
    where scholar_id_number = v_scholar_id and topic_id = p_topic_id and created_at::date = current_date;

  if v_used_today >= v_effective_max then
    return jsonb_build_object(
      'ok', false,
      'error', format('You have used all %s attempt(s) for this topic today.', v_effective_max)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'prompt', v_topic_name,
    'attemptsUsedToday', v_used_today,
    'maxAttemptsPerDay', v_effective_max
  );
end;
$$;
grant execute on function public.start_word_cloud_activity(uuid) to authenticated;

create or replace function public.submit_word_cloud_entry(p_topic_id uuid, p_word text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_scholar_id text;
  v_subject_id uuid;
  v_subject_max int;
  v_topic_max int;
  v_effective_max int;
  v_used_today int;
  v_answer_destination text;
  v_word text;
begin
  select scholar_id_number into v_scholar_id from public.scholars where id = auth.uid();
  if v_scholar_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in as a scholar.');
  end if;

  v_word := nullif(trim(both from p_word), '');
  if v_word is null then
    return jsonb_build_object('ok', false, 'error', 'Enter a word or short phrase.');
  end if;
  if length(v_word) > 40 then
    return jsonb_build_object('ok', false, 'error', 'Keep it to 40 characters or fewer.');
  end if;

  select t.subject_id, t.max_attempts_per_day, s.max_attempts_per_day, s.answer_destination
    into v_subject_id, v_topic_max, v_subject_max, v_answer_destination
    from public.quest_topics t
    join public.quest_subjects s on s.id = t.subject_id
    where t.id = p_topic_id;

  if v_subject_id is null then
    return jsonb_build_object('ok', false, 'error', 'Topic not found.');
  end if;
  if v_answer_destination <> 'word_cloud' then
    return jsonb_build_object('ok', false, 'error', 'This topic is not a word cloud activity.');
  end if;

  v_effective_max := coalesce(v_topic_max, v_subject_max);
  select count(*) into v_used_today
    from public.quest_word_cloud_entries
    where scholar_id_number = v_scholar_id and topic_id = p_topic_id and created_at::date = current_date;

  if v_used_today >= v_effective_max then
    return jsonb_build_object(
      'ok', false,
      'error', format('You have used all %s attempt(s) for this topic today.', v_effective_max)
    );
  end if;

  insert into public.quest_word_cloud_entries (scholar_id_number, subject_id, topic_id, word)
  values (v_scholar_id, v_subject_id, p_topic_id, v_word);

  return jsonb_build_object(
    'ok', true,
    'attemptsUsedToday', v_used_today + 1,
    'maxAttemptsPerDay', v_effective_max
  );
end;
$$;
grant execute on function public.submit_word_cloud_entry(uuid, text) to authenticated;
