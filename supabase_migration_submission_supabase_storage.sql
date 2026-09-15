-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_supabase_storage.sql
--
-- Moves Submission Activity file storage off Google Drive onto Supabase
-- Storage. submission_uploads gets two new columns:
--   - storage_path: the object's path in the new "submission-uploads"
--     bucket, null until a row has actually been uploaded/backfilled there.
--   - file_size_bytes: the stored (post-compression, where applicable)
--     file's size, for reference/diagnostics.
--
-- drive_file_id is deliberately NOT dropped here — it stays as the marker
-- for "not yet backfilled" (storage_path is null and drive_file_id != '').
-- New uploads write drive_file_id = '' going forward. Drop it in a later,
-- separate migration once the one-time backfill (see
-- supabase/functions/submission-backfill-drive-files) is confirmed to have
-- reached 0 remaining rows and the original Drive files' fate has been
-- decided (never auto-deleted by this migration or the backfill function).
--
-- submission_drive_folders is likewise left in place (harmless, still
-- readable) — just marked deprecated via a table comment.
--
-- The new bucket is private. Staff read access uses public.is_sead_staff()
-- to match submission_uploads' OWN staff-read policy exactly (confirmed by
-- reading supabase_migration_submission_uploads.sql directly) — NOT the
-- forms_management tag, which only ever gates writes/reviews on this
-- feature, never reads. Scholars never get a bucket policy: they don't
-- touch this bucket directly, the submission-upload-file Edge Function's
-- service-role client does all writes on their behalf, same as
-- submission_uploads itself has no scholar update/delete policy.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.submission_uploads add column if not exists storage_path text;
alter table public.submission_uploads add column if not exists file_size_bytes bigint;

create index if not exists idx_submission_uploads_needs_backfill
  on public.submission_uploads (created_at)
  where storage_path is null and drive_file_id != '';

comment on table public.submission_drive_folders is
  'DEPRECATED as of the Supabase Storage migration (supabase_migration_submission_supabase_storage.sql) — no longer written to by submission-upload-file. Kept only until the one-time backfill (submission-backfill-drive-files) is confirmed fully run. Safe to drop in a future migration once that''s confirmed.';

insert into storage.buckets (id, name, public)
values ('submission-uploads', 'submission-uploads', false)
on conflict (id) do nothing;

drop policy if exists "staff reads submission uploads" on storage.objects;
create policy "staff reads submission uploads" on storage.objects
  for select using (bucket_id = 'submission-uploads' and public.is_sead_staff());
