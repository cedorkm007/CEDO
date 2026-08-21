-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_review.sql
--
-- Part 5 of the Submission Activity feature — staff review.
--
-- Extends submission_uploads.status (Part 4: only ever wrote 'uploaded')
-- with the two staff-set review outcomes, adds a staff_comment column for
-- the "needs resubmission" reason, and records who/when reviewed each
-- row. Per Part 4 handoff's own forward note ("Part 5 will extend the set
-- of values written here ... and add a staff_comment column once the
-- review UI exists to set them"), review state lives on
-- submission_uploads itself (per uploaded file), not a new separate
-- table.
--
-- The staff review UI (SubmissionReviewPanel.tsx) applies one status/
-- comment pair to every file a scholar has uploaded for one activity in
-- a single action — "mark a scholar submission as accepted / needs
-- resubmission", per the spec — rather than reviewing file-by-file, so
-- in practice all of one scholar's rows for one activity end up carrying
-- the same status/staff_comment together. That's a client-side
-- convention (see reviewSubmissionUploads in
-- src/sead/submissionActivitiesApi.ts), not something this migration
-- needs to enforce structurally — a second per-scholar-per-activity
-- table would be redundant with what's already here.
--
-- Safe to re-run — add column if not exists / drop-then-create
-- constraint/policy throughout.
-- ─────────────────────────────────────────────────────────────

alter table public.submission_uploads add column if not exists staff_comment text not null default '';
alter table public.submission_uploads add column if not exists reviewed_by uuid references public.users(id);
alter table public.submission_uploads add column if not exists reviewed_at timestamptz;

-- Now that a real reviewer exists to set them, constrain status to the
-- three actual values instead of leaving Part 4's column free-form text.
-- 'uploaded' = pending review (the only value Part 4's Edge Function
-- ever writes); 'accepted' / 'needs_resubmission' are staff-set.
alter table public.submission_uploads drop constraint if exists submission_uploads_status_check;
alter table public.submission_uploads add constraint submission_uploads_status_check
  check (status in ('uploaded', 'accepted', 'needs_resubmission'));

-- Staff: same forms_management-tag write boundary already used for
-- submission_activities / submission_upload_fields (see
-- supabase_migration_submission_activities.sql). This is the first
-- update policy submission_uploads has ever had — Part 2's migration
-- deliberately created none ("an uploaded record is treated as an
-- immutable submission"). That convention still holds for scholars (no
-- scholar update policy exists or is added here — a scholar can never
-- edit their own submission's review outcome, or anything else about an
-- uploaded row); this policy only ever grants UPDATE to forms_management
-- staff.
drop policy if exists "forms_management staff update" on public.submission_uploads;
create policy "forms_management staff update" on public.submission_uploads
  for update using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  ) with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

-- Supports the review panel's activity+status filtering.
create index if not exists idx_submission_uploads_activity_status
  on public.submission_uploads (activity_id, status);
