-- UNDO for supabase_migration_school_grading_rules_b_percentage.sql (run undo_school_grading_rules_d.sql first).
-- WARNING: this deletes the percentages that schools entered. The grades themselves (the equivalent grades) stay as they are.
set lock_timeout = '5s';
alter table public.scholar_subjects_grades drop constraint if exists scholar_subjects_grades_percentage_range;
alter table public.scholar_subjects_grades drop column if exists percentage;
notify pgrst, 'reload schema';
