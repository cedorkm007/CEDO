-- UNDO for supabase_migration_sdp_update_p7_c_scholar_account_log.sql: puts back the rule the live project had ("staff full access"). No row is touched.
set lock_timeout = '5s';
drop policy if exists "p7 staff read account log" on public.sead_scholar_account_log;
drop policy if exists "p7 staff add account log" on public.sead_scholar_account_log;
drop policy if exists "staff full access" on public.sead_scholar_account_log;
create policy "staff full access" on public.sead_scholar_account_log for all using (public.is_cedo_staff()) with check (public.is_cedo_staff());
