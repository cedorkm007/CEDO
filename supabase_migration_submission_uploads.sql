-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_uploads.sql
--
-- Part 2 of the Submission Activity feature — creates the
-- submission_uploads table deferred from Part 1
-- (supabase_migration_submission_activities.sql), whose own comment
-- explicitly said this shape depended on scholar-side decisions not made
-- yet. It's created now, ready for Parts 3-4 (real Google Drive
-- integration) to populate — Part 2's scholar-facing UI shows a "Google
-- Drive upload will be connected next" message on submit rather than
-- writing a real row here, since there is still no file-storage backend.
--
-- field_id uses ON DELETE SET NULL, not CASCADE, and field_label_snapshot
-- captures the field's label at upload time — deliberately, per the risk
-- Part 1's own handoff note flagged forward: staff re-saving an
-- activity's upload fields must never be able to silently delete or
-- misattribute a scholar's existing uploads. Part 1's
-- setSubmissionUploadFields() has ALSO been fixed in this same round (see
-- src/sead/submissionActivitiesApi.ts) to upsert-and-prune existing field
-- rows by id instead of deleting and recreating the whole set on every
-- save, so field ids now actually survive normal edits/reorders — the
-- SET NULL + snapshot here is a second, independent layer of protection
-- for the case a field genuinely gets deleted on purpose later.
--
-- Safe to re-run — create-if-not-exists / drop-then-create throughout.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.submission_uploads (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.scholars(id) on delete cascade,
  activity_id uuid not null references public.submission_activities(id) on delete cascade,
  field_id uuid references public.submission_upload_fields(id) on delete set null,
  -- Captured at upload time so the scholar's own submission history and
  -- any future staff review UI (Part 5) can still show what a file was
  -- submitted against even if the field itself is later renamed/removed.
  field_label_snapshot text not null,
  file_name text not null,
  -- Populated once Parts 3-4 wire up real Google Drive storage. Part 2's
  -- UI never inserts a row here at all (see SubmissionActivityCard in
  -- src/scholar/components/dashboard/SubmissionActivitiesList.tsx) — this
  -- column exists now so the table shape is ready, not because anything
  -- writes to it yet.
  file_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_submission_uploads_scholar on public.submission_uploads (scholar_id);
create index if not exists idx_submission_uploads_activity on public.submission_uploads (activity_id);

alter table public.submission_uploads enable row level security;

-- Scholar: can see and create only their own uploads. No update/delete
-- policy — an uploaded record is treated as an immutable submission, the
-- same convention already used for attendance_records / scholar quest
-- scores elsewhere in this codebase. (Nothing writes a real row here yet
-- in Part 2 regardless — see above — but the policy is written now so
-- Parts 3-4 don't need a separate RLS migration just to enable inserts.)
drop policy if exists "scholar reads own submissions" on public.submission_uploads;
create policy "scholar reads own submissions" on public.submission_uploads
  for select using (scholar_id = auth.uid());

drop policy if exists "scholar creates own submissions" on public.submission_uploads;
create policy "scholar creates own submissions" on public.submission_uploads
  for insert with check (scholar_id = auth.uid());

-- Staff: any SEAD staff account can see every submission, ready for the
-- Part 5 review UI — matches the same "broad staff read" convention
-- already used for submission_activities / submission_upload_fields /
-- form_materials.
drop policy if exists "staff read" on public.submission_uploads;
create policy "staff read" on public.submission_uploads
  for select using (public.is_sead_staff());
