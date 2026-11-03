-- UNDO for supabase_migration_school_student_no.sql: the two functions, the unique rule and the School ID column are removed.
-- WARNING: dropping the column deletes the School IDs that schools have entered. Nothing else is touched.
set lock_timeout = '5s';

drop function if exists public.school_link_student_nos(jsonb);
drop function if exists public.school_set_student_no(text, text);
drop index if exists public.scholars_school_student_no_uq;
alter table public.scholars drop constraint if exists scholars_school_student_no_check;
alter table public.scholars drop column if exists school_student_no;

notify pgrst, 'reload schema';
