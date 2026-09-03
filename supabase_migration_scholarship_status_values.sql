-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_status_values.sql
--
-- Finishes a half-built feature: scholars.status already existed (default
-- 'active', CHECK'd to 'active'/'probation'/'inactive'/'graduated'), and
-- ScholarsTab.tsx already renders it as a colored badge — but every one
-- of this org's 7,133 scholars has only ever held 'active' (confirmed
-- live), the UI never let anyone actually change it, and it wasn't part
-- of the bulk-update flow. This migration replaces that placeholder value
-- set with the real one ("Scholarship Status": Regular, Probationary, On
-- leave, Reconsidered) that the rest of this change (ScholarsTab.tsx's
-- new dropdown, BulkScholarUpdateModal.tsx) is built against — same
-- column, same name, new meaning.
--
-- Existing 'active' rows become 'Regular' (the equivalent default
-- standing); the old 'probation'/'inactive'/'graduated' values are
-- retired since no scholar has ever actually held them.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.scholars drop constraint if exists scholars_status_check;

update public.scholars set status = 'Regular' where status = 'active';

alter table public.scholars alter column status set default 'Regular';
alter table public.scholars add constraint scholars_status_check
  check (status = any (array['Regular', 'Probationary', 'On leave', 'Reconsidered']));
