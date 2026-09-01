-- ─────────────────────────────────────────────────────────────
-- supabase_migration_kauban_content_schema.sql
--
-- Backs the Kauban integration (docs/kauban/MILESTONES.md, milestone 4).
-- Kauban is a sign-language/speech accessibility tool for deaf and
-- hard-of-hearing learners, served publicly at /kauban/ with NO user
-- registration — visitors never sign in, so these tables are read
-- through the anon key. The only thing that needs to change is the
-- content itself: sign words + their videos, quick phrases, and the
-- bundled emergency contacts/messages. Personal role choice and
-- personal emergency contacts stay in the visitor's own browser
-- localStorage — there is no per-visitor row anywhere in this schema.
--
-- Six tables, all content, no accounts:
--   kauban_sign_categories         - groupings for sign words (Greetings, Family, ...)
--   kauban_sign_words              - one row per taught word/phrase + its two video variants
--   kauban_quick_phrase_categories - groupings for quick phrases
--   kauban_quick_phrases           - the built-in quick-phrase text
--   kauban_emergency_contacts      - bundled hotline numbers (911, crisis line, ...)
--   kauban_emergency_messages      - bundled canned emergency messages
--
-- Writes are restricted to staff accounts tagged 'kauban_content' (see
-- src/app/staffToolTags.ts) via is_kauban_staff(), reusing the same
-- staff_account_tags table and auth.uid()-based pattern as
-- is_formation_staff() in supabase_migration_formation_positions.sql.
-- Reads are open to everyone (anon + authenticated) since this content
-- is public educational material, not sensitive data.
--
-- Video files themselves live in Supabase Storage (bucket 'kauban-media',
-- set up separately in milestone 5) — clip_video_path/tutorial_video_path
-- below just store the object path within that bucket.
--
-- Run this AFTER supabase_migration_formation_positions.sql (reuses the
-- staff_account_tags table). Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.kauban_sign_categories (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label      text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kauban_sign_words (
  id                  uuid primary key default gen_random_uuid(),
  category_id         uuid not null references public.kauban_sign_categories(id) on delete cascade,
  -- Lowercase, matched word-for-word against speech transcripts by the
  -- Speech-to-Sign-Language screen — must stay lowercase for that matching
  -- to work, hence the check constraint rather than relying on callers.
  phrase              text not null unique check (phrase = lower(phrase)),
  label               text not null,
  clip_video_path     text,
  tutorial_video_path text,
  sort_order          int  not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_kauban_sign_words_category on public.kauban_sign_words (category_id);

create table if not exists public.kauban_quick_phrase_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  icon       text,
  color      text not null default '#3B82F6',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kauban_quick_phrases (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.kauban_quick_phrase_categories(id) on delete cascade,
  text        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_kauban_quick_phrases_category on public.kauban_quick_phrases (category_id);

create table if not exists public.kauban_emergency_contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  number     text not null,
  color      text not null default '#E53E3E',
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kauban_emergency_messages (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_kauban_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'kauban_content'
  );
$$;

alter table public.kauban_sign_categories         enable row level security;
alter table public.kauban_sign_words              enable row level security;
alter table public.kauban_quick_phrase_categories enable row level security;
alter table public.kauban_quick_phrases           enable row level security;
alter table public.kauban_emergency_contacts      enable row level security;
alter table public.kauban_emergency_messages      enable row level security;

drop policy if exists "kauban content is publicly readable" on public.kauban_sign_categories;
create policy "kauban content is publicly readable" on public.kauban_sign_categories for select using (true);
drop policy if exists "kauban staff manage sign categories" on public.kauban_sign_categories;
create policy "kauban staff manage sign categories" on public.kauban_sign_categories
  for all using (public.is_kauban_staff()) with check (public.is_kauban_staff());

drop policy if exists "kauban content is publicly readable" on public.kauban_sign_words;
create policy "kauban content is publicly readable" on public.kauban_sign_words for select using (true);
drop policy if exists "kauban staff manage sign words" on public.kauban_sign_words;
create policy "kauban staff manage sign words" on public.kauban_sign_words
  for all using (public.is_kauban_staff()) with check (public.is_kauban_staff());

drop policy if exists "kauban content is publicly readable" on public.kauban_quick_phrase_categories;
create policy "kauban content is publicly readable" on public.kauban_quick_phrase_categories for select using (true);
drop policy if exists "kauban staff manage quick phrase categories" on public.kauban_quick_phrase_categories;
create policy "kauban staff manage quick phrase categories" on public.kauban_quick_phrase_categories
  for all using (public.is_kauban_staff()) with check (public.is_kauban_staff());

drop policy if exists "kauban content is publicly readable" on public.kauban_quick_phrases;
create policy "kauban content is publicly readable" on public.kauban_quick_phrases for select using (true);
drop policy if exists "kauban staff manage quick phrases" on public.kauban_quick_phrases;
create policy "kauban staff manage quick phrases" on public.kauban_quick_phrases
  for all using (public.is_kauban_staff()) with check (public.is_kauban_staff());

drop policy if exists "kauban content is publicly readable" on public.kauban_emergency_contacts;
create policy "kauban content is publicly readable" on public.kauban_emergency_contacts for select using (true);
drop policy if exists "kauban staff manage emergency contacts" on public.kauban_emergency_contacts;
create policy "kauban staff manage emergency contacts" on public.kauban_emergency_contacts
  for all using (public.is_kauban_staff()) with check (public.is_kauban_staff());

drop policy if exists "kauban content is publicly readable" on public.kauban_emergency_messages;
create policy "kauban content is publicly readable" on public.kauban_emergency_messages for select using (true);
drop policy if exists "kauban staff manage emergency messages" on public.kauban_emergency_messages;
create policy "kauban staff manage emergency messages" on public.kauban_emergency_messages
  for all using (public.is_kauban_staff()) with check (public.is_kauban_staff());
