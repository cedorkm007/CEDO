-- ─────────────────────────────────────────────────────────────
-- RENEWAL WINDOW: CHOOSE THE SCHOOLS, FILE A of 2: the column.   Safe to run twice.   Undo: undo_renewal_window_schools_a.sql
-- Run this FIRST, on its own, then supabase_migration_renewal_window_schools_b_functions.sql.
--
-- A renewal window can now be limited to some schools: only the scholars enrolled in the chosen schools can see the window, be alerted, apply, and be counted in its lists.
-- This file adds the list of chosen schools to the renewal windows table. An empty list means ALL schools (every existing window stays exactly as it is).
-- Changes ONE table; nothing is deleted. Gives up after 5 seconds if the site is busy (just run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.renewal_windows add column if not exists school_ids uuid[];

notify pgrst, 'reload schema';
