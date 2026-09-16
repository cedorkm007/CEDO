-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_delete_file.sql
--
-- Lets forms_management staff delete an attached submission file from
-- the Review Submissions panel — either standalone, or automatically
-- when a submission is marked "Needs Resubmission" (so the scholar
-- re-uploads into a clean slot rather than leaving the rejected file
-- sitting there). The submission_uploads row itself is never deleted
-- (there is no DELETE policy on this table, and removing the row would
-- destroy the review audit trail — staff_comment/reviewed_by/
-- reviewed_at/original_file_name) — only the file reference is
-- cleared, by the new submission-delete-file Edge Function (service
-- role, mirrors submission-upload-file's own storage-write pattern;
-- no new RLS/storage policy needed since this bucket's only write path
-- has always been through Edge Functions with service-role, bypassing
-- RLS entirely).
--
-- file_removed_at makes "staff deleted this file" an explicit, durable
-- signal distinct from "not yet backfilled off Drive" (which also
-- leaves storage_path empty) — inferring deletion from storage_path
-- being blank alone would conflate the two states.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.submission_uploads
  add column if not exists file_removed_at timestamptz;
