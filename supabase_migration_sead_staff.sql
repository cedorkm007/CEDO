-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sead_staff.sql
--
-- Adds the SEAD staff toolset on top of the existing staff/admin +
-- scholar portal database:
--   - A flag marking which existing staff accounts belong to SEAD
--   - The Quests question bank: Subjects -> Topics -> Questions -> Choices
--   - Links scholar_quest_scores to a subject/topic so SEAD staff can
--     filter monitoring by them
--
-- Run this AFTER supabase_migration_scholar_portal.sql.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Mark which staff accounts are SEAD staff ─────────────
-- Additive only — does not touch your existing role column or its
-- constraints. A SEAD staff member is simply an existing public.users
-- row (staff/division_admin/super_admin, whatever it already is) with
-- this flag also set to true.
alter table public.users add column if not exists is_sead_staff boolean not null default false;

create or replace function public.is_sead_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.users u where u.id = auth.uid() and u.is_sead_staff = true
  );
$$;

grant execute on function public.is_sead_staff() to authenticated;

-- To authorize the "sead.sma1" account (the one gated in the app's UI —
-- see SCHOLAR_MANAGEMENT_USERNAME in src/app/App.tsx) to actually write to
-- the question bank and manage scholar accounts, run this once:
--   update public.users set is_sead_staff = true where username = 'sead.sma1';
-- This is the REAL security boundary — the UI only hides the nav item for
-- everyone else; this flag (checked by RLS below) is what actually blocks
-- writes at the database level.

-- ── 2. Question bank: Subjects ──────────────────────────────
create table if not exists public.quest_subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── 3. Question bank: Topics (belong to a Subject) ──────────
create table if not exists public.quest_topics (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.quest_subjects(id) on delete cascade,
  name        text not null,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (subject_id, name)
);
create index if not exists idx_quest_topics_subject on public.quest_topics (subject_id);

-- ── 4. Question bank: Questions (belong to a Topic) ─────────
create table if not exists public.quest_questions (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references public.quest_topics(id) on delete cascade,
  question_text text not null,
  points       numeric not null default 1,
  is_active    boolean not null default true,
  created_by   uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_quest_questions_topic on public.quest_questions (topic_id);

-- ── 5. Question bank: Choices (belong to a Question) ────────
-- Choices are stored in one authored order (sort_order); the SCHOLAR-FACING
-- app is responsible for shuffling them at render time (e.g.
-- `choices.slice().sort(() => Math.random() - 0.5)`), so each viewer sees
-- a different order without the database needing to store per-user state.
create table if not exists public.quest_choices (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.quest_questions(id) on delete cascade,
  choice_text  text not null,
  is_correct   boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_quest_choices_question on public.quest_choices (question_id);

-- ── 6. Link scores to subject/topic for filtering ───────────
alter table public.scholar_quest_scores add column if not exists subject_id uuid references public.quest_subjects(id);
alter table public.scholar_quest_scores add column if not exists topic_id uuid references public.quest_topics(id);
create index if not exists idx_sqs_subject on public.scholar_quest_scores (subject_id);
create index if not exists idx_sqs_topic on public.scholar_quest_scores (topic_id);

-- ── 7. Row Level Security ────────────────────────────────────
alter table public.quest_subjects enable row level security;
alter table public.quest_topics enable row level security;
alter table public.quest_questions enable row level security;
alter table public.quest_choices enable row level security;

-- Any CEDO staff can READ the question bank (visibility for monitoring/context).
-- Only SEAD staff can WRITE it (add/edit/delete subjects, topics, questions, choices).
drop policy if exists "staff read" on public.quest_subjects;
create policy "staff read" on public.quest_subjects for select using (public.is_cedo_staff());
drop policy if exists "sead staff write" on public.quest_subjects;
create policy "sead staff write" on public.quest_subjects for insert with check (public.is_sead_staff());
drop policy if exists "sead staff update" on public.quest_subjects;
create policy "sead staff update" on public.quest_subjects for update using (public.is_sead_staff()) with check (public.is_sead_staff());
drop policy if exists "sead staff delete" on public.quest_subjects;
create policy "sead staff delete" on public.quest_subjects for delete using (public.is_sead_staff());

drop policy if exists "staff read" on public.quest_topics;
create policy "staff read" on public.quest_topics for select using (public.is_cedo_staff());
drop policy if exists "sead staff write" on public.quest_topics;
create policy "sead staff write" on public.quest_topics for insert with check (public.is_sead_staff());
drop policy if exists "sead staff update" on public.quest_topics;
create policy "sead staff update" on public.quest_topics for update using (public.is_sead_staff()) with check (public.is_sead_staff());
drop policy if exists "sead staff delete" on public.quest_topics;
create policy "sead staff delete" on public.quest_topics for delete using (public.is_sead_staff());

drop policy if exists "staff read" on public.quest_questions;
create policy "staff read" on public.quest_questions for select using (public.is_cedo_staff());
drop policy if exists "sead staff write" on public.quest_questions;
create policy "sead staff write" on public.quest_questions for insert with check (public.is_sead_staff());
drop policy if exists "sead staff update" on public.quest_questions;
create policy "sead staff update" on public.quest_questions for update using (public.is_sead_staff()) with check (public.is_sead_staff());
drop policy if exists "sead staff delete" on public.quest_questions;
create policy "sead staff delete" on public.quest_questions for delete using (public.is_sead_staff());

drop policy if exists "staff read" on public.quest_choices;
create policy "staff read" on public.quest_choices for select using (public.is_cedo_staff());
drop policy if exists "sead staff write" on public.quest_choices;
create policy "sead staff write" on public.quest_choices for insert with check (public.is_sead_staff());
drop policy if exists "sead staff update" on public.quest_choices;
create policy "sead staff update" on public.quest_choices for update using (public.is_sead_staff()) with check (public.is_sead_staff());
drop policy if exists "sead staff delete" on public.quest_choices;
create policy "sead staff delete" on public.quest_choices for delete using (public.is_sead_staff());

-- Note: scholars do NOT get read access to quest_questions/quest_choices in
-- this migration — there's no quiz-taking UI yet (tracked as future work),
-- and granting it early would let a scholar fetch the answer key directly
-- via the anon key. Add a scoped policy (or better, a "start attempt" RPC
-- that returns choices WITHOUT is_correct) when that feature is built.

-- scholar_quest_scores already has RLS from supabase_migration_scholar_portal.sql
-- (staff full access, scholar reads own) — the two new columns are covered
-- by those existing policies automatically, no changes needed there.
