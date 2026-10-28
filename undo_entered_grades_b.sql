-- UNDO for supabase_migration_entered_grades_b_grading_columns.sql. Run it AFTER undo_entered_grades_c.sql, BEFORE undo_entered_grades_a.sql.
-- Removes the four columns (the "set by staff" marks are lost; the grading setups themselves are untouched).
set lock_timeout = '5s';
alter table public.school_grading_configs drop column if exists staff_set_by;
alter table public.school_grading_configs drop column if exists staff_set_at;
alter table public.school_grading_configs drop column if exists staff_note;
alter table public.school_grading_configs drop column if exists set_by_staff;
notify pgrst, 'reload schema';
