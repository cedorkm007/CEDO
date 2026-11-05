-- Undo of supabase_migration_scholarship_program_snapshots.sql: removes the saved semesters and their functions.
-- WARNING: this deletes every saved snapshot (they cannot be rebuilt: the past is not stored anywhere else). The live Scholarship Program Information page is not affected.
drop function if exists public.renewal_ongoing();
drop function if exists public.scholars_by_course_for_status_snapshot(text, text, text);
drop function if exists public.scholars_by_barangay_for_status_snapshot(text, text, text);
drop function if exists public.scholars_by_school_for_status_snapshot(text, text, text);
drop function if exists public.scholars_by_year_level_for_status_snapshot(text, text, text);
drop function if exists public.scholars_by_school_year_level_course_snapshot(text, text, text, text);
drop function if exists public.scholars_by_school_year_level_snapshot(text, text, text);
drop function if exists public.scholars_by_school_snapshot(text, text);
drop function if exists public.scholars_by_barangay_snapshot(text, text);
drop function if exists public.scholarship_status_counts_snapshot(text, text);
drop function if exists public.scholar_snapshot_take(text, text, boolean);
drop policy if exists "program info staff read snapshot runs" on public.scholar_snapshot_runs;
drop table if exists public.scholar_snapshot_runs;
drop policy if exists "program info staff read snapshots" on public.scholar_period_snapshots;
drop table if exists public.scholar_period_snapshots;
