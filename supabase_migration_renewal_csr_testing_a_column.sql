-- ─────────────────────────────────────────────────────────────
-- A SEPARATE CSR SWITCH FOR TESTING, FILE A of 2: the column.   Safe to run twice.   Undo: undo_renewal_csr_testing_a.sql
-- Run this FIRST, on its own, then supabase_migration_renewal_csr_testing_b_functions.sql.
--
-- Adds "testing_enabled" to the certificate settings (one row). It is OFF by default, so nothing changes until someone switches it on.
-- Changes ONE small table (csr_settings, one row); nothing is deleted. Gives up after 5 seconds if the site is busy (just run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.csr_settings add column if not exists testing_enabled boolean not null default false;

notify pgrst, 'reload schema';
