-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_drive_folders.sql
--
-- Part 3 of the Submission Activity feature — Google Drive integration
-- FOUNDATION only (per this round's scope): no scholar file upload yet,
-- that's Part 4. This migration adds exactly one table:
--
--   submission_drive_folders — caches the Google Drive folder ids the new
--     submission-ensure-drive-folder Edge Function creates/reuses, one row
--     per (activity, scholar year level) pair. Repeated calls — a second
--     scholar in the same year level, the same scholar calling again, or
--     a second year level under the same activity — never create
--     duplicate "Activity Name" or "Year Level" folders in Drive.
--
-- The real duplicate-prevention mechanism is the Edge Function's
-- search-by-name-before-create call into the Drive API itself (see
-- supabase/functions/_shared/googleDrive.ts's findOrCreateFolder) — this
-- table is a fast path that skips the Drive API entirely on a cache hit,
-- not the only thing preventing duplicates.
--
-- Google credentials (service account email + private key) and the
-- parent Drive folder id are Edge Function secrets
-- (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
-- GOOGLE_DRIVE_PARENT_FOLDER_ID) — never stored in this database, never in
-- the frontend/Vite env, per this round's explicit instruction. See
-- docs/GOOGLE_DRIVE_SETUP.md for exact setup steps and placeholders.
--
-- Safe to re-run — create-if-not-exists / drop-then-create throughout.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.submission_drive_folders (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.submission_activities(id) on delete cascade,
  -- The scholar's own year_level (scholars.year_level) — NOT
  -- submission_activities.target_year_levels, which is the set of levels
  -- an activity is merely visible to. A scholar's actual year level is
  -- what decides which subfolder their uploads land in.
  year_level text not null,
  activity_folder_id text not null,
  year_level_folder_id text not null,
  created_at timestamptz not null default now(),
  unique (activity_id, year_level)
);

create index if not exists idx_submission_drive_folders_activity
  on public.submission_drive_folders (activity_id);

alter table public.submission_drive_folders enable row level security;

-- Only the Edge Function (service role, bypasses RLS) ever writes here —
-- no insert/update/delete policy exists for anyone, staff or scholar.
-- Staff get read access for visibility/debugging, matching the
-- broad-staff-read convention used everywhere else in this feature
-- (submission_activities, submission_upload_fields, submission_uploads).
-- No scholar policy at all — a scholar has no legitimate reason to read
-- raw Drive folder ids.
drop policy if exists "staff read" on public.submission_drive_folders;
create policy "staff read" on public.submission_drive_folders
  for select using (public.is_sead_staff());
