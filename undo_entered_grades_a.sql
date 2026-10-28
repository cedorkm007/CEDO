-- UNDO for supabase_migration_entered_grades_a_tables.sql. Run it AFTER undo_entered_grades_c.sql and undo_entered_grades_b.sql.
-- Removes the three tables (every entered grade, decision and file record in them is lost; the files themselves stay in the renewal-documents folder until deleted by hand).
drop table if exists public.renewal_self_grade_files;
drop table if exists public.renewal_self_grade_lines;
drop table if exists public.renewal_self_grade_submissions;
notify pgrst, 'reload schema';
