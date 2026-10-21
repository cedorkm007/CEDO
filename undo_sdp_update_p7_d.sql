-- UNDO for supabase_migration_sdp_update_p7_d_division_change_log.sql: puts back the rule the live project had ("staff full access"). No row is touched.
set lock_timeout = '5s';
drop policy if exists "p7 staff read division log" on public.division_change_log;
drop policy if exists "p7 it admin adds division log" on public.division_change_log;
drop policy if exists "staff full access" on public.division_change_log;
create policy "staff full access" on public.division_change_log for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
