-- ─────────────────────────────────────────────────────────────
-- supabase_migration_research_project_monitoring.sql
--
-- Phase B of the "Research Project Monitoring" tab: the Survey Tools /
-- Survey Results backend. Staff build surveys (Multiple Choice or Likert
-- Scale questions) and attach one survey to exactly one SDP or Formation
-- activity. research_survey_responses/answers are created here (even
-- though scholar-facing writes only land in a later phase) so that phase
-- only needs to add RLS/RPCs, not new tables.
--
-- Access to these 5 tables is gated by the "research_project_monitoring"
-- staff tag specifically — NOT the broader is_sead_staff()/is_cedo_staff()
-- helpers already in this codebase, since those check for a DIFFERENT tag
-- ("scholar_management") or no tag at all. Mirrors how is_sead_staff()
-- itself is just a named check for one specific tag.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_research_monitoring_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.staff_account_tags t
    where t.staff_id = auth.uid() and t.tag_key = 'research_project_monitoring'
  );
$$;
grant execute on function public.is_research_monitoring_staff() to authenticated;

create table if not exists public.research_surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  sdp_activity_id uuid references public.sdp_activities(id) on delete cascade,
  formation_activity_id uuid references public.formation_activities(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_surveys_exactly_one_activity check (num_nonnulls(sdp_activity_id, formation_activity_id) = 1)
);
-- One survey per activity — keeps the eventual attendance gate (a later
-- phase) a single unambiguous lookup instead of an aggregate over many.
create unique index if not exists research_surveys_sdp_activity_unique on public.research_surveys (sdp_activity_id) where sdp_activity_id is not null;
create unique index if not exists research_surveys_formation_activity_unique on public.research_surveys (formation_activity_id) where formation_activity_id is not null;

-- Likert config lives inline (nullable) rather than a side table since
-- it's a strict 1:1 config per question.
create table if not exists public.research_survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  question_type text not null check (question_type in ('multiple_choice', 'likert')),
  question_text text not null,
  sort_order integer not null default 0,
  likert_scale_min integer,
  likert_scale_max integer,
  likert_min_label text,
  likert_max_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_survey_questions_likert_fields check (
    (question_type = 'likert' and likert_scale_min is not null and likert_scale_max is not null
       and likert_scale_max > likert_scale_min and likert_min_label is not null and likert_max_label is not null)
    or
    (question_type = 'multiple_choice' and likert_scale_min is null and likert_scale_max is null
       and likert_min_label is null and likert_max_label is null)
  )
);
create index if not exists idx_research_survey_questions_survey on public.research_survey_questions(survey_id);

-- Unlimited choices per multiple_choice question, and deliberately NO
-- is_correct column — a survey has no right/wrong answer, unlike quest_choices.
create table if not exists public.research_survey_choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.research_survey_questions(id) on delete cascade,
  choice_text text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_research_survey_choices_question on public.research_survey_choices(question_id);

-- One response per scholar per survey — upserted as questions are
-- answered, which is what makes a later "resume the survey later" phase
-- possible without redesigning this table.
create table if not exists public.research_survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.research_surveys(id) on delete cascade,
  scholar_id_number text not null references public.scholars(scholar_id_number),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (survey_id, scholar_id_number)
);
create index if not exists idx_research_survey_responses_survey on public.research_survey_responses(survey_id);

-- One row per (response, question), unique so an answer can be safely
-- upserted (edited before final submit) without creating duplicates.
create table if not exists public.research_survey_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.research_survey_responses(id) on delete cascade,
  question_id uuid not null references public.research_survey_questions(id) on delete cascade,
  choice_id uuid references public.research_survey_choices(id) on delete cascade,
  likert_value integer,
  answered_at timestamptz not null default now(),
  unique (response_id, question_id),
  constraint research_survey_answers_exactly_one_value check (num_nonnulls(choice_id, likert_value) = 1)
);
create index if not exists idx_research_survey_answers_response on public.research_survey_answers(response_id);
create index if not exists idx_research_survey_answers_question on public.research_survey_answers(question_id);

-- ── Row Level Security ──────────────────────────────────────
-- Staff-only for now (Phase B scope) — scholar-facing read/write on
-- responses/answers is added by the later attendance-gating phase,
-- alongside the RPCs that actually need it.
alter table public.research_surveys enable row level security;
alter table public.research_survey_questions enable row level security;
alter table public.research_survey_choices enable row level security;
alter table public.research_survey_responses enable row level security;
alter table public.research_survey_answers enable row level security;

drop policy if exists "research staff read" on public.research_surveys;
drop policy if exists "research staff write" on public.research_surveys;
drop policy if exists "research staff update" on public.research_surveys;
drop policy if exists "research staff delete" on public.research_surveys;
create policy "research staff read" on public.research_surveys for select using (public.is_research_monitoring_staff());
create policy "research staff write" on public.research_surveys for insert with check (public.is_research_monitoring_staff());
create policy "research staff update" on public.research_surveys for update using (public.is_research_monitoring_staff()) with check (public.is_research_monitoring_staff());
create policy "research staff delete" on public.research_surveys for delete using (public.is_research_monitoring_staff());

drop policy if exists "research staff read" on public.research_survey_questions;
drop policy if exists "research staff write" on public.research_survey_questions;
drop policy if exists "research staff update" on public.research_survey_questions;
drop policy if exists "research staff delete" on public.research_survey_questions;
create policy "research staff read" on public.research_survey_questions for select using (public.is_research_monitoring_staff());
create policy "research staff write" on public.research_survey_questions for insert with check (public.is_research_monitoring_staff());
create policy "research staff update" on public.research_survey_questions for update using (public.is_research_monitoring_staff()) with check (public.is_research_monitoring_staff());
create policy "research staff delete" on public.research_survey_questions for delete using (public.is_research_monitoring_staff());

drop policy if exists "research staff read" on public.research_survey_choices;
drop policy if exists "research staff write" on public.research_survey_choices;
drop policy if exists "research staff update" on public.research_survey_choices;
drop policy if exists "research staff delete" on public.research_survey_choices;
create policy "research staff read" on public.research_survey_choices for select using (public.is_research_monitoring_staff());
create policy "research staff write" on public.research_survey_choices for insert with check (public.is_research_monitoring_staff());
create policy "research staff update" on public.research_survey_choices for update using (public.is_research_monitoring_staff()) with check (public.is_research_monitoring_staff());
create policy "research staff delete" on public.research_survey_choices for delete using (public.is_research_monitoring_staff());

-- Responses/answers: staff can only READ (for Survey Results) — no staff
-- insert/update/delete policy, since staff never author these rows.
drop policy if exists "research staff read responses" on public.research_survey_responses;
create policy "research staff read responses" on public.research_survey_responses for select using (public.is_research_monitoring_staff());
drop policy if exists "research staff read answers" on public.research_survey_answers;
create policy "research staff read answers" on public.research_survey_answers for select using (public.is_research_monitoring_staff());

-- ── Survey Results aggregation RPC ──────────────────────────
-- Median/std-dev/percentage aggregates are awkward in plain PostgREST
-- selects, so this does it server-side in one call per question.
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

  return coalesce(v_result, case when v_question.question_type = 'multiple_choice' then '[]'::jsonb else jsonb_build_object('n', 0, 'mean', null, 'median', null, 'stddev', null, 'distribution', '[]'::jsonb) end);
end;
$$;
grant execute on function public.research_survey_question_results(uuid) to authenticated;
