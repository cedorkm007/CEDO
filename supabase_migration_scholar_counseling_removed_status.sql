-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_counseling_removed_status.sql
--
-- Daily Records' Status column is a monitoring snapshot of the scholar's
-- CURRENT scholarship status at that visit — unlike every other status
-- dropdown in the app, it isn't an action that changes anything, so
-- 'Removed' belongs in the allowed set here (a counseling visit can be
-- logged for a scholar who has since been removed).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.scholar_counseling_records drop constraint if exists scholar_counseling_records_status_check;
alter table public.scholar_counseling_records add constraint scholar_counseling_records_status_check
  check (status = any (array['Regular'::text, 'Probationary'::text, 'On leave'::text, 'Reconsidered'::text, 'Removed'::text]));
