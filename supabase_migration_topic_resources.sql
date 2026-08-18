-- ─────────────────────────────────────────────────────────────
-- supabase_migration_topic_resources.sql
--
-- Adds optional "Review Materials" resource links to each quest topic:
--   * slide_url — a Google Slides / Canva / any HTTPS slide-deck link
--   * video_url — a YouTube / Google Drive / any HTTPS video link
--
-- The topic table previously had a single `youtube_url` column (despite
-- the name, it already supported Google Drive links too — see
-- getLectureEmbed in src/scholar/quizApi.ts). It's renamed here to
-- `video_url` for clarity now that a separate slide-deck link exists
-- alongside it. Existing video links are preserved by the rename.
--
-- Both columns are nullable/optional — existing topics and questions
-- keep working unchanged when no links are set.
--
-- Run this in the Supabase SQL Editor before deploying the corresponding
-- app changes. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- Rename the old youtube_url column to video_url (only if this hasn't
-- already been done and the old column still exists), preserving data.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quest_topics' and column_name = 'youtube_url'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quest_topics' and column_name = 'video_url'
  ) then
    alter table public.quest_topics rename column youtube_url to video_url;
  end if;
end $$;

-- Ensure both resource columns exist (covers fresh installs that never
-- had youtube_url, and is a no-op if the rename above already created it).
alter table public.quest_topics add column if not exists video_url text;
alter table public.quest_topics add column if not exists slide_url text;

-- Defense-in-depth: only allow blank or well-formed https:// links at the
-- database layer too (the app validates before it ever gets here).
alter table public.quest_topics drop constraint if exists quest_topics_video_url_https;
alter table public.quest_topics add constraint quest_topics_video_url_https
  check (video_url is null or video_url = '' or video_url ~* '^https://');

alter table public.quest_topics drop constraint if exists quest_topics_slide_url_https;
alter table public.quest_topics add constraint quest_topics_slide_url_https
  check (slide_url is null or slide_url = '' or slide_url ~* '^https://');
