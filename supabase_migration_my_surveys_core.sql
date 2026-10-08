-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_core.sql
--
-- Phase 1 of "My Surveys" -- a staff form/survey builder. Every signed-in
-- staff member can create surveys, share them with other staff, and (in
-- later phases) collect anonymous responses through a public link/QR that
-- feed the Research Project Monitoring tool.
--
-- This migration creates the WHOLE data model up front (so later phases
-- never need a painful schema rewrite) plus the security model:
--
--   * Roles: owner (my_surveys.owner_id) / editor / viewer (my_survey_shares).
--     my_survey_role() resolves the caller's role for a survey; every RLS
--     policy below goes through it, so permissions are enforced by the
--     database on every request -- not just by hiding buttons.
--   * Owner: everything, incl. delete + managing shares.
--     Editor: edit survey/sections/questions/options + view responses.
--     Viewer: read the survey and its responses only.
--   * Responses/answers have NO staff write policy at all. The public,
--     no-login respondent writes arrive in Phase 3 as security-definer RPCs
--     (same "never grant anon a raw table write" idiom as My Presentations'
--     audience voting). anon has no policy on any table here.
--
-- Question versioning (so editing a question after responses exist never
-- rewrites history): a question row is immutable once it has answers. The
-- builder (Phase 2) "edits" it by archiving the old row (archived_at) and
-- inserting a new row with the same question_key and version + 1. Answers
-- point at the exact row (= exact wording/options) that was answered.
--
-- Table names are prefixed my_survey_ on purpose: the older research_surveys*
-- tables (scholar, activity-attached surveys for Research Project
-- Monitoring) are a different system and are not touched here.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── Tables ──────────────────────────────────────────────────

create table if not exists public.my_surveys (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null references public.users(id) on delete cascade,
  title                   text not null default 'Untitled survey' check (char_length(title) <= 200),
  description             text not null default '',
  status                  text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  public_slug             text unique,                       -- set at publish time (Phase 3)
  consent_enabled         boolean not null default false,    -- Data Privacy Act consent screen
  consent_text            text not null default '',
  closes_at               timestamptz,
  response_limit          integer check (response_limit is null or response_limit > 0),
  one_response_per_device boolean not null default false,
  thank_you_message       text not null default 'Thank you for your response!',
  revision                integer not null default 1,        -- bumped on every update; used for edit-conflict detection (Phase 2)
  last_edited_by          uuid references public.users(id) on delete set null,
  published_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists public.my_survey_sections (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references public.my_surveys(id) on delete cascade,
  title       text not null default 'Untitled section',
  description text not null default '',
  order_index integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.my_survey_questions (
  id                 uuid primary key default gen_random_uuid(),
  survey_id          uuid not null references public.my_surveys(id) on delete cascade,
  section_id         uuid references public.my_survey_sections(id) on delete set null,
  question_key       uuid not null default gen_random_uuid(),  -- identity that stays the same across versions
  version            integer not null default 1,
  archived_at        timestamptz,                               -- non-null = replaced by a newer version
  order_index        integer not null default 0,
  question_type      text not null check (question_type in (
    'short_answer', 'paragraph', 'multiple_choice', 'checkboxes', 'dropdown',
    'linear_scale', 'rating', 'date', 'time'
  )),
  question_text      text not null default '',
  help_text          text not null default '',
  required           boolean not null default false,
  scale_min          integer,
  scale_max          integer,
  scale_min_label    text not null default '',
  scale_max_label    text not null default '',
  created_at         timestamptz not null default now(),
  unique (id, survey_id),                                       -- target for the composite FKs below
  unique (survey_id, question_key, version),
  constraint my_survey_questions_scale_fields check (
    question_type not in ('linear_scale', 'rating')
    or (scale_max is not null and scale_max > coalesce(scale_min, 1))
  )
);

create table if not exists public.my_survey_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  survey_id   uuid not null,
  label       text not null,
  order_index integer not null default 0,
  created_at  timestamptz not null default now(),
  -- survey_id is denormalised so RLS needs no join; this FK makes it impossible
  -- for it to disagree with the question's own survey.
  foreign key (question_id, survey_id) references public.my_survey_questions (id, survey_id) on delete cascade
);

create table if not exists public.my_survey_shares (
  survey_id  uuid not null references public.my_surveys(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  role       text not null check (role in ('editor', 'viewer')),
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (survey_id, user_id)
);

create table if not exists public.my_survey_responses (
  id                uuid primary key default gen_random_uuid(),
  survey_id         uuid not null references public.my_surveys(id) on delete cascade,
  device_id         text,                                  -- random id from the respondent's browser (one-per-device)
  consent_given     boolean not null default false,
  submitted_at      timestamptz not null default now(),    -- the submission date and time
  unique (id, survey_id)
);

-- One row per answer. Choice questions store the picked option in option_id
-- (checkboxes = one row per ticked option); everything else stores value_text
-- (short answer, paragraph, date as YYYY-MM-DD, time as HH:MM) or value_number
-- (linear scale, rating).
create table if not exists public.my_survey_answers (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null,
  survey_id    uuid not null,
  question_id  uuid not null,
  option_id    uuid references public.my_survey_options(id) on delete cascade,
  value_text   text,
  value_number numeric,
  created_at   timestamptz not null default now(),
  foreign key (response_id, survey_id) references public.my_survey_responses (id, survey_id) on delete cascade,
  foreign key (question_id, survey_id) references public.my_survey_questions (id, survey_id) on delete cascade,
  constraint my_survey_answers_has_value check (num_nonnulls(option_id, value_text, value_number) >= 1)
);

-- ── Indexes ─────────────────────────────────────────────────

create index if not exists idx_my_surveys_owner on public.my_surveys (owner_id, updated_at desc);
create index if not exists idx_my_survey_sections_survey on public.my_survey_sections (survey_id, order_index);
create index if not exists idx_my_survey_questions_survey on public.my_survey_questions (survey_id, order_index);
create index if not exists idx_my_survey_options_question on public.my_survey_options (question_id, order_index);
create index if not exists idx_my_survey_options_survey on public.my_survey_options (survey_id);
create index if not exists idx_my_survey_shares_user on public.my_survey_shares (user_id);
create index if not exists idx_my_survey_responses_survey on public.my_survey_responses (survey_id, submitted_at);
create index if not exists idx_my_survey_responses_device on public.my_survey_responses (survey_id, device_id) where device_id is not null;
create index if not exists idx_my_survey_answers_response on public.my_survey_answers (response_id);
create index if not exists idx_my_survey_answers_question on public.my_survey_answers (question_id);
create index if not exists idx_my_survey_answers_survey on public.my_survey_answers (survey_id);
-- One answer row per (response, question) for single-value questions, and one per
-- (response, question, option) for choice questions.
create unique index if not exists uq_my_survey_answers_single on public.my_survey_answers (response_id, question_id) where option_id is null;
create unique index if not exists uq_my_survey_answers_option on public.my_survey_answers (response_id, question_id, option_id) where option_id is not null;

-- ── Role helper ─────────────────────────────────────────────
-- security definer so it can read my_surveys/my_survey_shares without going
-- through their own RLS (which itself calls this function -- no recursion).
-- Returns 'owner' | 'editor' | 'viewer', or null for no access at all.

create or replace function public.my_survey_role(p_survey_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when s.owner_id = auth.uid() then 'owner'
    else (select sh.role from public.my_survey_shares sh where sh.survey_id = s.id and sh.user_id = auth.uid())
  end
  from public.my_surveys s
  where s.id = p_survey_id;
$$;
revoke execute on function public.my_survey_role(uuid) from public, anon;
grant execute on function public.my_survey_role(uuid) to authenticated;

-- ── Guard trigger ───────────────────────────────────────────
-- Ownership can never be changed by an update (an editor must not be able to
-- hand the survey to themselves), and every update stamps who/when/revision
-- server-side so a client can't fake "last edited by".

create or replace function public.my_surveys_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'The owner of a survey cannot be changed.';
  end if;
  new.updated_at := now();
  new.last_edited_by := coalesce(auth.uid(), old.last_edited_by);
  new.revision := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists trg_my_surveys_guard_update on public.my_surveys;
create trigger trg_my_surveys_guard_update before update on public.my_surveys
  for each row execute function public.my_surveys_guard_update();

-- ── Row Level Security ──────────────────────────────────────

alter table public.my_surveys          enable row level security;
alter table public.my_survey_sections  enable row level security;
alter table public.my_survey_questions enable row level security;
alter table public.my_survey_options   enable row level security;
alter table public.my_survey_shares    enable row level security;
alter table public.my_survey_responses enable row level security;
alter table public.my_survey_answers   enable row level security;

-- my_surveys
-- owner_id is checked directly (not only via my_survey_role) on purpose: an
-- INSERT ... RETURNING re-checks this policy against the row being inserted,
-- and my_survey_role() runs its own query that cannot see that not-yet-committed
-- row -- so without the direct check, a staff member's own insert-and-return
-- (which is exactly what "New Survey" does) is rejected.
drop policy if exists "survey members read" on public.my_surveys;
create policy "survey members read" on public.my_surveys for select
  using (owner_id = auth.uid() or public.my_survey_role(id) is not null);
drop policy if exists "staff create own survey" on public.my_surveys;
create policy "staff create own survey" on public.my_surveys for insert
  with check (owner_id = auth.uid());
drop policy if exists "owner and editors update survey" on public.my_surveys;
create policy "owner and editors update survey" on public.my_surveys for update
  using (public.my_survey_role(id) in ('owner', 'editor'))
  with check (public.my_survey_role(id) in ('owner', 'editor'));
drop policy if exists "owner deletes survey" on public.my_surveys;
create policy "owner deletes survey" on public.my_surveys for delete
  using (public.my_survey_role(id) = 'owner');

-- sections / questions / options: any member reads, owner+editor write
drop policy if exists "members read sections" on public.my_survey_sections;
create policy "members read sections" on public.my_survey_sections for select
  using (public.my_survey_role(survey_id) is not null);
drop policy if exists "editors write sections" on public.my_survey_sections;
create policy "editors write sections" on public.my_survey_sections for all
  using (public.my_survey_role(survey_id) in ('owner', 'editor'))
  with check (public.my_survey_role(survey_id) in ('owner', 'editor'));

drop policy if exists "members read questions" on public.my_survey_questions;
create policy "members read questions" on public.my_survey_questions for select
  using (public.my_survey_role(survey_id) is not null);
drop policy if exists "editors write questions" on public.my_survey_questions;
create policy "editors write questions" on public.my_survey_questions for all
  using (public.my_survey_role(survey_id) in ('owner', 'editor'))
  with check (public.my_survey_role(survey_id) in ('owner', 'editor'));

drop policy if exists "members read options" on public.my_survey_options;
create policy "members read options" on public.my_survey_options for select
  using (public.my_survey_role(survey_id) is not null);
drop policy if exists "editors write options" on public.my_survey_options;
create policy "editors write options" on public.my_survey_options for all
  using (public.my_survey_role(survey_id) in ('owner', 'editor'))
  with check (public.my_survey_role(survey_id) in ('owner', 'editor'));

-- shares: members can see who has access; only the owner manages it
drop policy if exists "members read shares" on public.my_survey_shares;
create policy "members read shares" on public.my_survey_shares for select
  using (public.my_survey_role(survey_id) is not null);
drop policy if exists "owner manages shares" on public.my_survey_shares;
create policy "owner manages shares" on public.my_survey_shares for all
  using (public.my_survey_role(survey_id) = 'owner')
  with check (public.my_survey_role(survey_id) = 'owner');

-- responses / answers: read-only for staff (any role). Writes come only from
-- the Phase 3 security-definer submit RPC.
drop policy if exists "members read responses" on public.my_survey_responses;
create policy "members read responses" on public.my_survey_responses for select
  using (public.my_survey_role(survey_id) is not null);
drop policy if exists "members read answers" on public.my_survey_answers;
create policy "members read answers" on public.my_survey_answers for select
  using (public.my_survey_role(survey_id) is not null);

-- ── List RPC (powers the My Surveys / Shared with me tabs) ──
-- security INVOKER on purpose: RLS above decides which surveys the caller can
-- see, this just adds the owner's name, the response count, and the caller's role.

create or replace function public.list_my_surveys(p_scope text default 'mine')
returns table (
  id uuid,
  title text,
  status text,
  public_slug text,
  owner_id uuid,
  owner_name text,
  my_role text,
  response_count bigint,
  last_edited_by_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    s.id,
    s.title,
    s.status,
    s.public_slug,
    s.owner_id,
    nullif(trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')), '') as owner_name,
    public.my_survey_role(s.id) as my_role,
    (select count(*) from public.my_survey_responses r where r.survey_id = s.id) as response_count,
    nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '') as last_edited_by_name,
    s.created_at,
    s.updated_at
  from public.my_surveys s
  left join public.users o on o.id = s.owner_id
  left join public.users e on e.id = s.last_edited_by
  where case when p_scope = 'shared' then s.owner_id <> auth.uid() else s.owner_id = auth.uid() end
  order by s.updated_at desc;
$$;
revoke execute on function public.list_my_surveys(text) from public, anon;
grant execute on function public.list_my_surveys(text) to authenticated;

-- ── Duplicate RPC ───────────────────────────────────────────
-- Atomic deep copy as a new Draft owned by the caller. Any member (incl. a
-- viewer) may duplicate a survey they can read. Only the CURRENT version of
-- each question is copied (archived versions are history, not content), and
-- the copy starts fresh: new link, no responses, no sharing.

create or replace function public.duplicate_my_survey(p_survey_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid;
  v_sec record;
  v_q record;
  v_new_sec uuid;
  v_new_q uuid;
  v_sec_map jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or public.my_survey_role(p_survey_id) is null then
    raise exception 'Not authorized.';
  end if;

  insert into public.my_surveys (
    owner_id, title, description, consent_enabled, consent_text,
    response_limit, one_response_per_device, thank_you_message, last_edited_by
  )
  select auth.uid(), left('Copy of ' || s.title, 200), s.description, s.consent_enabled, s.consent_text,
         s.response_limit, s.one_response_per_device, s.thank_you_message, auth.uid()
  from public.my_surveys s where s.id = p_survey_id
  returning id into v_new;

  for v_sec in select * from public.my_survey_sections where survey_id = p_survey_id order by order_index loop
    insert into public.my_survey_sections (survey_id, title, description, order_index)
    values (v_new, v_sec.title, v_sec.description, v_sec.order_index)
    returning id into v_new_sec;
    v_sec_map := v_sec_map || jsonb_build_object(v_sec.id::text, v_new_sec);
  end loop;

  for v_q in select * from public.my_survey_questions where survey_id = p_survey_id and archived_at is null order by order_index loop
    insert into public.my_survey_questions (
      survey_id, section_id, order_index, question_type, question_text, help_text, required,
      scale_min, scale_max, scale_min_label, scale_max_label
    )
    values (
      v_new, (v_sec_map ->> v_q.section_id::text)::uuid, v_q.order_index, v_q.question_type, v_q.question_text,
      v_q.help_text, v_q.required, v_q.scale_min, v_q.scale_max, v_q.scale_min_label, v_q.scale_max_label
    )
    returning id into v_new_q;

    insert into public.my_survey_options (question_id, survey_id, label, order_index)
    select v_new_q, v_new, o.label, o.order_index
    from public.my_survey_options o where o.question_id = v_q.id;
  end loop;

  return v_new;
end;
$$;
revoke execute on function public.duplicate_my_survey(uuid) from public, anon;
grant execute on function public.duplicate_my_survey(uuid) to authenticated;
