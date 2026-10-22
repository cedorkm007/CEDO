-- UNDO for supabase_migration_sdp_update_p8_f_attendance_records.sql: puts back the rule the live project had ("staff full access"). No row is touched.
set lock_timeout = '5s';
drop policy if exists "p8 tool staff read attendance records" on public.attendance_records;
drop policy if exists "staff full access" on public.attendance_records;
create policy "staff full access" on public.attendance_records for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
