-- ─────────────────────────────────────────────────────────────
-- supabase_migration_realtime_tags_and_uploads.sql
--
-- Adds staff_account_tags and submission_uploads to the
-- supabase_realtime publication. Without this, Postgres never emits
-- postgres_changes events for these tables at all — no amount of
-- frontend subscription code can see a change until this is set,
-- regardless of RLS. attendance_records and attendance_codes were
-- already enabled (confirmed via pg_publication_tables before writing
-- this), which is why QR-scan-driven attendance counts are the one
-- part of this "need to refresh to see it" complaint that only needed
-- a frontend fix, not this migration too.
--
-- staff_account_tags: fixes a tagged account's sidebar not showing a
-- newly-granted tool until the staff member reloads the page.
-- submission_uploads: fixes Submission Monitoring's roster/status
-- counts not updating when a scholar uploads a file while staff has
-- the roster open.
--
-- Safe to re-run — ADD TABLE is a no-op if the table is already in the
-- publication (guarded with a DO block to avoid a hard error either way).
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'staff_account_tags'
  ) then
    alter publication supabase_realtime add table public.staff_account_tags;
  end if;

  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'submission_uploads'
  ) then
    alter publication supabase_realtime add table public.submission_uploads;
  end if;
end $$;
