-- UNDO for supabase_migration_sdp_update_p8_b_grades.sql: puts back the rule the live project had ("staff full access"). No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 grades staff read grades" on public.scholar_subjects_grades;
drop policy if exists "p8 grades staff manage grades" on public.scholar_subjects_grades;
drop policy if exists "staff full access" on public.scholar_subjects_grades;
create policy "staff full access" on public.scholar_subjects_grades for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
