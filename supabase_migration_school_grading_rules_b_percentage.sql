-- ─────────────────────────────────────────────────────────────
-- SCHOOL GRADING RULES, FILE B of 3 (Phase 2): one new column for the percentage of a subject.   Safe to run twice.   Undo: undo_school_grading_rules_b.sql
-- Run AFTER supabase_migration_school_grading_rules_a_tables.sql and supabase_migration_school_grading_rules_c_functions.sql, and BEFORE supabase_migration_school_grading_rules_d_functions.sql.
--
-- This file ONLY ADDS an empty column "percentage" to the table of subjects and grades. Every grade already saved stays exactly as it is (the new column is empty for them).
-- It is a separate file because it changes a busy table for a split second; it waits at most 5 seconds for its turn and gives up cleanly if the table is busy (just run it again).
-- ─────────────────────────────────────────────────────────────

set lock_timeout = '5s';

alter table public.scholar_subjects_grades add column if not exists percentage numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scholar_subjects_grades_percentage_range' and conrelid = 'public.scholar_subjects_grades'::regclass) then
    alter table public.scholar_subjects_grades add constraint scholar_subjects_grades_percentage_range check (percentage is null or (percentage >= 0 and percentage <= 100)) not valid;
  end if;
end $$;
-- (the check applies to new and changed rows only; "not valid" means the table is not scanned, and no existing row can break it because the column starts empty)

notify pgrst, 'reload schema';
