-- UNDO for supabase_migration_school_grading_rules_a_tables.sql: the three new tables are removed (run undo_school_grading_rules_c.sql first).
-- WARNING: this deletes every grading rules version and audit row the schools have saved. Nothing else is touched: grades, scales, letters and marks stay as they are.
drop table if exists public.school_grading_audit;
drop table if exists public.school_grade_bands;
drop table if exists public.school_grading_versions;
