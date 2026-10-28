-- ─────────────────────────────────────────────────────────────
-- SCHOLAR-ENTERED GRADES, FILE B of 3: marks a school's grading system as "set by staff, temporary".   Safe to run twice.   Undo: undo_entered_grades_b.sql
-- Run on its own, AFTER _a_tables.sql. Changes ONE table (the schools' grading setup): adds four small columns; every existing row stays as it is (not temporary).
-- Scholars' Grades Monitoring staff can set up a school's grading system for the time being (scale, passing mark, letter grades, non-numeric marks) so entered grades can be
-- judged as passed or failed. When the school saves its own setup, the "temporary" mark is cleared (file C does that). Gives up after 5 seconds if the site is busy (run it again).
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.school_grading_configs add column if not exists set_by_staff boolean not null default false;
alter table public.school_grading_configs add column if not exists staff_note text not null default '';
alter table public.school_grading_configs add column if not exists staff_set_at timestamptz;
alter table public.school_grading_configs add column if not exists staff_set_by uuid;

notify pgrst, 'reload schema';
