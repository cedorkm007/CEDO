-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_upload_files.sql
--
-- Part 4 of the Submission Activity feature — extends
-- submission_uploads (created empty-shaped in Part 2, per that
-- migration's own comment: "ready for Parts 3-4 ... to populate") with
-- the columns a real Google Drive upload actually needs to record:
-- original filename, renamed filename, MIME type, the Google Drive file
-- id, and a status column Part 5's staff review will update.
-- activity_id, scholar_id, field_id, and field_label_snapshot already
-- existed from Part 2 and are unchanged here.
--
-- No rows exist in submission_uploads in any real deployment of this
-- feature yet — Part 2's scholar UI never wrote one (it only showed a
-- placeholder message) and Part 3 doesn't touch this table at all — so
-- this migration drops the two Part-2 placeholder columns (file_name,
-- file_url) rather than trying to preserve/backfill data that was never
-- written. If you HAVE somehow inserted real rows into submission_uploads
-- before running this, back them up first — this migration does not
-- migrate their data forward.
--
-- Safe to re-run — add/drop column if [not] exists throughout.
-- ─────────────────────────────────────────────────────────────

alter table public.submission_uploads drop column if exists file_name;
alter table public.submission_uploads drop column if exists file_url;

alter table public.submission_uploads add column if not exists original_file_name text not null default '';
alter table public.submission_uploads add column if not exists renamed_file_name text not null default '';
alter table public.submission_uploads add column if not exists mime_type text not null default '';
alter table public.submission_uploads add column if not exists drive_file_id text not null default '';

-- Part 5 will extend the set of values written here ('accepted' /
-- 'needs_resubmission') and add a staff_comment column once the review
-- UI exists to set them. 'uploaded' is the only value this round's Edge
-- Function (submission-upload-file) ever writes, so no CHECK constraint
-- is added yet — adding one now would just have to be altered again in
-- Part 5 for no benefit in between.
alter table public.submission_uploads add column if not exists status text not null default 'uploaded';

-- Supports submission-upload-file's per-(scholar, field) max-files check
-- (COUNT ... WHERE scholar_id = ? AND field_id = ?) and Part 5's
-- per-field review queries.
create index if not exists idx_submission_uploads_scholar_field
  on public.submission_uploads (scholar_id, field_id);

-- No RLS changes needed here — Part 2's "scholar creates own submissions"
-- / "scholar reads own submissions" / "staff read" policies already cover
-- these new columns (RLS is row-level, not column-level), and nothing in
-- this round adds an update or delete path for anyone. All inserts in
-- this round go through submission-upload-file's service-role client
-- anyway, which bypasses RLS by design (see supabase/functions/_shared/verifyScholar.ts).
