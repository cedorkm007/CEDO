-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_drive_folders_school.sql
--
-- Milestone 1 of the "Drive folder reorganization + submission
-- monitoring" task. Adds a third Drive folder level — School — under
-- the existing Activity Name / Scholar Year Level structure, so
-- uploads land in:
--   Parent Folder / Activity Name / Scholar Year Level / School / <files>
-- instead of the current:
--   Parent Folder / Activity Name / Scholar Year Level / <files>
--
-- `school` is added NULLABLE — deliberately NOT `not null default ''`.
-- Postgres treats every NULL as distinct from every other NULL for
-- uniqueness purposes, and the application code from this point on
-- always supplies a real string for `school` on every new row (using
-- '' specifically for a scholar with no school set, never NULL — see
-- ensureSubmissionDriveFolders.ts). That means:
--   - every EXISTING (pre-this-migration) cache row keeps school = NULL
--     and can never be matched by any post-migration `.eq("school", x)`
--     lookup, for any x, blank or not — so it simply becomes inert once
--     the new code deploys, rather than being reinterpreted or
--     needing a backfill value that would otherwise have to be invented
--     out of thin air (a real per-scholar school isn't recoverable from
--     the cache row itself, since it only ever stored a folder id, not
--     which scholars used it).
--   - every NEW row always has a concrete `school` value, so two
--     scholars with the same blank school correctly share one "No
--     School Set" folder going forward, distinctly from any legacy row.
-- What (if anything) happens to the OLD rows' underlying Drive folders/
-- files is Milestone 2's own decision, not this migration's concern —
-- this migration only prepares the schema so new uploads can start
-- using the third level; it does not touch any existing row's data.
--
-- Safe to re-run — add column if not exists / drop-then-create
-- constraint throughout.
-- ─────────────────────────────────────────────────────────────

alter table public.submission_drive_folders add column if not exists school text;
alter table public.submission_drive_folders add column if not exists school_folder_id text;

-- Widen the old (activity_id, year_level) uniqueness to also include
-- school. The old constraint's name is Postgres's own default naming
-- for an unnamed inline `unique (...)` clause — confirmed against the
-- original supabase_migration_submission_drive_folders.sql, which never
-- gave it an explicit name.
alter table public.submission_drive_folders
  drop constraint if exists submission_drive_folders_activity_id_year_level_key;
alter table public.submission_drive_folders
  drop constraint if exists submission_drive_folders_activity_year_school_key;
alter table public.submission_drive_folders
  add constraint submission_drive_folders_activity_year_school_key
  unique (activity_id, year_level, school);
