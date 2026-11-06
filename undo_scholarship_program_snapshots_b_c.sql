-- Undo of supabase_migration_scholarship_program_snapshots_b_semesters.sql and ..._c_renewal_sync.sql.
-- Removes the automatic filling of renewal semesters and the list of semesters, and deletes the rows that the renewal filled in
-- (they are rebuilt by running file C again). The "before the renewal" copy of 1st Semester 2026-2027 is NOT deleted.
-- To get the manual "Save a semester" function of the first file back exactly as it was, run supabase_migration_scholarship_program_snapshots.sql again afterwards.
drop trigger if exists program_info_renewal_sync on public.renewal_records;
drop function if exists public._program_info_renewal_sync();
delete from public.scholar_period_snapshots s
 where not exists (select 1 from public.scholar_snapshot_runs r where r.school_year = s.school_year and r.term = s.term and r.source = 'saved');
drop function if exists public.program_info_periods();
alter table public.scholar_snapshot_runs drop constraint if exists scholar_snapshot_runs_source_check;
alter table public.scholar_snapshot_runs drop column if exists source;
notify pgrst, 'reload schema';
