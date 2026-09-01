-- ─────────────────────────────────────────────────────────────
-- supabase_migration_kauban_media_storage.sql
--
-- Backs the Kauban integration (docs/kauban/MILESTONES.md, milestone 5).
-- Creates the Storage bucket that holds the sign-language video clips
-- referenced by kauban_sign_words.clip_video_path / tutorial_video_path
-- (see supabase_migration_kauban_content_schema.sql, run first).
--
-- Public bucket, same reasoning as the public-read table policies: these
-- are non-sensitive public educational videos played directly by
-- visitors with no account, so they need a plain public URL rather than
-- a signed one. Path convention: "clips/<filename>.mp4" for the short
-- muted speech-to-sign clips, "tutorial/<filename>.mp4" for the longer
-- tutorial versions — filenames are lowercase with no spaces, matching
-- the original app's own video-naming rule.
--
-- Run AFTER supabase_migration_kauban_content_schema.sql (reuses
-- is_kauban_staff()). Safe to re-run.
-- ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('kauban-media', 'kauban-media', true)
on conflict (id) do nothing;

drop policy if exists "kauban media is publicly readable" on storage.objects;
create policy "kauban media is publicly readable" on storage.objects
  for select using (bucket_id = 'kauban-media');

drop policy if exists "kauban staff manage media" on storage.objects;
create policy "kauban staff manage media" on storage.objects
  for all using (bucket_id = 'kauban-media' and public.is_kauban_staff())
  with check (bucket_id = 'kauban-media' and public.is_kauban_staff());
